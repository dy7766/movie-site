import { getDbPool, getTransferSettings } from '../src/lib/db.js';
import {
  DRIVE_CONFIGS,
  searchDriveShares,
  inspectDriveShare,
  saveAndShareDrive,
  checkDriveCapacity
} from './drive-client.js';
import { sendDingTalkCapacityAlert } from './dingtalk-service.js';
import { searchCmsStream } from './online-play-monitor.js';

const DRIVE_DB_COLUMN = {
  quark: 'share_link',
  uc: 'share_link_uc'
};

/**
 * 公共网盘补源与转存逻辑（统一处理 夸克 / UC）
 */
async function harvestDriveForMovie(pool, movie, driveType, { isEnabled, isCapacityFull }) {
  const cfg = DRIVE_CONFIGS[driveType];
  const col = DRIVE_DB_COLUMN[driveType];

  if (!isEnabled) {
    console.log(`  ⏸️ [后台控制跳过] 管理员已在后台关闭【${cfg.label}转存】，跳过《${movie.title}》的转存`);
    return false;
  }
  if (isCapacityFull) {
    console.log(`  ⏩ [容量熔断跳过] ${cfg.label}空间不足 (<15GB)，本轮跳过《${movie.title}》的搜存`);
    return false;
  }

  console.log(`  🔍 正在检索《${movie.title}》公开 ${cfg.label} 分享...`);
  try {
    const shares = await searchDriveShares(driveType, movie.title);
    for (const s of shares) {
      const inspect = await inspectDriveShare(driveType, s.pwd_id);
      if (!inspect.pass) {
        console.log(`    - ${cfg.label}候选 [${s.pwd_id}] 质检跳过: ${inspect.reason}`);
        continue;
      }

      console.log(`  📥 正在执行 ${cfg.label} 秒存规范命名并生成专属分享链接...`);
      const detail = await saveAndShareDrive(driveType, {
        title: movie.title,
        year: movie.year,
        category: movie.category || '电影',
        pwdId: s.pwd_id,
        stoken: inspect.stoken,
        list: inspect.list
      });
      if (detail?.shareUrl) {
        await pool.query(
          `UPDATE resources SET ${col} = $1, drive_type = COALESCE(drive_type, $2), status = 'published' WHERE id = $3`,
          [detail.shareUrl, driveType, movie.id]
        );
        console.log(`  ✓ 成功挂载 ${cfg.label} 专属链接: ${detail.shareUrl}`);
        return true;
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ ${cfg.label} 转存异常:`, err.message);
  }
  return false;
}

/**
 * 阶段二：根据阶段一入库的影视元数据，精准搜源并挂载转存与在线播放资源
 * @param {number} batchSize 本批次处理数量 (默认 25 部)
 */
export async function harvestResourceData(batchSize = 25) {
  console.log('===============================================================');
  console.log(`🚀【阶段二 · 靶向影视资源搜源与转存流水线启动】(批次上限: ${batchSize} 部)`);
  console.log('===============================================================');

  const pool = getDbPool();

  // 0. 读取管理员后台转存控制开关 (UC / 夸克 分离控制)
  const transferSettings = await getTransferSettings();
  console.log(`⚙️ [转存配置] UC网盘自动转存: ${transferSettings.uc ? '🟢 开启' : '🔴 已暂停'} | 夸克网盘自动转存: ${transferSettings.quark ? '🟢 开启' : '🔴 已暂停'}`);

  // 1. 批次前置容量探测：两个网盘统一预检与熔断
  const capacityFullMap = { uc: false, quark: false };
  for (const driveType of ['uc', 'quark']) {
    const cfg = DRIVE_CONFIGS[driveType];
    if (!transferSettings[driveType]) {
      console.log(`  ℹ️ [开关生效] ${cfg.label}转存已被管理员设为暂停，跳过容量探测与预警`);
      continue;
    }
    const initialCap = await checkDriveCapacity(driveType);
    if (initialCap.ok && initialCap.isFull) {
      capacityFullMap[driveType] = true;
      console.warn(`  🚨 [批次前置熔断] ${cfg.label}空间已耗尽 (仅剩 ${initialCap.freeGb} GB < 15GB)，本轮跳过全部 ${cfg.label} 转存任务。`);
      await sendDingTalkCapacityAlert({
        usedTb: initialCap.usedTb,
        totalTb: initialCap.totalTb,
        freeGb: initialCap.freeGb,
        provider: cfg.alertProvider
      });
    }
  }

  // 2. 全库智能轮转优先：优先在播未完结剧集与近年新片，保证热播内容第一时间就绪
  const query = `
    SELECT id, title, category, year, score, share_link, share_link_uc, online_play_url
    FROM resources
    WHERE has_metadata = TRUE
      AND (is_released IS NULL OR is_released = TRUE)
      AND (
        (share_link IS NULL AND $2 = TRUE) OR
        (share_link_uc IS NULL AND $3 = TRUE) OR
        online_play_url IS NULL
      )
    ORDER BY
      CASE WHEN is_finished = FALSE THEN 0 ELSE 1 END ASC,
      CASE WHEN year >= 2025 THEN 0 WHEN year >= 2024 THEN 1 ELSE 2 END ASC,
      CASE WHEN last_harvest_at IS NULL THEN 0 ELSE 1 END ASC,
      last_harvest_at ASC NULLS FIRST,
      created_at DESC,
      score DESC NULLS LAST
    LIMIT $1
  `;
  const res = await pool.query(query, [batchSize, transferSettings.quark, transferSettings.uc]);
  const candidates = res.rows;

  if (candidates.length === 0) {
    console.log('🎉 当前片库中所有影视均已拥有完整网盘转存与在线播放源，无需补充！');
    return { processed: 0, quarkSuccess: 0, ucSuccess: 0, streamSuccess: 0, updatedItems: [] };
  }

  console.log(`🎯 命中本批次待补充资源的影视条目 (${candidates.length} 部):`);
  candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. 《${c.title}》 (${c.year}) - 评分: ${c.score} | 夸克: ${c.share_link ? '已挂载' : '待补'} | UC: ${c.share_link_uc ? '已挂载' : '待补'} | 在线看: ${c.online_play_url ? '已挂载' : '待补'}`);
  });

  let quarkSuccess = 0;
  let ucSuccess = 0;
  let streamSuccess = 0;
  const updatedItems = [];

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    let didUpdateQuark = false;
    let didUpdateUc = false;
    let didUpdateStream = false;
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🎬 [${i + 1}/${candidates.length}] 正在为《${m.title}》(${m.year}) 搜源与补齐数据...`);

    // 1. 补齐 夸克网盘 转存链接
    if (!m.share_link) {
      didUpdateQuark = await harvestDriveForMovie(pool, m, 'quark', {
        isEnabled: transferSettings.quark,
        isCapacityFull: capacityFullMap.quark
      });
      if (didUpdateQuark) quarkSuccess++;
    }

    // 2. 补齐 UC 网盘 转存链接
    if (!m.share_link_uc) {
      didUpdateUc = await harvestDriveForMovie(pool, m, 'uc', {
        isEnabled: transferSettings.uc,
        isCapacityFull: capacityFullMap.uc
      });
      if (didUpdateUc) ucSuccess++;
    }

    // 3. 补齐 M3U8 免广告在线播放源
    if (!m.online_play_url) {
      console.log(`  📺 正在检索免广告 M3U8 切片流播放源...`);
      try {
        const stream = await searchCmsStream(m.title, m.year);
        if (stream && stream.primaryUrl) {
          await pool.query(
            'UPDATE resources SET online_play_url = $1, play_sources = $2 WHERE id = $3',
            [stream.primaryUrl, JSON.stringify(stream.sources), m.id]
          );
          console.log(`  ✓ 成功挂载极速免广告在线切片源: ${stream.primaryUrl.slice(0, 50)}...`);
          streamSuccess++;
          didUpdateStream = true;
        } else {
          console.log(`  - 各资源站暂无《${m.title}》的高清切片源`);
        }
      } catch (err) {
        console.warn(`  ⚠️ 在线切片流匹配异常:`, err.message);
      }
    }

    if (didUpdateQuark || didUpdateUc || didUpdateStream) {
      const parts = [];
      if (didUpdateQuark) parts.push('夸克专属分佣');
      if (didUpdateUc) parts.push('UC专属分佣');
      if (didUpdateStream) parts.push('在线切片');
      const desc = parts.join(' + ') + '已就绪';

      updatedItems.push({
        title: m.title,
        year: m.year,
        quality: m.category || '4K 原盘',
        desc
      });
    }

    // 4. 记录本次搜源巡检时间戳，确保轮转机制生效，彻底消除死循环与队头阻塞
    try {
      await pool.query('UPDATE resources SET last_harvest_at = NOW() WHERE id = $1', [m.id]);
    } catch {}

    await new Promise(r => setTimeout(r, 600));
  }

  console.log('\n===============================================================');
  console.log(`✨【阶段二 · 资源数据补充完成】`);
  console.log(`处理条目: ${candidates.length} 部 | 夸克转存: ${quarkSuccess} 部 | UC转存: ${ucSuccess} 部 | 在线切片: ${streamSuccess} 部`);
  console.log('===============================================================\n');

  return { processed: candidates.length, quarkSuccess, ucSuccess, streamSuccess, updatedItems };
}

if (process.argv[1]?.endsWith('harvest-resource-data.js')) {
  const batch = parseInt(process.argv[2] || '15');
  harvestResourceData(batch).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

import { getDbPool, getTransferSettings } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc, checkUcCapacity } from './auto-harvester.js';
import { sendDingTalkCapacityAlert } from './dingtalk-service.js';
import { searchCmsStream } from './online-play-monitor.js';

/**
 * 阶段二：根据阶段一入库的影视元数据，精准搜源并挂载转存与在线播放资源
 * @param {number} batchSize 本批次处理数量 (默认 5 部，避免网盘 API 频率限制)
 */
export async function harvestResourceData(batchSize = 15) {
  console.log('===============================================================');
  console.log(`🚀【阶段二 · 靶向影视资源搜源与转存流水线启动】(批次上限: ${batchSize} 部)`);
  console.log('===============================================================');

  const pool = getDbPool();

  // 0. 读取管理员后台转存控制开关 (UC / 夸克 分离控制)
  const transferSettings = await getTransferSettings();
  console.log(`⚙️ [转存配置] UC网盘自动转存: ${transferSettings.uc ? '🟢 开启' : '🔴 已暂停'} | 夸克网盘自动转存: ${transferSettings.quark ? '🟢 开启' : '🔴 已暂停'}`);

  // 1. 批次前置容量探测：单次更新仅告警一次，空间不足时本批次全局跳过 UC 搜存，专注于切片流
  let isUcCapacityFull = false;
  if (transferSettings.uc) {
    const initialCap = await checkUcCapacity();
    if (initialCap.ok && initialCap.isFull) {
      isUcCapacityFull = true;
      console.warn(`  🚨 [批次前置熔断] UC网盘空间已耗尽 (仅剩 ${initialCap.freeGb} GB < 15GB)，本轮更新跳过全部 UC 转存任务，专注于切片流补充。`);
      await sendDingTalkCapacityAlert({
        usedTb: initialCap.usedTb,
        totalTb: initialCap.totalTb,
        freeGb: initialCap.freeGb,
        provider: 'UC'
      });
    }
  } else {
    console.log('  ℹ️ [开关生效] UC网盘转存已被管理员设为暂停，跳过 UC 容量探测与预警');
  }

  // 1. 全库公平轮转优先：优先从未巡检的条目开始，同时倾斜缺失网盘与高分热片
  const query = `
    SELECT id, title, category, year, score, share_link, share_link_uc, online_play_url
    FROM resources
    WHERE has_metadata = TRUE
      AND (is_released IS NULL OR is_released = TRUE)
      AND (share_link_uc IS NULL OR online_play_url IS NULL)
    ORDER BY
      last_harvest_at ASC NULLS FIRST,
      CASE WHEN share_link_uc IS NULL THEN 1 ELSE 2 END ASC,
      year DESC NULLS LAST,
      score DESC NULLS LAST,
      created_at DESC
    LIMIT $1
  `;
  const res = await pool.query(query, [batchSize]);
  const candidates = res.rows;

  if (candidates.length === 0) {
    console.log('🎉 当前片库中所有影视均已拥有完整网盘转存与在线播放源，无需补充！');
    return { processed: 0, ucSuccess: 0, streamSuccess: 0, updatedItems: [] };
  }

  console.log(`🎯 命中本批次待补充资源的影视条目 (${candidates.length} 部):`);
  candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. 《${c.title}》 (${c.year}) - 评分: ${c.score} | UC网盘: ${c.share_link_uc ? '已挂载' : '待补'} | 在线看: ${c.online_play_url ? '已挂载' : '待补'}`);
  });

  let ucSuccess = 0;
  let streamSuccess = 0;
  const updatedItems = [];

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    let didUpdateUc = false;
    let didUpdateStream = false;
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🎬 [${i + 1}/${candidates.length}] 正在为《${m.title}》(${m.year}) 搜源与补齐数据...`);

    // 1. 补齐 UC 网盘转存链接
    if (!m.share_link_uc) {
      if (!transferSettings.uc) {
        console.log(`  ⏸️ [后台控制跳过] 管理员已在后台关闭【UC网盘转存】，跳过《${m.title}》的 UC 资源搜存与转存`);
      } else if (isUcCapacityFull) {
        console.log(`  ⏩ [容量熔断跳过] UC网盘空间不足 (<15GB)，本轮跳过《${m.title}》的网盘搜存与重复报警`);
      } else {
        console.log(`  🔍 正在全网检索《${m.title}》公开网盘分享...`);
        try {
          const publicShares = await searchPublicShares(m.title);
          for (const s of publicShares) {
            const inspect = await inspectAndFilterUcShare(s.pwd_id);
            if (!inspect.pass) {
              console.log(`    - 候选链接 [${s.pwd_id}] 质检跳过: ${inspect.reason}`);
              continue;
            }

            console.log(`  📥 正在执行免流秒存与生成带 PID 专属分享链接...`);
            const ucLink = await saveAndShareUc(m.title, m.year, m.category || '电影', s.pwd_id, inspect.stoken, inspect.list);
            if (ucLink) {
              await pool.query('UPDATE resources SET share_link_uc = $1, drive_type = COALESCE(drive_type, \'uc\'), status = \'published\' WHERE id = $2', [ucLink, m.id]);
              console.log(`  ✓ 成功挂载 UC 网盘专属链接: ${ucLink}`);
              ucSuccess++;
              didUpdateUc = true;
              break;
            }
          }
        } catch (err) {
          console.warn(`  ⚠️ 网盘转存异常:`, err.message);
        }
      }
    }

    // 2. 补齐 M3U8 免广告在线播放源
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

    if (didUpdateUc || didUpdateStream) {
      let desc = '';
      if (didUpdateUc && didUpdateStream) desc = 'UC专属分佣 + 在线切片双就绪';
      else if (didUpdateUc) desc = 'UC专属分佣已绑定';
      else desc = '免广告在线切片已挂载';

      updatedItems.push({
        title: m.title,
        year: m.year,
        quality: m.category || '4K 原盘',
        desc
      });
    }

    // 3. 记录本次搜源巡检时间戳，确保轮转机制生效，彻底消除死循环与队头阻塞
    try {
      await pool.query('UPDATE resources SET last_harvest_at = NOW() WHERE id = $1', [m.id]);
    } catch {}

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n===============================================================');
  console.log(`✨【阶段二 · 资源数据补充完成】`);
  console.log(`处理条目: ${candidates.length} 部 | 成功挂载网盘: ${ucSuccess} 部 | 成功挂载在线切片: ${streamSuccess} 部`);
  console.log('===============================================================\n');

  return { processed: candidates.length, ucSuccess, streamSuccess, updatedItems };
}

if (process.argv[1]?.endsWith('harvest-resource-data.js')) {
  const batch = parseInt(process.argv[2] || '3');
  harvestResourceData(batch).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

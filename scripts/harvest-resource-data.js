import { getDbPool } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc } from './auto-harvester.js';
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

  // 1. 优先为最新入库、元数据已就绪但缺少网盘或在线源的影视补齐资源 (按入库时间倒序，彻底杜绝队头阻塞)
  const query = `
    SELECT id, title, year, score, share_link, share_link_uc, online_play_url
    FROM resources
    WHERE has_metadata = TRUE
      AND (share_link_uc IS NULL OR online_play_url IS NULL)
    ORDER BY created_at DESC, year DESC
    LIMIT $1
  `;
  const res = await pool.query(query, [batchSize]);
  const candidates = res.rows;

  if (candidates.length === 0) {
    console.log('🎉 当前片库中所有影视均已拥有完整网盘转存与在线播放源，无需补充！');
    return { processed: 0, ucSuccess: 0, streamSuccess: 0 };
  }

  console.log(`🎯 命中本批次待补充资源的影视条目 (${candidates.length} 部):`);
  candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. 《${c.title}》 (${c.year}) - 评分: ${c.score} | UC网盘: ${c.share_link_uc ? '已挂载' : '待补'} | 在线看: ${c.online_play_url ? '已挂载' : '待补'}`);
  });

  let ucSuccess = 0;
  let streamSuccess = 0;

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🎬 [${i + 1}/${candidates.length}] 正在为《${m.title}》(${m.year}) 搜源与补齐数据...`);

    // 1. 补齐 UC 网盘转存链接
    if (!m.share_link_uc) {
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
          const ucLink = await saveAndShareUc(m.title, m.year, '电影', s.pwd_id, inspect.stoken, inspect.list);
          if (ucLink) {
            await pool.query('UPDATE resources SET share_link_uc = $1, drive_type = COALESCE(drive_type, \'uc\'), status = \'published\' WHERE id = $2', [ucLink, m.id]);
            console.log(`  ✓ 成功挂载 UC 网盘专属链接: ${ucLink}`);
            ucSuccess++;
            break;
          }
        }
      } catch (err) {
        console.warn(`  ⚠️ 网盘转存异常:`, err.message);
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
        } else {
          console.log(`  - 各资源站暂无《${m.title}》的高清切片源`);
        }
      } catch (err) {
        console.warn(`  ⚠️ 在线切片流匹配异常:`, err.message);
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n===============================================================');
  console.log(`✨【阶段二 · 资源数据补充完成】`);
  console.log(`处理条目: ${candidates.length} 部 | 成功挂载网盘: ${ucSuccess} 部 | 成功挂载在线切片: ${streamSuccess} 部`);
  console.log('===============================================================\n');

  return { processed: candidates.length, ucSuccess, streamSuccess };
}

if (process.argv[1]?.endsWith('harvest-resource-data.js')) {
  const batch = parseInt(process.argv[2] || '3');
  harvestResourceData(batch).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

import { getDbPool } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc } from './auto-harvester.js';

/**
 * 电视剧/综艺每日追更自愈与集数递增服务
 * 针对未完结的剧集，每日巡检公网更新状态，自动提升集数并转存最新合集
 */
export async function syncOngoingSeriesEpisodes() {
  console.log('===============================================================');
  console.log('📺【电视剧/综艺每日连载追更与最新集数同步巡检启动】');
  console.log('===============================================================');

  const pool = getDbPool();

  // 1. 查找库中所有“未完结”的电视剧、综艺、动漫
  const query = `
    SELECT id, title, category, year, current_episode, total_episodes, is_finished, share_link_uc, share_link
    FROM resources
    WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
      AND is_finished = false
    ORDER BY year DESC, id DESC
  `;
  const res = await pool.query(query);
  const ongoingList = res.rows;

  if (ongoingList.length === 0) {
    console.log('🟢 当前片库中暂无连载中的未完结剧集，全部已完结或已处于最新状态。');
    return { updatedCount: 0, items: [] };
  }

  console.log(`🎯 命中 ${ongoingList.length} 部正在连载追更的影视剧集:`);
  ongoingList.forEach((s, idx) => {
    console.log(`  ${idx + 1}. 《${s.title}》 - 当前展示至第 ${s.current_episode} 集 (全 ${s.total_episodes} 集)`);
  });

  const updatedItems = [];

  for (const s of ongoingList) {
    console.log(`\n🔍 正在检索《${s.title}》最新连载集数...`);
    try {
      const shares = await searchPublicShares(s.title);
      let highestEpFound = s.current_episode || 1;
      let bestShare = null;

      for (const sh of shares) {
        // 从标题提取当前分享包含的最大集数，如 "更新至26集", "01-28集", "EP28"
        const epMatch = sh.title.match(/(?:更新至|第|EP|全)?\s*(\d+)\s*(?:集|期)/i);
        if (epMatch) {
          const epNum = parseInt(epMatch[1]);
          if (epNum > highestEpFound && epNum <= (s.total_episodes || 100)) {
            highestEpFound = epNum;
            bestShare = sh;
          }
        }
      }

      if (highestEpFound > s.current_episode && bestShare) {
        console.log(`  🎉 发现最新剧集更新！《${s.title}》由第 ${s.current_episode} 集 ➔ 递增至第 ${highestEpFound} 集！`);
        
        // 自动质检并转存最新包含新集数的网盘链接到个人 UC 盘
        let newUcLink = null;
        const inspect = await inspectAndFilterUcShare(bestShare.pwd_id);
        if (inspect.pass) {
          newUcLink = await saveAndShareUc(s.title, s.year, s.category, bestShare.pwd_id, inspect.stoken, inspect.list);
        }

        const isNowFinished = highestEpFound >= s.total_episodes;
        await pool.query(`
          UPDATE resources 
          SET current_episode = $1, 
              is_finished = $2,
              share_link_uc = COALESCE($3, share_link_uc)
          WHERE id = $4
        `, [highestEpFound, isNowFinished, newUcLink, s.id]);

        updatedItems.push({
          title: s.title,
          oldEp: s.current_episode,
          newEp: highestEpFound,
          totalEp: s.total_episodes,
          isFinished: isNowFinished,
          ucLink: newUcLink
        });

        console.log(`  ✓ 数据库与转存更新成功！${isNowFinished ? '【本剧正式完结】' : '【持续连载中】'}`);
      } else {
        console.log(`  -《${s.title}》暂无更高集数发布，保持当前第 ${s.current_episode} 集。`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 巡检《${s.title}》更新异常:`, err.message);
    }
  }

  console.log('\n===============================================================');
  console.log(`🎉 连载追更巡检完成：共更新 ${updatedItems.length} 部剧集的最新集数！`);
  console.log('===============================================================\n');

  return { updatedCount: updatedItems.length, items: updatedItems };
}

if (process.argv[1]?.endsWith('sync-series-episodes.js')) {
  syncOngoingSeriesEpisodes().then(async () => {
    const p = getDbPool();
    await p.end();
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

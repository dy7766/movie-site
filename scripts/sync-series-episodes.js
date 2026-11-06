import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc } from './auto-harvester.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

/**
 * 跨平台安全 GET 请求 (使用系统原生 curl，确保与代理及网络环境无缝兼容)
 */
function curlGetJson(url) {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `curl.exe -s -L --max-time 6 "${url}"` : `curl -s -L --max-time 6 "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 8000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * 数据源一：TMDB 官方排期与在播状态权威检索
 */
export async function queryTmdbTv(title) {
  const cleanTitle = title.replace(/(?:第[一二三四五六七八九十\d]+季|\d{4}|第二季|第四季)/g, '').trim() || title;
  const searchEndpoints = [
    `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN`,
    `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&language=zh-CN`
  ];

  let hit = null;
  for (const sUrl of searchEndpoints) {
    const data = curlGetJson(sUrl);
    if (data?.results?.length > 0) {
      hit = data.results[0];
      break;
    }
  }

  if (!hit) return null;

  const detailUrl = `https://api.themoviedb.org/3/tv/${hit.id}?api_key=${TMDB_API_KEY}&language=zh-CN`;
  const details = curlGetJson(detailUrl);
  if (!details || details.status_code) return null;

  return {
    id: hit.id,
    name: details.name,
    status: details.status, // 'Ended', 'Returning Series', 'Canceled', 'In Production', 'Planned'
    in_production: details.in_production === true,
    totalEpisodes: details.number_of_episodes || details.seasons?.[0]?.episode_count || null,
    lastAirEp: details.last_episode_to_air?.episode_number || null,
    lastAirDate: details.last_episode_to_air?.air_date || null,
    nextAirEp: details.next_episode_to_air?.episode_number || null,
    firstAirDate: details.first_air_date || null
  };
}

/**
 * 数据源二：视频切片 CMS 资源接口 (兜底与抢先播集数补充)
 */
export async function queryCmsTv(title) {
  const endpoints = [
    'https://api.wujinapi.me/api.php/provide/vod/?ac=detail&wd=',
    'https://cj.lziapi.com/api.php/provide/vod/?ac=detail&wd='
  ];

  for (const ep of endpoints) {
    try {
      const data = curlGetJson(ep + encodeURIComponent(title));
      const list = data?.list || [];
      const match = list.find(v => v.vod_name && (v.vod_name === title || v.vod_name.includes(title)));
      if (match) {
        const playUrls = match.vod_play_url || '';
        const groups = playUrls.split('$$$');
        let maxEpCount = 0;
        for (const g of groups) {
          const count = g.split('#').filter(Boolean).length;
          if (count > maxEpCount) maxEpCount = count;
        }

        let remarkEp = null;
        let isFinished = false;
        const remarks = match.vod_remarks || '';
        if (remarks.includes('完结') || remarks.includes('全集') || /全\s*\d+\s*集/.test(remarks)) {
          isFinished = true;
        }
        const m = remarks.match(/(?:更新至|第|EP)?\s*(\d+)\s*(?:集|期)/i);
        if (m) {
          const parsed = parseInt(m[1], 10);
          if (parsed < 500) {
            remarkEp = parsed;
          }
        }

        return {
          found: true,
          epCount: maxEpCount,
          remarkEp: remarkEp,
          remarks: remarks,
          isFinished: isFinished,
          vodName: match.vod_name
        };
      }
    } catch {
      // 容错继续下一个接口
    }
  }
  return null;
}

/**
 * 核心决策引擎：TMDB 排期为主 + CMS 切片兜底
 */
export async function getSeriesAirStatus(title, { year, currentEpisode = 1, totalEpisodes = null } = {}) {
  const tmdb = await queryTmdbTv(title);
  const cms = await queryCmsTv(title);

  let finalTotal = tmdb?.totalEpisodes || totalEpisodes || cms?.epCount || null;
  let finalCur = currentEpisode || 1;
  let isFinished = false;
  let isReleased = true;

  // 1. 判断上映/开播时间
  const today = new Date().toISOString().slice(0, 10);
  if (tmdb?.firstAirDate && tmdb.firstAirDate > today) {
    isReleased = false;
  }

  // 2. 判断是否已完结 (TMDB 官方标记 Ended/Canceled 为第一权威)
  if (tmdb?.status === 'Ended' || tmdb?.status === 'Canceled') {
    isFinished = true;
    finalCur = finalTotal || (cms?.epCount ? cms.epCount : finalCur);
    if (!finalTotal && finalCur) finalTotal = finalCur;
  } else if (year && year < 2026 && !tmdb?.in_production && tmdb?.status !== 'Returning Series') {
    // 往年历史经典剧集且非在播态，确认为已完结
    isFinished = true;
    finalCur = finalTotal || (cms?.epCount ? cms.epCount : finalCur);
    if (!finalTotal && finalCur) finalTotal = finalCur;
  } else {
    // 3. 连载在播中剧集：TMDB排期为主 + CMS切片兜底/提前播补充
    const tmdbAir = tmdb?.lastAirEp || 0;
    const cmsAir = Math.max(cms?.epCount || 0, cms?.remarkEp || 0);
    // 取当前库中已知、TMDB已播和CMS切片中的最大集数
    finalCur = Math.max(finalCur, tmdbAir, cmsAir);

    if (cms?.isFinished || (finalTotal && finalCur >= finalTotal)) {
      isFinished = true;
    } else {
      isFinished = false;
    }
  }

  // 严格集数兜底保护：当已完结或集数溢出时，限制当前集数不得超过总集数
  if (finalTotal && finalTotal > 1) {
    if (isFinished || finalCur > finalTotal) {
      finalCur = Math.min(finalCur, finalTotal);
    }
  }

  return {
    title,
    currentEpisode: finalCur,
    totalEpisodes: finalTotal,
    isFinished,
    isReleased,
    tmdbStatus: tmdb?.status,
    cmsRemarks: cms?.remarks
  };
}

/**
 * 电视剧/综艺每日追更自愈与集数递增服务 (TMDB排期为主 + CMS切片兜底)
 */
export async function syncOngoingSeriesEpisodes({ all = false } = {}) {
  console.log('===============================================================');
  console.log(`📺【电视剧/综艺连载集数追踪与完结同步引擎启动】${all ? '(全量模式)' : '(增量巡检)'}`);
  console.log('===============================================================');

  const pool = getDbPool();

  const query = all ? `
    SELECT id, title, category, year, current_episode, total_episodes, is_finished, is_released, share_link_uc, share_link
    FROM resources
    WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
    ORDER BY year DESC, id DESC
  ` : `
    SELECT id, title, category, year, current_episode, total_episodes, is_finished, is_released, share_link_uc, share_link
    FROM resources
    WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
      AND (is_finished = false OR current_episode < total_episodes OR (current_episode = 1 AND total_episodes > 1))
    ORDER BY year DESC, id DESC
  `;

  const res = await pool.query(query);
  const candidateList = res.rows;

  if (candidateList.length === 0) {
    console.log('🟢 当前片库中暂无待同步集数的剧集，全部已完结或处于最新状态。');
    return { updatedCount: 0, items: [] };
  }

  console.log(`🎯 命中 ${candidateList.length} 部需校准/巡检的影视剧集:`);
  candidateList.slice(0, 10).forEach((s, idx) => {
    console.log(`  ${idx + 1}. 《${s.title}》(${s.year || '-'}) - 当前库内: 第 ${s.current_episode || 1} 集 / 全 ${s.total_episodes || '?'} 集 [${s.is_finished ? '完结' : '连载'}]`);
  });
  if (candidateList.length > 10) {
    console.log(`  ... 等共计 ${candidateList.length} 部剧集`);
  }

  const updatedItems = [];

  for (let i = 0; i < candidateList.length; i++) {
    const s = candidateList[i];
    console.log(`\n🔍 [${i + 1}/${candidateList.length}] 正在核验《${s.title}》官方排期与切片状态...`);

    try {
      const airStatus = await getSeriesAirStatus(s.title, {
        year: s.year,
        currentEpisode: s.current_episode || 1,
        totalEpisodes: s.total_episodes
      });

      const oldCur = s.current_episode || 1;
      const newCur = airStatus.currentEpisode;
      const newTotal = airStatus.totalEpisodes || s.total_episodes;
      const isFinished = airStatus.isFinished;
      const isReleased = airStatus.isReleased;

      let newUcLink = null;

      // 如果连载剧集发现了更新的集数，尝试检索并转存最新网盘资源包
      if (newCur > oldCur && !s.is_finished) {
        console.log(`  🎉 发现最新剧集更新！《${s.title}》由第 ${oldCur} 集 ➔ 递增至第 ${newCur} 集！`);
        try {
          const shares = await searchPublicShares(s.title);
          let bestShare = null;
          for (const sh of shares) {
            const epMatch = sh.title.match(/(?:更新至|第|EP|全)?\s*(\d+)\s*(?:集|期)/i);
            if (epMatch) {
              const epNum = parseInt(epMatch[1]);
              if (epNum >= newCur) {
                bestShare = sh;
                break;
              }
            }
          }
          if (bestShare) {
            const inspect = await inspectAndFilterUcShare(bestShare.pwd_id);
            if (inspect.pass) {
              newUcLink = await saveAndShareUc(s.title, s.year, s.category, bestShare.pwd_id, inspect.stoken, inspect.list);
            }
          }
        } catch (shareErr) {
          console.warn(`  ⚠️ 搜寻转存最新网盘包轻微异常:`, shareErr.message);
        }
      }

      // 检查是否发生数据变动
      const hasChanged = 
        newCur !== s.current_episode || 
        isFinished !== s.is_finished || 
        (newTotal && newTotal !== s.total_episodes) ||
        (isReleased !== null && isReleased !== s.is_released);

      if (hasChanged) {
        await pool.query(`
          UPDATE resources 
          SET current_episode = $1, 
              total_episodes = COALESCE($2, total_episodes),
              is_finished = $3,
              is_released = COALESCE($4, is_released),
              share_link_uc = COALESCE($5, share_link_uc)
          WHERE id = $6
        `, [newCur, newTotal, isFinished, isReleased, newUcLink, s.id]);

        updatedItems.push({
          title: s.title,
          oldEp: oldCur,
          newEp: newCur,
          totalEp: newTotal,
          isFinished,
          isReleased,
          ucLink: newUcLink
        });

        const statusTag = isFinished ? '【全集已完结】' : `【连载至第 ${newCur} 集】`;
        console.log(`  ✓ 状态校准成功: 《${s.title}》 ➔ ${statusTag} (全 ${newTotal || '?'} 集 · ${isReleased ? '已开播' : '待播'})`);
      } else {
        console.log(`  -《${s.title}》状态已处于最新，无需调整。`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 巡检《${s.title}》异常:`, err.message);
    }

    // 适当控制请求间隔
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n===============================================================');
  console.log(`🎉 剧集集数与完结状态同步完成：共校准/更新 ${updatedItems.length} 部剧集！`);
  console.log('===============================================================\n');

  return { updatedCount: updatedItems.length, items: updatedItems };
}

if (process.argv[1]?.endsWith('sync-series-episodes.js')) {
  const isAll = process.argv.includes('--all');
  syncOngoingSeriesEpisodes({ all: isAll }).then(async () => {
    const p = getDbPool();
    await p.end();
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

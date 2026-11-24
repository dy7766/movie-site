import { execSync } from 'child_process';
import { getDbPool, getTransferSettings } from '../src/lib/db.js';
import { 
  searchPublicShares, 
  inspectAndFilterUcShare, 
  saveAndShareUc, 
  saveAndShareUcDetail,
  getUcFolderFiles, 
  saveFilesToExistingUcFolder, 
  deleteUcFiles,
  searchQuarkShares,
  inspectAndFilterQuarkShare,
  saveAndShareQuark,
  countQuarkVideosDetailed
} from './auto-harvester.js';
import { searchCmsStream } from './online-play-monitor.js';

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
    SELECT id, title, category, year, current_episode, total_episodes, is_finished, is_released, share_link_uc, share_link,
           online_play_url, source_pwd_id, uc_fid, last_episode_updated_at
    FROM resources
    WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
    ORDER BY year DESC, id DESC
  ` : `
    SELECT id, title, category, year, current_episode, total_episodes, is_finished, is_released, share_link_uc, share_link,
           online_play_url, source_pwd_id, uc_fid, last_episode_updated_at
    FROM resources
    WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
      AND (is_finished = false OR current_episode < total_episodes OR (current_episode = 1 AND total_episodes > 1))
    ORDER BY year DESC, id DESC
  `;

  const res = await pool.query(query);
  const candidateList = res.rows;

  // 0. 读取管理员后台转存控制开关
  const transferSettings = await getTransferSettings();
  console.log(`⚙️ [转存配置] 电视剧自动追更网盘转存: 夸克=${transferSettings.quark ? '🟢 开启' : '🔴 关闭'} | UC=${transferSettings.uc ? '🟢 开启' : '🔴 关闭'}`);

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
      const expectedEp = airStatus.currentEpisode;
      const newTotal = airStatus.totalEpisodes || s.total_episodes;
      let isFinished = airStatus.isFinished;
      const isReleased = airStatus.isReleased;

      let effectiveCur = oldCur;
      let newUcLink = null;
      let newQuarkLink = null;
      let newUcFid = s.uc_fid;
      let newSourcePwdId = s.source_pwd_id;
      let episodeUpdated = false;

      // 检查当前绑定的夸克分享实际物理集数
      let physicalQuarkCount = oldCur;
      const curPwdMatch = s.share_link?.match(/\/s\/([a-zA-Z0-9]+)/);
      if (curPwdMatch && transferSettings.quark) {
        const curCheck = await countQuarkVideosDetailed(curPwdMatch[1]);
        if (curCheck.ok) physicalQuarkCount = curCheck.count;
      }

      const needsQuarkCatchup = transferSettings.quark && (!s.share_link || physicalQuarkCount < expectedEp);
      const hasNewEpisodes = expectedEp > oldCur;

      // 如果连载剧集发现了新集数或网盘物理资源滞后
      if ((hasNewEpisodes || needsQuarkCatchup) && !s.is_finished) {
        console.log(`  🎉 触发连载追踪更新！《${s.title}》官方/切片已播出至第 ${expectedEp} 集 (库内: 第 ${oldCur} 集, 网盘物理文件: ${physicalQuarkCount} 集)`);

        let syncSucceeded = false;

        // -------------------------------------------------------------
        // 【夸克网盘追更】：优先全网检索更全的夸克剧集资源包秒存
        // -------------------------------------------------------------
        if (transferSettings.quark) {
          try {
            console.log(`  🔍 [夸克追更] 正在全网检索《${s.title}》最新夸克分享...`);
            const quarkShares = await searchQuarkShares(s.title);
            let bestQuark = null;
            let maxQuarkCount = physicalQuarkCount;

            for (const sh of quarkShares) {
              const check = await countQuarkVideosDetailed(sh.pwd_id);
              if (check.ok && check.count > maxQuarkCount) {
                maxQuarkCount = check.count;
                bestQuark = { share: sh, inspect: check.inspect, videoCount: check.count };
                if (maxQuarkCount >= expectedEp) break;
              }
            }

            if (bestQuark) {
              console.log(`  🎯 [夸克追更] 锁定全网更全新包 [${bestQuark.share.pwd_id}] (含 ${bestQuark.videoCount} 集)，正在秒存生成专属链接...`);
              const qUrl = await saveAndShareQuark(s.title, bestQuark.share.pwd_id, bestQuark.inspect.stoken, bestQuark.inspect.list);
              if (qUrl) {
                newQuarkLink = qUrl;
                effectiveCur = Math.max(bestQuark.videoCount, oldCur);
                episodeUpdated = true;
                syncSucceeded = true;
                console.log(`  ✅ [夸克追更成功] 《${s.title}》已置换为第 ${effectiveCur} 集夸克网盘专属链接！`);
              }
            }
          } catch (qErr) {
            console.warn(`  ⚠️ [夸克追更执行异常]:`, qErr.message);
          }
        }

        // -------------------------------------------------------------
        // 【UC网盘追更】：若开启 UC 且夸克未命中，执行 UC 策略 A/B
        // -------------------------------------------------------------
        if (transferSettings.uc && !syncSucceeded) {
          let strategyASucceeded = false;

          // 【策略 A：增量补采】优先检查原源分享是否有新追加的单集
          if (s.source_pwd_id && s.uc_fid) {
            try {
              console.log(`  🔍 [UC策略A] 正在核验原源分享 [${s.source_pwd_id}] 与个人目录 [${s.uc_fid}]...`);
              const inspect = await inspectAndFilterUcShare(s.source_pwd_id);
              if (inspect.pass && inspect.stoken) {
                const sourceVideos = inspect.list.filter(f => !f.dir && /\.(mp4|mkv|ts|mov|avi|flv)$/i.test(f.file_name));
                const localFiles = await getUcFolderFiles(s.uc_fid);
                const localFileNames = new Set(localFiles.map(f => f.file_name));
                const newEpisodes = sourceVideos.filter(f => !localFileNames.has(f.file_name));

                if (newEpisodes.length > 0) {
                  console.log(`  📦 [UC策略A] 原源分享发现 ${newEpisodes.length} 个新增剧集，正在增量秒存进原目录...`);
                  const saveResult = await saveFilesToExistingUcFolder(s.uc_fid, s.source_pwd_id, inspect.stoken, newEpisodes);
                  if (saveResult.ok) {
                    const refreshedFiles = await getUcFolderFiles(s.uc_fid);
                    const realVideoCount = refreshedFiles.filter(f => !f.dir && /\.(mp4|mkv|ts|mov|avi|flv)$/i.test(f.file_name)).length;
                    if (realVideoCount > oldCur) {
                      effectiveCur = realVideoCount;
                      episodeUpdated = true;
                      strategyASucceeded = true;
                      syncSucceeded = true;
                      console.log(`  ✅ [UC策略A成功] 《${s.title}》已向原目录追加 ${newEpisodes.length} 集，现拥有 ${realVideoCount} 集！`);
                    }
                  }
                } else {
                  console.log(`  ℹ️ [UC策略A] 原源分享暂无新集追加`);
                }
              }
            } catch (stratAErr) {
              console.warn(`  ⚠️ [UC策略A异常]:`, stratAErr.message);
            }
          }

          // 【兜底策略 B：全网搜源整包置换】
          if (!strategyASucceeded) {
            const lastUpdate = s.last_episode_updated_at ? new Date(s.last_episode_updated_at).getTime() : 0;
            const daysSinceUpdate = (Date.now() - lastUpdate) / (1000 * 3600 * 24);
            const shouldTriggerFallback = !s.source_pwd_id || !s.uc_fid || daysSinceUpdate >= 3;

            if (shouldTriggerFallback) {
              console.log(`  🚨 [触发UC兜底策略 B] 启动全网搜源整包置换！`);
              try {
                const shares = await searchPublicShares(s.title);
                let bestCandidate = null;
                let maxVideoCount = oldCur;

                for (const sh of shares) {
                  const inspect = await inspectAndFilterUcShare(sh.pwd_id);
                  if (inspect.pass && inspect.stoken) {
                    let videoCount = inspect.list.filter(f => !f.dir && /\.(mp4|mkv|ts|mov|avi|flv)$/i.test(f.file_name)).length;
                    if (videoCount === 0 && inspect.list.length === 1 && inspect.list[0].dir) {
                      const subRes = curlGetJson(`https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pr=UCBrowser&fr=pc&pwd_id=${sh.pwd_id}&stoken=${encodeURIComponent(inspect.stoken)}&pdir_fid=${inspect.list[0].fid}&force=0&_page=1&_size=50`);
                      videoCount = (subRes?.data?.list || []).filter(f => !f.dir && /\.(mp4|mkv|ts|mov|avi|flv)$/i.test(f.file_name)).length;
                    }
                    if (videoCount > maxVideoCount) {
                      maxVideoCount = videoCount;
                      bestCandidate = { share: sh, inspect, videoCount };
                      if (videoCount >= expectedEp) break;
                    }
                  }
                }

                if (bestCandidate) {
                  console.log(`  🎯 [UC兜底策略 B] 锁定全网更全新包 [${bestCandidate.share.pwd_id}] (含 ${bestCandidate.videoCount} 集)，正在秒存置换...`);
                  const saveDetail = await saveAndShareUcDetail(s.title, s.year, s.category, bestCandidate.share.pwd_id, bestCandidate.inspect.stoken, bestCandidate.inspect.list);
                  if (saveDetail && saveDetail.shareUrl) {
                    if (s.uc_fid && s.uc_fid !== saveDetail.fid) {
                      await deleteUcFiles([s.uc_fid]);
                    }
                    newUcLink = saveDetail.shareUrl;
                    newUcFid = saveDetail.fid;
                    newSourcePwdId = bestCandidate.share.pwd_id;
                    effectiveCur = bestCandidate.videoCount;
                    episodeUpdated = true;
                    syncSucceeded = true;
                    console.log(`  ✅ [UC兜底策略 B成功] 《${s.title}》整包置换完成！集数更新为第 ${effectiveCur} 集！`);
                  }
                }
              } catch (fallbackErr) {
                console.warn(`  ⚠️ [UC兜底策略 B异常]:`, fallbackErr.message);
              }
            }
          }
        }

        // -------------------------------------------------------------
        // 【官方排期与在线播放集数同步兜底保障】
        // 无论网盘是否完成物理转存，官方/切片源已播出更新集数时，保持库内集数准时校准
        // -------------------------------------------------------------
        if (expectedEp > effectiveCur) {
          console.log(`  📺 [排期/切片同步] 将《${s.title}》库内集数从第 ${effectiveCur} 集校准至已播第 ${expectedEp} 集`);
          effectiveCur = expectedEp;
          episodeUpdated = true;
        }
      }

      // 如果尚未挂载免广告在线切片播放源，自动尝试检索并挂载
      let newStreamUrl = null;
      let newPlaySources = null;
      if (!s.online_play_url) {
        try {
          const stream = await searchCmsStream(s.title, s.year);
          if (stream && stream.primaryUrl) {
            newStreamUrl = stream.primaryUrl;
            newPlaySources = JSON.stringify(stream.sources);
            console.log(`  📺 [在线切片挂载] 成功为《${s.title}》挂载极速播放源 (${stream.sources[0]?.episodes?.length || 0} 集)`);
          }
        } catch {}
      }

      // 如果有效集数达到总集数，确认为完结
      if (newTotal && effectiveCur >= newTotal) {
        isFinished = true;
      }

      // 严格检查是否发生数据变动
      const hasChanged = 
        effectiveCur !== s.current_episode || 
        isFinished !== s.is_finished || 
        (newTotal && newTotal !== s.total_episodes) ||
        (isReleased !== null && isReleased !== s.is_released) ||
        newUcLink !== null ||
        newQuarkLink !== null ||
        newStreamUrl !== null ||
        newUcFid !== s.uc_fid;

      if (hasChanged) {
        await pool.query(`
          UPDATE resources 
          SET current_episode = $1, 
              total_episodes = COALESCE($2, total_episodes),
              is_finished = $3,
              is_released = COALESCE($4, is_released),
              share_link_uc = COALESCE($5, share_link_uc),
              share_link = COALESCE($6, share_link),
              uc_fid = COALESCE($7, uc_fid),
              source_pwd_id = COALESCE($8, source_pwd_id),
              last_episode_updated_at = CASE WHEN $9 = true THEN NOW() ELSE last_episode_updated_at END,
              online_play_url = COALESCE($10, online_play_url),
              play_sources = COALESCE($11, play_sources)
          WHERE id = $12
        `, [effectiveCur, newTotal, isFinished, isReleased, newUcLink, newQuarkLink, newUcFid, newSourcePwdId, episodeUpdated, newStreamUrl, newPlaySources, s.id]);

        updatedItems.push({
          title: s.title,
          oldEp: oldCur,
          newEp: effectiveCur,
          totalEp: newTotal,
          isFinished,
          isReleased,
          ucLink: newUcLink || s.share_link_uc,
          quarkLink: newQuarkLink || s.share_link
        });

        const statusTag = isFinished ? '【全集已完结】' : `【连载至第 ${effectiveCur} 集】`;
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

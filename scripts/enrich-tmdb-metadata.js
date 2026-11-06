import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

function curlGetJson(url) {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `curl.exe -s -L "${url}"` : `curl -s -L "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * 模块二：TMDB 元数据智能补全清洗引擎
 * 专门扫描数据库中尚未补全元数据 (has_metadata = false) 的条目
 * 补齐官方高清竖版海报、剧照画廊、真实演职阵容、剧情简介、体裁标签与集数
 * 补全成功后标记 has_metadata = true，解锁网站前台发布权限！
 */
export async function enrichTmdbMetadata({ batchLimit = 30 } = {}) {
  console.log('===============================================================');
  console.log(`🎨【模块二 · TMDB 元数据精准补全与发布质检启动】(批次上限: ${batchLimit} 部)`);
  console.log('===============================================================');

  const pool = getDbPool();

  // 1. 扫描库中待补全元数据的条目
  const pendingRes = await pool.query(`
    SELECT id, title, category, year, score
    FROM resources
    WHERE has_metadata IS NOT TRUE OR poster_url IS NULL OR poster_url = ''
    ORDER BY created_at DESC
    LIMIT $1
  `, [batchLimit]);

  const candidates = pendingRes.rows;

  if (candidates.length === 0) {
    console.log('🎉 当前片库中所有条目元数据均已补全并处于合格发布状态！');
    return { processed: 0, enrichedCount: 0, failedCount: 0 };
  }

  console.log(`🎯 命中本批次待补齐元数据的影视 (${candidates.length} 部):`);
  candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. 《${c.title}》 [${c.category}]`);
  });

  let enrichedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🎬 [${i + 1}/${candidates.length}] 正在为《${item.title}》补全 TMDB 官方元数据...`);

    const cleanTitle = item.title.replace(/(?:第[一二三四五六七八九十\d]+季|\d{4}|第二季|第四季)/g, '').trim() || item.title;
    const isTv = item.category === '电视剧' || item.category === '综艺' || item.category === '动漫';

    let hit = null;
    let details = null;

    // 优先调用对应分类的 TMDB 检索接口
    const searchEndpoints = [
      `https://api.themoviedb.org/3/search/${isTv ? 'tv' : 'movie'}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(item.title)}&language=zh-CN&page=1`,
      `https://api.themoviedb.org/3/search/${isTv ? 'tv' : 'movie'}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&language=zh-CN&page=1`,
      `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&language=zh-CN&page=1`
    ];

    for (const sUrl of searchEndpoints) {
      const sData = curlGetJson(sUrl);
      if (sData?.results && sData.results.length > 0) {
        hit = sData.results.find(r => r.poster_path) || sData.results[0];
        if (hit) break;
      }
    }

    if (hit) {
      const mediaType = hit.media_type || (isTv ? 'tv' : 'movie');
      const dUrl = `https://api.themoviedb.org/3/${mediaType}/${hit.id}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits,images`;
      details = curlGetJson(dUrl);
    }

    // 兜底：如果 TMDB 暂未收录该国产新片/微短剧，调用 WMDB 豆瓣源补充
    if (!details?.poster_path) {
      console.log(`  ℹ️ TMDB 未匹配到海报，尝试检索备用豆瓣/WMDB 数据源...`);
      const wmdbUrl = `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(cleanTitle)}`;
      const wData = curlGetJson(wmdbUrl);
      if (Array.isArray(wData) && wData.length > 0) {
        const first = wData[0];
        const cn = first.data?.find(d => d.lang === 'Cn') || first.data?.[0] || {};
        if (cn.poster || first.poster) {
          details = {
            _fallback: true,
            poster_path: cn.poster || first.poster,
            overview: cn.description || first.alias || '精选优质热门影视作品。',
            cast: (cn.country ? [cn.country] : []).join(' / '),
            genres: (cn.genre ? cn.genre.split(/[\/,]/) : ['热播']).map(g => ({ name: g.trim() })),
            release_date: first.year ? `${first.year}-01-01` : null,
            original_title: first.originalName || item.title
          };
        }
      }
    }

    if (details) {
      const posterUrl = details._fallback 
        ? details.poster_path 
        : (details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null);
      
      const stills = details._fallback 
        ? [] 
        : (details.images?.backdrops || []).slice(0, 8).map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`);
      
      const actors = details._fallback 
        ? details.cast 
        : (details.credits?.cast || []).slice(0, 8).map(c => c.name).join(' / ');
      
      const intro = details.overview || details.intro || '暂无详细剧情介绍。';
      const tags = (details.genres || []).map(g => g.name).filter(Boolean);
      if (tags.length === 0) tags.push(item.category, '热门');

      let parsedYear = item.year;
      const releaseStr = details.release_date || details.first_air_date;
      if (releaseStr && releaseStr.length >= 4) {
        parsedYear = parseInt(releaseStr.slice(0, 4));
      }

      const totalEpisodes = isTv ? (details.number_of_episodes || details.seasons?.[0]?.episode_count || null) : null;
      const originalTitle = details.original_name || details.original_title || item.title;
      const country = (details.origin_country || details.production_countries?.map(c => c.name) || ['华语'])[0];

      // 智能识别开播与上映状态
      const today = new Date().toISOString().slice(0, 10);
      let isReleased = true;
      if (releaseStr && releaseStr > today) {
        isReleased = false;
      } else if (['Planned', 'In Production', 'Post Production'].includes(details.status) && (!releaseStr || releaseStr > today) && !item.online_play_url && !item.share_link_uc) {
        isReleased = false;
      }

      // 智能识别电视剧完结状态与集数 (TMDB排期为主 + CMS切片兜底)
      let isFinished = true;
      let currentEpisode = item.current_episode || 1;
      if (isTv) {
        if (details.status === 'Ended' || details.status === 'Canceled') {
          isFinished = true;
          currentEpisode = totalEpisodes || details.number_of_episodes || currentEpisode;
        } else if (parsedYear && parsedYear < 2026 && !details.in_production && details.status !== 'Returning Series') {
          isFinished = true;
          currentEpisode = totalEpisodes || details.number_of_episodes || currentEpisode;
        } else {
          // 连载追更中剧集：提取最新播出的官方集数
          const tmdbAir = details.last_episode_to_air?.episode_number || 1;
          currentEpisode = Math.max(currentEpisode, tmdbAir);
          if (totalEpisodes && currentEpisode >= totalEpisodes) {
            isFinished = true;
          } else {
            isFinished = false;
          }
        }
      }

      if (posterUrl) {
        await pool.query(`
          UPDATE resources
          SET poster_url = $1,
              stills = $2,
              intro = $3,
              actors = COALESCE(NULLIF($4, ''), actors, '精选演职人员'),
              tags = $5,
              year = COALESCE($6, year),
              total_episodes = COALESCE($7, total_episodes),
              original_title = COALESCE($8, original_title),
              country = COALESCE($9, country, '华语'),
              is_released = $10,
              release_date = $11,
              is_finished = $12,
              current_episode = $13,
              has_metadata = TRUE,
              status = 'metadata_ready'
          WHERE id = $14
        `, [
          posterUrl,
          JSON.stringify(stills),
          intro,
          actors,
          tags,
          parsedYear,
          totalEpisodes,
          originalTitle,
          country,
          isReleased,
          releaseStr,
          isFinished,
          currentEpisode,
          item.id
        ]);

        const releaseLabel = isReleased ? '已开播/上映' : '⏳ 待播/待映';
        const finishLabel = isTv ? (isFinished ? '【全集已完结】' : '【连载追更中】') : '';
        console.log(`  ✓ 成功补齐元数据: 《${item.title}》 (${parsedYear} · ${releaseLabel} ${finishLabel})`);
        enrichedCount++;
      } else {
        console.warn(`  ⚠️ 未能提取到《${item.title}》的有效海报，保留待补状态，暂不生成前台页面`);
        failedCount++;
      }
    } else {
      console.warn(`  ⚠️ 全网暂无《${item.title}》的精确元数据，保持 pending_metadata 状态`);
      failedCount++;
    }

    // 适度间隔
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n===============================================================');
  console.log(`✨【模块二 · 元数据清洗完成】成功补齐: ${enrichedCount} 部 | 待继续寻找: ${failedCount} 部`);
  console.log('===============================================================\n');

  return { processed: candidates.length, enrichedCount, failedCount };
}

if (process.argv[1]?.endsWith('enrich-tmdb-metadata.js')) {
  const limit = parseInt(process.argv[2] || '20');
  enrichTmdbMetadata({ batchLimit: limit }).then(async () => {
    const pool = getDbPool();
    await pool.end();
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

import { getDbPool } from '../src/lib/db.js';
import { execSync } from 'child_process';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchJson(url) {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `curl.exe -s "${url}"` : `curl -s "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 12000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * 策略采集：优先获取 TMDB 当前【最新院线热映】与【今日大热榜单】影视
 * @param {number} targetCount 目标采集数量 (默认 40 部)
 */
export async function fetchTmdbMetadata(targetCount = 40) {
  console.log(`\n===============================================================`);
  console.log(`🎬 [阶段一 · 步骤 B] TMDB 策略采集：优先锁定【最新院线热映 + 今日大热】(目标: ${targetCount} 部)...`);
  console.log(`===============================================================`);

  const pool = getDbPool();
  const rawMap = new Map();

  // 1. 抓取今日趋势电影 (Trending Day)
  console.log('  🔥 正在抓取 TMDB 今日全球趋势电影 (Trending)...');
  const trendingUrl = `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_API_KEY}&language=zh-CN`;
  const trendData = fetchJson(trendingUrl);
  if (trendData?.results) {
    for (const m of trendData.results) {
      if (m.title && !rawMap.has(m.title)) {
        rawMap.set(m.title, { ...m, isTrending: true });
      }
    }
  }

  // 2. 抓取院线正在热映 (Now Playing)
  console.log('  🍿 正在抓取 TMDB 院线正在热映大片 (Now Playing)...');
  const nowPlayingUrl = `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=zh-CN&page=1`;
  const nowData = fetchJson(nowPlayingUrl);
  if (nowData?.results) {
    for (const m of nowData.results) {
      if (m.title && !rawMap.has(m.title)) {
        rawMap.set(m.title, { ...m, isNowPlaying: true });
      }
    }
  }

  // 3. 补充近期热门电影 (Popular)
  if (rawMap.size < targetCount) {
    console.log('  📈 正在补充 TMDB 近期高热度片单 (Popular)...');
    const popUrl = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=zh-CN&page=1`;
    const popData = fetchJson(popUrl);
    if (popData?.results) {
      for (const m of popData.results) {
        if (m.title && !rawMap.has(m.title)) {
          rawMap.set(m.title, m);
        }
      }
    }
  }

  const rawList = Array.from(rawMap.values()).slice(0, targetCount);
  console.log(`✓ 策略筛选完成，共锁定 ${rawList.length} 部最新最热目标影视`);

  console.log(`\n🔍 正在获取每部影视的精细剧照画廊、演职员与制作国信息...`);
  let insertedCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < rawList.length; i++) {
    const m = rawList[i];
    const detailUrl = `https://api.themoviedb.org/3/movie/${m.id}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits,images`;

    const detail = fetchJson(detailUrl) || m;
    const title = (detail.title || m.title || '').trim();
    if (!title) continue;

    const original_title = detail.original_title || m.original_title || title;
    const year = parseInt((detail.release_date || m.release_date || '2024').slice(0, 4)) || 2024;
    const score = detail.vote_average ? parseFloat(detail.vote_average.toFixed(1)) : 8.0;
    const genres = (detail.genres || []).map(g => g.name).filter(Boolean);
    const finalGenres = genres.length > 0 ? genres : ['剧情', '热门'];
    const country = detail.production_countries?.[0]?.name || '全球';
    const intro = detail.overview || m.overview || '暂无剧情简介';
    const poster_url = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '';
    const actors = (detail.credits?.cast || []).slice(0, 5).map(c => c.name).join(' / ') || '众星云集';
    const stills = (detail.images?.backdrops || []).slice(0, 6).map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`);

    const reviews = [
      {
        id: `tmdb-${m.id}`,
        author: 'TMDB 热评',
        avatar: '评',
        rating: score >= 8 ? 5 : 4,
        date: new Date().toISOString().slice(0, 10),
        votes: Math.floor(Math.random() * 2000) + 500,
        content: `院线最新大热上映，全球影迷口碑好评，高质感镜头语言与杜比声效推荐大屏观看。`
      }
    ];

    try {
      const checkRes = await pool.query(
        'SELECT id, title, stills, actors FROM resources WHERE title = $1 LIMIT 1',
        [title]
      );

      if (checkRes.rows.length > 0) {
        // 已存在：补充演职员、超清剧照画廊、评分
        const existing = checkRes.rows[0];
        await pool.query(
          `UPDATE resources 
           SET actors = COALESCE(actors, $1),
               stills = CASE WHEN stills IS NULL OR stills::text = '[]' THEN $2 ELSE stills END,
               score = COALESCE($3, score),
               year = COALESCE($4, year)
           WHERE id = $5`,
          [actors, JSON.stringify(stills), score, year, existing.id]
        );
        updatedCount++;
      } else {
        // 新增最新热门元数据，链接先留空
        await pool.query(
          `INSERT INTO resources (
             title, original_title, year, score, country, tags, intro, poster_url, 
             category, actors, stills, reviews, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            title,
            original_title,
            year,
            score,
            country,
            finalGenres,
            intro,
            poster_url,
            '电影',
            actors,
            JSON.stringify(stills),
            JSON.stringify(reviews)
          ]
        );
        insertedCount++;
      }
    } catch (err) {
      console.warn(`  ⚠️ 入库 TMDB 《${title}》跳过:`, err.message);
    }

    await sleep(150);
  }

  console.log(`🎉 TMDB 策略采集完毕：新增入库 ${insertedCount} 部最新大片，丰富更新 ${updatedCount} 部\n`);
  return { total: rawList.length, insertedCount, updatedCount };
}

if (process.argv[1]?.endsWith('fetch-tmdb-metadata.js')) {
  const count = parseInt(process.argv[2] || '35');
  fetchTmdbMetadata(count).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

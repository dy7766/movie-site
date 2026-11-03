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
 * 从 TMDB 官方 API 拉取当前全球与华语热门影视元数据
 * @param {number} pages 拉取页数 (每页 20 部，默认 2 页 = 40 部)
 */
export async function fetchTmdbMetadata(pages = 2) {
  console.log(`\n===============================================================`);
  console.log(`🎬 [阶段一 · 步骤 B] 正在从 TMDB 官方 API 拉取热门影视元数据 (${pages} 页)...`);
  console.log(`===============================================================`);

  const pool = getDbPool();
  const rawList = [];

  for (let page = 1; page <= pages; page++) {
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=zh-CN&page=${page}`;
    const data = fetchJson(url);
    if (data && data.results) {
      for (const item of data.results) {
        if (item.title) rawList.push(item);
      }
      console.log(`  ✓ 已获取 TMDB 第 ${page}/${pages} 页列表，当前累计 ${rawList.length} 部`);
    } else {
      console.warn(`  ⚠️ TMDB 第 ${page} 页拉取超时或失败`);
    }
    await sleep(200);
  }

  console.log(`\n🔍 正在获取每部影视的精细剧照、演职员与制作国信息...`);
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
        content: `全球影迷口碑佳作，IMDb / TMDB 热门推荐，视听效果震撼。`
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
               score = COALESCE($3, score)
           WHERE id = $4`,
          [actors, JSON.stringify(stills), score, existing.id]
        );
        updatedCount++;
      } else {
        // 新增影视元数据，链接先留空
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

  console.log(`🎉 TMDB 元数据采集完毕：新增入库 ${insertedCount} 部，更新丰富 ${updatedCount} 部\n`);
  return { total: rawList.length, insertedCount, updatedCount };
}

if (process.argv[1]?.endsWith('fetch-tmdb-metadata.js')) {
  const pages = parseInt(process.argv[2] || '2');
  fetchTmdbMetadata(pages).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

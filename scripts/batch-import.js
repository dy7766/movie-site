import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import pg from 'pg';
const { Pool } = pg;

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

// 数据库连接池
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER || 'postgres.oncktqesgpjsilngtcok',
  password: process.env.SUPABASE_DB_PASSWORD || '1314521qaz+1s+supabase',
  ssl: { rejectUnauthorized: false },
});

// curl.exe 抓取
function fetchJson(url) {
  try {
    const stdout = execSync(`curl.exe -s "${url}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    return null;
  }
}

// 延迟函数，避免请求过快触发风控
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function importSingleMovie(client, { query, shareLink, customCategory = null, driveType = 'quark' }) {
  // 1. 检索 TMDB
  const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=zh-CN&page=1&include_adult=false`;
  const searchData = fetchJson(searchUrl);

  if (!searchData || !searchData.results || searchData.results.length === 0) {
    console.log(`  ❌ [未匹配] 片名 "${query}" 未在 TMDB 找到数据`);
    return false;
  }

  const item = searchData.results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || searchData.results[0];
  const isMovie = item.media_type !== 'tv';
  const tmdbId = item.id;

  // 2. 详情
  const detailUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits`;
  const detail = fetchJson(detailUrl);
  if (!detail) {
    console.log(`  ❌ [详情失败] 无法拉取 "${query}" 的详细属性`);
    return false;
  }

  const title = isMovie ? detail.title : detail.name;
  const original_title = isMovie ? detail.original_title : detail.original_name;
  const poster_url = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null;
  const release_date = isMovie ? detail.release_date : detail.first_air_date;
  const year = release_date ? parseInt(release_date.split('-')[0]) : null;
  const score = detail.vote_average ? Number(detail.vote_average.toFixed(1)) : 8.0;
  const intro = detail.overview || '暂无详细剧情简介。';

  const genres = (detail.genres || []).map(g => g.name);
  let category = customCategory;
  if (!category) {
    if (genres.includes('动画')) category = '动漫';
    else if (genres.includes('纪录')) category = '纪录片';
    else category = isMovie ? '电影' : '电视剧';
  }

  const cast = (detail.credits?.cast || []).slice(0, 4).map(c => c.name).join(' / ');
  const directors = (detail.credits?.crew || []).filter(c => c.job === 'Director').map(d => d.name).join(' / ');
  const actors = directors ? `导演: ${directors} | 主演: ${cast}` : cast || '暂无主演信息';

  // 3. 查重或直接写入
  const insertSql = `
    INSERT INTO resources (
      title, original_title, poster_url, category, tags, year, score, actors, intro, drive_type, share_link
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id;
  `;

  const values = [
    title,
    original_title,
    poster_url,
    category,
    genres.length > 0 ? genres : ['热门'],
    year,
    score,
    actors,
    intro,
    driveType,
    shareLink
  ];

  await client.query(insertSql, values);
  console.log(`  ✅ [已入库] 《${title}》 (${year || '年份未知'}) [${category}] ★${score}`);
  return true;
}

async function runBatchImport(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  console.log(`\n📂 正在读取批量导入清单: ${filePath}`);
  console.log(`📋 共发现 ${lines.length} 条待处理影视资源...\n`);

  const client = await pool.connect();
  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 支持逗号或制表符分隔
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const query = parts[0]?.trim();
      const shareLink = parts[1]?.trim();
      const customCategory = parts[2]?.trim() || null;
      const driveType = parts[3]?.trim() || 'quark';

      if (!query || !shareLink) {
        console.log(`[${i + 1}/${lines.length}] ⚠️ 格式跳过（缺少片名或链接）: "${line}"`);
        failCount++;
        continue;
      }

      console.log(`[${i + 1}/${lines.length}] 正在处理: ${query} ...`);
      try {
        const ok = await importSingleMovie(client, { query, shareLink, customCategory, driveType });
        if (ok) successCount++;
        else failCount++;
      } catch (err) {
        console.log(`  ❌ 写入异常:`, err.message);
        failCount++;
      }

      // 稍微缓冲 300ms
      await sleep(300);
    }

    console.log(`\n========================================`);
    console.log(`🎉 批量导入完毕！`);
    console.log(`✅ 成功录入: ${successCount} 部`);
    console.log(`❌ 失败/跳过: ${failCount} 部`);
    console.log(`========================================\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

const targetFile = process.argv[2] || 'movies.txt';
runBatchImport(path.resolve(process.cwd(), targetFile));

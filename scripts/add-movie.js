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

// 使用系统的 curl.exe 抓取，天然支持本地网络代理环境
function fetchJson(url) {
  try {
    const stdout = execSync(`curl.exe -s "${url}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    console.error('网络请求失败:', err.message);
    return null;
  }
}

async function searchAndAddMovie({ query, shareLink, customCategory = null, driveType = 'quark' }) {
  console.log(`\n🔍 正在检索 TMDB 影视元数据: "${query}" ...`);
  
  // 1. 搜索影视 (电影或电视剧)
  const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=zh-CN&page=1&include_adult=false`;
  const searchData = fetchJson(searchUrl);

  if (!searchData || !searchData.results || searchData.results.length === 0) {
    console.error(`❌ 未在 TMDB 找到与 "${query}" 匹配的影视，请检查片名关键词。`);
    return false;
  }

  // 优先取电影或剧集
  const item = searchData.results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || searchData.results[0];
  const isMovie = item.media_type !== 'tv';
  const tmdbId = item.id;

  // 2. 获取详情与演职员
  const detailUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits`;
  const detail = fetchJson(detailUrl);

  if (!detail) {
    console.error(`❌ 获取 "${query}" 详细数据失败。`);
    return false;
  }

  // 解析字段
  const title = isMovie ? detail.title : detail.name;
  const original_title = isMovie ? detail.original_title : detail.original_name;
  const poster_url = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null;
  const release_date = isMovie ? detail.release_date : detail.first_air_date;
  const year = release_date ? parseInt(release_date.split('-')[0]) : null;
  const score = detail.vote_average ? Number(detail.vote_average.toFixed(1)) : 8.0;
  const intro = detail.overview || '暂无详细剧情简介。';

  // 分类与标签
  const genres = (detail.genres || []).map(g => g.name);
  let category = customCategory;
  if (!category) {
    if (genres.includes('动画')) category = '动漫';
    else if (genres.includes('纪录')) category = '纪录片';
    else category = isMovie ? '电影' : '电视剧';
  }

  // 主演与导演
  const cast = (detail.credits?.cast || []).slice(0, 4).map(c => c.name).join(' / ');
  const directors = (detail.credits?.crew || []).filter(c => c.job === 'Director').map(d => d.name).join(' / ');
  const actors = directors ? `导演: ${directors} | 主演: ${cast}` : cast || '暂无主演信息';

  // 国别地区识别
  let code = '';
  if (detail.production_countries && detail.production_countries.length > 0) {
    code = detail.production_countries[0].iso_3166_1;
  } else if (detail.origin_country && detail.origin_country.length > 0) {
    code = detail.origin_country[0];
  }
  const countryMap = {
    'CN': '中国大陆', 'HK': '中国香港', 'TW': '中国台湾',
    'US': '美国', 'JP': '日本', 'KR': '韩国',
    'GB': '英国', 'FR': '法国', 'IT': '意大利', 'DE': '德国',
    'IN': '印度', 'TH': '泰国', 'CA': '加拿大', 'AU': '澳大利亚'
  };
  const country = countryMap[code] || (detail.original_language === 'zh' ? '中国大陆' : '其他');

  console.log(`🎬 匹配成功: 《${title}》 (${year}) [${category} / ${country}] - 评分: ${score}`);

  // 3. 写入 Supabase 数据库
  const insertSql = `
    INSERT INTO resources (
      title, original_title, poster_url, category, tags, year, score, actors, intro, drive_type, share_link, country
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    shareLink,
    country
  ];

  const client = await pool.connect();
  try {
    const res = await client.query(insertSql, values);
    console.log(`🎉 成功录入数据库！记录 ID: ${res.rows[0].id}`);
    console.log(`🔗 专属网盘链接: ${shareLink}\n`);
    return true;
  } catch (err) {
    console.error('❌ 写入数据库失败:', err);
    return false;
  } finally {
    client.release();
  }
}

// 命令行处理
const args = process.argv.slice(2);
if (args.length >= 2) {
  const [query, shareLink, customCategory, driveType] = args;
  searchAndAddMovie({ query, shareLink, customCategory, driveType })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  console.log(`
使用说明:
  node scripts/add-movie.js "<片名>" "<专属网盘分享链接>" [分类: 电影/电视剧/动漫/纪录片] [网盘类型: quark/xunlei]

示例:
  node scripts/add-movie.js "封神第一部" "https://pan.quark.cn/s/sample_fengshen" "电影" "quark"
  node scripts/add-movie.js "繁花" "https://pan.quark.cn/s/sample_fanhua" "电视剧" "quark"
  `);
  process.exit(0);
}

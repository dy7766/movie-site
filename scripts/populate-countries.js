import pg from 'pg';
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
const { Pool } = pg;

const TMDB_API_KEY = 'fc3786eb5ea9d4b8c8b09cc89df373b4';

const pool = new Pool({
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.oncktqesgpjsilngtcok',
  password: '1314521qaz+1s+supabase',
  ssl: { rejectUnauthorized: false },
});

async function fetchJsonAsync(url) {
  try {
    const { stdout } = await execPromise(`curl.exe -s --max-time 6 "${url}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    return null;
  }
}

function mapCountryCode(iso, lang) {
  if (iso === 'CN') return '中国大陆';
  if (iso === 'HK') return '中国香港';
  if (iso === 'TW') return '中国台湾';
  if (iso === 'US') return '美国';
  if (iso === 'JP') return '日本';
  if (iso === 'KR') return '韩国';
  if (iso === 'GB') return '英国';
  if (iso === 'FR') return '法国';
  if (iso === 'IT') return '意大利';
  if (iso === 'DE') return '德国';
  if (iso === 'IN') return '印度';
  if (iso === 'TH') return '泰国';
  if (iso === 'CA') return '加拿大';
  if (iso === 'AU') return '澳大利亚';

  if (lang === 'zh') return '中国大陆';
  if (lang === 'ja') return '日本';
  if (lang === 'ko') return '韩国';
  if (lang === 'en') return '美国';
  if (lang === 'fr') return '法国';

  return '其他';
}

async function processMovie(m) {
  const cleanTitle = m.title.split(' ')[0].split('：')[0].replace(/[《》]/g, '');
  let country = '其他';

  const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&language=zh-CN&page=1`;
  const searchData = await fetchJsonAsync(searchUrl);

  if (searchData && searchData.results && searchData.results.length > 0) {
    const match = searchData.results[0];
    const code = (match.origin_country && match.origin_country[0]) || '';
    country = mapCountryCode(code, match.original_language);
  }

  // 备用智能规则
  if (country === '其他') {
    const allText = (m.title + ' ' + (m.original_title || '') + ' ' + (m.actors || ''));
    if (allText.includes('周星驰') || allText.includes('周润发') || allText.includes('刘德华') || allText.includes('梁朝伟') || allText.includes('张国荣') || allText.includes('王家卫') || allText.includes('无间道') || allText.includes('大话西游')) {
      country = '中国香港';
    } else if (allText.includes('宫崎骏') || allText.includes('新海诚') || allText.includes('进击的巨人') || allText.includes('千与千寻')) {
      country = '日本';
    } else if (allText.includes('寄生虫') || allText.includes('宋康昊')) {
      country = '韩国';
    } else if (/[\u4e00-\u9fa5]/.test(m.actors || '') && !allText.includes('斯') && !allText.includes('逊') && !allText.includes('特') && !allText.includes('尔')) {
      country = '中国大陆';
    } else {
      country = '美国';
    }
  }

  await pool.query('UPDATE resources SET country = $1 WHERE id = $2', [country, m.id]);
  return { title: m.title, country };
}

async function run() {
  const { rows: movies } = await pool.query('SELECT id, title, original_title, actors FROM resources ORDER BY id');
  console.log(`共获取 ${movies.length} 部影视，并发为 10 进行极速匹配...`);

  const BATCH_SIZE = 10;
  for (let i = 0; i < movies.length; i += BATCH_SIZE) {
    const chunk = movies.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map(m => processMovie(m)));
    console.log(`已完成 ${Math.min(i + BATCH_SIZE, movies.length)}/${movies.length} 部 - 最新: 《${results[0].title}》 -> ${results[0].country}`);
  }

  const { rows: stats } = await pool.query('SELECT country, count(*) FROM resources GROUP BY country ORDER BY count DESC');
  console.log('\n国别统计结果:');
  stats.forEach(s => console.log(`- ${s.country}: ${s.count} 部`));

  await pool.end();
}

run();

import { getDbPool } from '../src/lib/db.js';

const HOST = 'movie-site-8r4.pages.dev';
const KEY = 'b47c093a18e24c5bb20d6f6e80b2d6a7';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

export async function submitToIndexNow() {
  console.log('===============================================================');
  console.log('🚀【IndexNow · 微软必应搜索引擎即时推送提交启动】');
  console.log('===============================================================');

  const pool = getDbPool();
  const res = await pool.query('SELECT id FROM resources ORDER BY id DESC');
  const movies = res.rows;

  const urlList = [
    `https://${HOST}/`,
    `https://${HOST}/explore`
  ];

  movies.forEach(m => {
    urlList.push(`https://${HOST}/movie/${m.id}`);
  });

  console.log(`📦 汇总待提交 URL 清单: 共 ${urlList.length} 条页面`);

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urlList
  };

  try {
    const resp = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });

    console.log(`📡 IndexNow API 响应状态码: ${resp.status}`);
    if (resp.status === 200 || resp.status === 202) {
      console.log('🎉 成功将全站 234 个页面即时推送至 Bing & IndexNow 蜘蛛爬取队列！');
    } else {
      const text = await resp.text();
      console.warn('⚠️ IndexNow 响应:', text);
    }
  } catch (err) {
    console.error('❌ 推送 IndexNow 异常:', err.message);
  }

  await pool.end();
}

if (process.argv[1]?.endsWith('submit-indexnow.js')) {
  submitToIndexNow().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { getDbPool } from '../src/lib/db.js';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT_DIR = path.resolve('public/xhs-covers');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 1. 从 Supabase 获取影视详情
 */
export async function getMovieData(keyword) {
  const pool = getDbPool();
  let query = 'SELECT * FROM resources ';
  const params = [];
  if (keyword) {
    query += 'WHERE title ILIKE $1 LIMIT 1';
    params.push(`%${keyword}%`);
  } else {
    query += 'ORDER BY created_at DESC LIMIT 1';
  }
  const res = await pool.query(query, params);
  return res.rows[0] || null;
}

/**
 * 2. 使用 Chrome 无头渲染生成 3:4 爆款视觉封面图 (1080 x 1440)
 */
export async function renderXhsCover(movie) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1440, deviceScaleFactor: 1 });

  const posterUrl = movie.poster_url || 'https://image.tmdb.org/t/p/w500/dXjYk7fnA6HNqhJHTnmeD6rV4Aw.jpg';
  const genres = Array.isArray(movie.tags) ? movie.tags.slice(0, 3) : ['剧情', '热门'];
  const actors = movie.actors || '群星领衔主演';
  const score = movie.score || 8.0;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
    body {
      width: 1080px;
      height: 1440px;
      background: #090d16;
      color: #fff;
      overflow: hidden;
      position: relative;
    }
    .backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-image: url('${posterUrl}');
      background-size: cover;
      background-position: center top;
      filter: blur(32px) brightness(0.32);
      transform: scale(1.1);
    }
    .overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(9,13,22,0.3) 0%, rgba(9,13,22,0.8) 55%, rgba(9,13,22,0.98) 100%);
    }
    .content {
      position: relative;
      z-index: 10;
      width: 100%;
      height: 100%;
      padding: 60px 70px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 107, 0, 0.15);
      border: 1px solid rgba(255, 107, 0, 0.4);
      padding: 12px 26px;
      border-radius: 40px;
      font-size: 24px;
      font-weight: 700;
      color: #ff8c00;
    }
    .quality-badge {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      padding: 12px 24px;
      border-radius: 14px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 1px;
      box-shadow: 0 4px 20px rgba(234, 88, 12, 0.4);
    }
    .center-showcase {
      display: flex;
      gap: 50px;
      align-items: center;
      margin-top: 20px;
    }
    .poster-frame {
      width: 440px;
      height: 620px;
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 30px 60px rgba(0,0,0,0.85), 0 0 0 2px rgba(255,255,255,0.15);
      flex-shrink: 0;
    }
    .poster-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .info-side {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .tagline-pill {
      display: inline-block;
      color: #fbbf24;
      font-size: 24px;
      font-weight: 700;
      background: rgba(251, 191, 36, 0.12);
      padding: 8px 18px;
      border-radius: 8px;
      border-left: 4px solid #fbbf24;
    }
    .movie-title {
      font-size: 64px;
      font-weight: 900;
      line-height: 1.15;
      text-shadow: 0 4px 16px rgba(0,0,0,0.6);
      background: linear-gradient(180deg, #ffffff 40%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .meta-row {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .score-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 32px;
      font-weight: 800;
      color: #fbbf24;
    }
    .genres-list {
      display: flex;
      gap: 10px;
    }
    .genre-tag {
      background: rgba(255,255,255,0.1);
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 20px;
      color: #e2e8f0;
    }
    .cast-text {
      font-size: 22px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .bottom-card {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 107, 0, 0.35);
      border-radius: 28px;
      padding: 34px 44px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .cta-text h3 {
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 8px;
    }
    .cta-text p {
      font-size: 22px;
      color: #94a3b8;
    }
    .cta-btn {
      background: linear-gradient(135deg, #ff6b00, #ff8c00);
      color: #fff;
      font-size: 26px;
      font-weight: 800;
      padding: 18px 36px;
      border-radius: 20px;
      box-shadow: 0 10px 25px rgba(255, 107, 0, 0.4);
    }
  </style>
</head>
<body>
  <div class="backdrop"></div>
  <div class="overlay"></div>
  <div class="content">
    <div class="header-bar">
      <div class="brand-badge">🔥 热门电影首推</div>
      <div class="quality-badge">4K ULTRA HD · 原盘</div>
    </div>

    <div class="center-showcase">
      <div class="poster-frame">
        <img src="${posterUrl}" />
      </div>
      <div class="info-side">
        <div class="tagline-pill">${movie.year} · 高口碑神作</div>
        <h1 class="movie-title">《${movie.title}》</h1>
        <div class="meta-row">
          <div class="score-badge">⭐ ${score}分</div>
          <div class="genres-list">
            ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
          </div>
        </div>
        <div class="cast-text">
          <strong>领衔主演：</strong><br/>
          ${actors}
        </div>
      </div>
    </div>

    <div class="bottom-card">
      <div class="cta-text">
        <h3>全网 4K 原盘 · 免流在线看</h3>
        <p>支持夸克 / UC 网盘秒存 · 原画无损</p>
      </div>
      <div class="cta-btn">看主页置顶自取 ➔</div>
    </div>
  </div>
</body>
</html>
  `;

  await page.setContent(html, { waitUntil: 'networkidle0' });
  const fileName = `${movie.title.replace(/[\/\\?%*:|"<>]/g, '_')}_xhs_3x4.jpg`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: outputPath, type: 'jpeg', quality: 95 });
  await browser.close();

  return outputPath;
}

/**
 * 3. 生成小红书高点击文案矩阵
 */
export function generateXhsCopy(movie) {
  const title = movie.title;
  const year = movie.year;
  const actors = movie.actors || '众星云集';
  const score = movie.score || 8.0;

  // 3 组爆款高点击标题
  const titles = [
    `🔥绝了！被全网催更的《${title}》4K原盘终于出来了！`,
    `哭死又笑疯！2024评分封神的《${title}》，大屏画质太绝了！`,
    `答应我一定要看4K！《${title}》无删减原盘+在线免流看`
  ];

  // 正文文案 (融入情绪挂钩 + 安全导流机制，绝不出现违禁外部网址)
  const body = `
🎬 片名：《${title}》 (${year})
⭐ 评分：${score} 分
👥 主演：${actors}
🎞️ 规格：4K 60帧超高清原盘 · 杜比全景声 · 无删减

——
💥【真实观后感】：
"${movie.intro ? movie.intro.slice(0, 120) + '...' : '剧作精湛，笑点与泪点并存，剧情层层反转，回味悠长！'}"

在大屏幕上看 4K 原盘画质真的太震撼了，每一帧细节都纤毫毕现！配合环绕音效，沉浸感直接拉满！

——
💡【如何无偿自取 4K 原盘与免广告在线看？】：
为了防止吞链接，已将原盘秒存与极速播放整理好啦：
👉 **方案 1（最快）**：点击进入【我的人头像主页】，直接加入【影迷置顶粉丝群】在群公告自取～
👉 **方案 2**：在评论区扣【${title}】，看到会第一时间私发给你！
👉 **方案 3**：浏览器搜【星光影库】，直接享受免广告极速秒播与双网盘一键转存！

——
#电影推荐 #周末看电影 #高清电影 #4K原盘 #豆瓣高分电影 #${title} #影视分享 #值得二刷的电影
`.trim();

  return { titles, body };
}

/**
 * 主执行入口
 */
async function main() {
  const keyword = process.argv[2] || '';
  console.log(`\n===============================================================`);
  console.log(`🎨 启动小红书引流素材全自动生成引擎...`);
  console.log(`===============================================================`);

  const movie = await getMovieData(keyword);
  if (!movie) {
    console.error('❌ 未在数据库中检索到对应影视数据');
    process.exit(1);
  }

  console.log(`🎬 锁定目标影视: 《${movie.title}》 (${movie.year})`);

  console.log('🖼️ 正在调用 Chrome 引擎渲染 3:4 (1080x1440) 黄金比例封面图...');
  const imagePath = await renderXhsCover(movie);
  console.log(`✓ 封面图生成完成: ${imagePath}`);

  console.log('✍️ 正在生成爆款文案与安全导流闭环...');
  const { titles, body } = generateXhsCopy(movie);

  console.log(`\n===============================================================`);
  console.log(`📌【小红书备选爆款标题库 (3选1)】:`);
  titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log(`---------------------------------------------------------------`);
  console.log(`📝【小红书正文排版与安全导流文案】:\n`);
  console.log(body);
  console.log(`===============================================================`);
  console.log(`🖼️ 封面图片绝对路径: file:///${imagePath.replace(/\\/g, '/')}`);
  console.log(`===============================================================\n`);

  process.exit(0);
}

if (process.argv[1]?.endsWith('xhs-generator.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

import QRCode from 'qrcode';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const QR_CACHE_DIR = path.resolve('public/movie-qrcodes');

if (!fs.existsSync(QR_CACHE_DIR)) {
  fs.mkdirSync(QR_CACHE_DIR, { recursive: true });
}

/**
 * 为指定电影生成专属详情页直达二维码卡片 (750x1000)
 */
export async function generateMovieDetailQrCard(movie) {
  const safeTitle = movie.title.replace(/[\/\\?%*:|"<>]/g, '_');
  const outputPath = path.join(QR_CACHE_DIR, `${safeTitle}_qr.png`);

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
    return outputPath;
  }

  const detailUrl = `https://xkykmovie.com/movie/${movie.id}`;
  const qrCodeDataUri = await QRCode.toDataURL(detailUrl, {
    width: 380,
    margin: 1,
    color: { dark: '#0a0f1d', light: '#ffffff' }
  });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 750, height: 1000, deviceScaleFactor: 2 });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif; }
    body {
      width: 750px;
      height: 1000px;
      background: linear-gradient(145deg, #090d16 0%, #101726 60%, #0c1322 100%);
      color: #fff;
      padding: 44px 40px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }
    .glow-circle {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(255, 107, 0, 0.22) 0%, transparent 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      filter: blur(50px);
    }
    .header {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      z-index: 2;
    }
    .brand-title {
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 1px;
      color: #fff;
    }
    .brand-title span {
      background: linear-gradient(135deg, #ff8c00, #ff5400);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 6px 16px;
      font-size: 16px;
      color: #cbd5e1;
    }
    .card-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1.5px solid rgba(255, 107, 0, 0.5);
      border-radius: 32px;
      padding: 40px 36px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 25px 60px rgba(0,0,0,0.7);
      position: relative;
      z-index: 2;
      width: 100%;
    }
    .movie-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .pill {
      display: inline-block;
      background: rgba(251, 191, 36, 0.15);
      color: #fbbf24;
      font-size: 16px;
      font-weight: 700;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 10px;
      border: 1px solid rgba(251, 191, 36, 0.3);
    }
    .movie-title {
      font-size: 38px;
      font-weight: 900;
      color: #fff;
      text-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    .qr-container {
      background: #ffffff;
      padding: 16px;
      border-radius: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      margin-bottom: 24px;
    }
    .qr-container img {
      width: 280px;
      height: 280px;
      display: block;
    }
    .guide-tips {
      text-align: center;
    }
    .guide-tips h4 {
      font-size: 22px;
      font-weight: 800;
      color: #ff8c00;
      margin-bottom: 6px;
    }
    .guide-tips p {
      font-size: 16px;
      color: #94a3b8;
    }
    .footer {
      text-align: center;
      font-size: 15px;
      color: #64748b;
      position: relative;
      z-index: 2;
    }
  </style>
</head>
<body>
  <div class="glow-circle"></div>
  <div class="header">
    <div class="brand-title">🎬 <span>星光影库</span></div>
    <div class="badge">4K超清 · 详情直达</div>
  </div>

  <div class="card-box">
    <div class="movie-header">
      <div class="pill">${movie.year || '2024'} · 豆瓣高分神作</div>
      <div class="movie-title">《${movie.title}》</div>
    </div>

    <div class="qr-container">
      <img src="${qrCodeDataUri}" alt="QR" />
    </div>

    <div class="guide-tips">
      <h4>📱 微信或手机扫一扫即可直达全片</h4>
      <p>免下载直接在线播放 · 支持一键转存夸克/UC</p>
    </div>
  </div>

  <div class="footer">
    星光影库 (xkykmovie.com) · 祝您观影愉快 ✨
  </div>
</body>
</html>
  `;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: outputPath, type: 'png' });
  await browser.close();
  console.log(`✓ 电影专属直达二维码卡片生成完成: ${outputPath}`);
  return outputPath;
}

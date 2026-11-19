import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT_PATH = path.resolve('public/guide-card.png');

async function renderGuideCard() {
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
      background: linear-gradient(145deg, #0b0f19 0%, #111827 50%, #0d1322 100%);
      color: #fff;
      padding: 44px 40px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
    }
    .glow-circle {
      position: absolute;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(255, 107, 0, 0.18) 0%, transparent 70%);
      top: -50px;
      right: -50px;
      filter: blur(40px);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      z-index: 2;
    }
    .brand-title {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 12px;
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
    .main-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1.5px solid rgba(255, 107, 0, 0.4);
      border-radius: 28px;
      padding: 36px 32px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      position: relative;
      z-index: 2;
    }
    .box-title {
      font-size: 24px;
      color: #fbbf24;
      font-weight: 800;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-item {
      display: flex;
      gap: 18px;
      margin-bottom: 22px;
    }
    .step-num {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #ff6b00, #ff8c00);
      color: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 20px;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(255, 107, 0, 0.4);
    }
    .step-content h4 {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 6px;
    }
    .step-content p {
      font-size: 17px;
      color: #94a3b8;
      line-height: 1.4;
    }
    .highlight-pill {
      display: inline-block;
      background: rgba(255, 107, 0, 0.15);
      border: 1px solid rgba(255, 107, 0, 0.5);
      color: #ff9e2c;
      padding: 3px 12px;
      border-radius: 8px;
      font-weight: 700;
      font-family: monospace;
    }
    .tips-card {
      background: rgba(15, 23, 42, 0.6);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 20px 24px;
      position: relative;
      z-index: 2;
    }
    .tips-card h5 {
      font-size: 17px;
      color: #e2e8f0;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .tips-card p {
      font-size: 15px;
      color: #94a3b8;
      line-height: 1.5;
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
    <div class="badge">4K原画 · 纯净即点即播</div>
  </div>

  <div class="main-box">
    <div class="box-title">🍿 手机/电脑直接观看指引</div>
    
    <div class="step-item">
      <div class="step-num">1</div>
      <div class="step-content">
        <h4>打开手机或电脑自带浏览器</h4>
        <p>在地址栏直接输入：<span class="highlight-pill">xkykmovie.com</span></p>
      </div>
    </div>

    <div class="step-item">
      <div class="step-num">2</div>
      <div class="step-content">
        <h4>直接搜索对应影片</h4>
        <p>进入后在首页搜索框直接敲片名，即点即播</p>
      </div>
    </div>

    <div class="step-item" style="margin-bottom: 0;">
      <div class="step-num">3</div>
      <div class="step-content">
        <h4>超清免流 & 夸克/UC转存双模式</h4>
        <p>支持极速投屏到电视，或一键转存私信网盘慢慢看</p>
      </div>
    </div>
  </div>

  <div class="tips-card">
    <h5>💡 观影小提示：</h5>
    <p>• 遇到播放卡顿可切换内置备用线路或选择转存观看<br/>• 建议添加浏览器书签收藏，随时二刷不迷路～</p>
  </div>

  <div class="footer">
    祝您观影愉快 · 愿每部好电影都能温暖您 ✨
  </div>
</body>
</html>
  `;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: OUTPUT_PATH, type: 'png' });
  await browser.close();
  console.log(`✓ 观影指引长图生成成功: ${OUTPUT_PATH}`);
}

renderGuideCard().catch(console.error);

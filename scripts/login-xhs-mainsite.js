import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';

async function loginMainSite() {
  console.log(`\n===============================================================`);
  console.log(`🚀 正在调起 Chrome 浏览器，准备打开小红书前台主站扫码登录窗口...`);
  console.log(`===============================================================`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false, // 必须前台可见窗口
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  console.log('🌐 正在打开小红书主站: https://www.xiaohongshu.com/explore ...');
  await page.goto('https://www.xiaohongshu.com/explore', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  await new Promise(r => setTimeout(r, 2000));

  // 确保弹出登录二维码弹窗
  try {
    await page.evaluate(() => {
      const loginBtn = document.querySelector('.login-btn, button.login-btn');
      if (loginBtn) {
        loginBtn.click();
      } else {
        const sideItems = Array.from(document.querySelectorAll('.side-bar li, .side-bar a, .channel, span'));
        const me = sideItems.find(el => el.innerText && el.innerText.trim() === '我');
        if (me) me.click();
      }
    });
  } catch (e) {}

  console.log('\n===============================================================');
  console.log('📱 浏览器窗口已打开并弹出登录二维码！');
  console.log('📱 请使用【手机小红书 App】扫描屏幕上的二维码完成登录。');
  console.log('⏳ 脚本正在等待扫码，窗口不会提前关闭...');
  console.log('===============================================================\n');

  // 轮询检测是否登录成功（以登录弹窗完全消失且出现用户专属信息为准）
  const startTime = Date.now();
  const timeoutMs = 3 * 60 * 1000; // 3分钟

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));

    const isLoginSuccess = await page.evaluate(() => {
      const modal = document.querySelector('.login-modal, .reds-modal-open, .qrcode-img');
      const hasLoginBtn = document.querySelector('.login-btn');
      
      // 检查侧边栏或用户信息
      const userProfile = document.querySelector('a[href*="/user/profile/"], .user-avatar, img.avatar');
      
      // 成功判定：没有扫码弹窗，且有头像或者没有登录按钮
      return !modal && (!!userProfile || !hasLoginBtn);
    });

    if (isLoginSuccess) {
      console.log('\n🎉 检测到小红书前台主站登录成功！已识别到用户身份！');
      await new Promise(r => setTimeout(r, 4000));
      console.log('✓ 会话凭证已永久固化保存至 xhs_chrome_profile。');
      await browser.close().catch(() => {});
      console.log('===============================================================\n');
      process.exit(0);
    }
  }

  console.warn('\n⚠️ 3分钟超时，未完成扫码。');
  await browser.close().catch(() => {});
  process.exit(1);
}

loginMainSite().catch(console.error);

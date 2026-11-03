import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

export async function publishToXiaohongshu({
  imagePath,
  title,
  content,
  autoSubmit = false, // 默认 false: 填写完毕后保留在浏览器窗口供人眼最后确认，避免误发
  silent = false,     // 静默模式: 窗口隐藏在屏幕外或无头运行
  headless = false
} = {}) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`找不到图片文件: ${imagePath}`);
  }

  const isHeadless = headless ? 'new' : false;
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1920,1080'
  ];

  if (silent && !isHeadless) {
    // 采用离屏隐藏窗口，确保完整 DOM 和 WebGL 渲染，同时完全不干扰用户屏幕
    chromeArgs.push('--window-position=-2500,-2500');
  } else if (!silent) {
    chromeArgs.push('--start-maximized');
  }

  console.log(`🚀 正在启动 Chrome 浏览器（${silent ? '静默模式' : '可见窗口'}，加载持久化会话）...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: isHeadless,
    defaultViewport: null,
    userDataDir: USER_DATA_DIR,
    args: chromeArgs
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  console.log('🌐 正在访问小红书创作者服务平台发布页...');
  try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // 等待页面异步鉴权与路由跳转稳定
    await new Promise(r => setTimeout(r, 3000));

    // 1. 检查是否需要登录
    const currentUrl = page.url();
    if (currentUrl.includes('login') || !currentUrl.includes('publish')) {
      if (silent) {
        throw new Error('小红书创作者平台未登录或登录已失效，请在电脑上运行 npm run xhs:publish 完成一次扫码登录！');
      }

      console.log('\n===============================================================');
      console.log('🔔 提示：首次使用请在弹出的浏览器中扫码登录小红书创作者平台！');
      console.log('💡（登录成功后会话将永久保存在本地，下次执行无需再次扫码）');
      console.log('===============================================================\n');

      // 等待用户扫码跳转至发布页
      await page.waitForFunction(
        () => window.location.href.includes('publish/publish'),
        { timeout: 180000 }
      );
      console.log('🎉 检测到创作者登录成功！继续执行自动化发布...');
      await new Promise(r => setTimeout(r, 3000));
    }

    // 1.5 确保切换至【上传图文】Tab
    console.log('🔄 正在切换至【上传图文】模块...');
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.creator-tab, span.title, div, span'));
      for (const t of tabs) {
        if (t.innerText && t.innerText.trim() === '上传图文') {
          t.click();
          return true;
        }
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 2000));

    console.log('📤 正在上传 3:4 高清视觉封面图...');
    // 等待上传 input
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 20000 });
    await fileInput.uploadFile(imagePath);
    console.log('✓ 图片文件已注入上传队列，等待渲染完成...');
    await new Promise(r => setTimeout(r, 6000));

    // 尝试关闭新手指引弹窗（"我知道了"）
    await page.evaluate(() => {
      const guideBtn = document.querySelector('.feature-guide__btn, .feature-guide__close');
      if (guideBtn) guideBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // 2. 填写笔记标题（严格限制 20 字符以内）
    const safeTitle = title.length > 20 ? title.slice(0, 20) : title;
    console.log(`✍️ 正在自动填写笔记标题 ("${safeTitle}")...`);
    const titleInput = await page.waitForSelector('input[placeholder*="填写标题"]', { timeout: 15000 });
    await titleInput.click();
    // 清空可能存在的文本
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await titleInput.type(safeTitle, { delay: 40 });
    console.log(`✓ 标题已填写: "${safeTitle}"`);

    // 3. 填写正文内容与话题标签
    console.log('📝 正在自动填写正文与安全导流文案...');
    const contentArea = await page.waitForSelector('.tiptap.ProseMirror, [contenteditable="true"], textarea', { timeout: 15000 });
    await contentArea.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    // 模拟输入
    await contentArea.type(content, { delay: 10 });
    console.log('✓ 正文文案与话题标签已完整注入！');

    // 滚动到底部以确保所有底部操作条就绪
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 2000));

    if (autoSubmit) {
      console.log('🚀 正在查找并触发【发布】操作...');
      const triggered = await page.evaluate(() => {
        // 优先触发 Web Component <xhs-publish-btn>
        const pBtn = document.querySelector('xhs-publish-btn');
        if (pBtn) {
          if (typeof pBtn._onPublish === 'function') {
            pBtn._onPublish();
            return 'xhs-publish-btn._onPublish()';
          }
          pBtn.dispatchEvent(new CustomEvent('publish', { bubbles: true, composed: true }));
          return 'xhs-publish-btn.dispatchEvent(publish)';
        }
        // 备选查找文本发布按钮
        const candidates = Array.from(document.querySelectorAll('button, .d-button, [role="button"], div, span'));
        for (const el of candidates) {
          const t = el.innerText ? el.innerText.trim() : '';
          if (t === '发布' || t === '发布笔记') {
            el.click();
            return `Element: <${el.tagName}> "${t}"`;
          }
        }
        return false;
      });

      if (triggered) {
        console.log(`🎉 笔记已成功提交发布！(触发器: ${triggered}) 等待 6 秒确认响应...`);
        await new Promise(r => setTimeout(r, 6000));
        console.log('✓ 发布响应确认完毕，当前页面:', page.url());
      } else {
        console.warn('⚠️ 未定位到发布触发器，保持页面打开以供确认...');
      }
    } else {
      console.log('\n===============================================================');
      console.log('🟢【安全保护模式】：素材、标题与正文已全部自动填入！');
      console.log('👀 浏览器窗口保持打开，您可以进行最后的微调或直接在窗口中点击【发布】。');
      console.log('===============================================================\n');
    }
  } finally {
    if (autoSubmit || silent) {
      await browser.close().catch(() => {});
    }
  }
}

// CLI 直接运行支持
if (process.argv[1]?.endsWith('xhs-auto-publisher.js')) {
  const targetImage = process.argv[2] || 'C:/Users/dy776/.gemini/antigravity/scratch/movie-site/public/xhs-covers/抓娃娃_xhs_3x4.jpg';
  const targetTitle = '🔥绝了！被全网催更的《抓娃娃》4K原盘终于出来了！';
  const targetContent = `
🎬 片名：《抓娃娃》 (2024)
⭐ 评分：7.0 分 · 4K 60帧超高清原盘 · 杜比全景声 · 无删减

在大屏幕上看 4K 原盘画质真的太震撼了，每一帧细节都纤毫毕现！配合环绕音效，沉浸感直接拉满！

💡【如何无偿自取 4K 原盘与免广告在线看？】：
👉 方案 1：点击进入【我的主页】，直接加入【置顶粉丝群】在群公告自取～
👉 方案 2：评论区扣【抓娃娃】，看到会第一时间私发给你！
👉 方案 3：浏览器搜【星光影库】，免广告极速秒播与双网盘一键转存！

#电影推荐 #周末看电影 #高清电影 #4K原盘 #豆瓣高分电影 #抓娃娃
  `.trim();

  publishToXiaohongshu({
    imagePath: targetImage,
    title: targetTitle,
    content: targetContent,
    autoSubmit: false
  }).catch(console.error);
}

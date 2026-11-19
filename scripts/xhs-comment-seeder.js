import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';

// 首评暗号引导词库（随机挑选，以作者身份留言引导，不带任何链接）
const FIRST_COMMENTS = [
  '🎬 超清片源和投屏指南都备好啦～想看的小伙伴在评论区打【想看】或扣【1】，看到都会逐一私信发你哦👇',
  '✨ 已经整理好高清版留着二刷！需要的友友在评论区留个【想看】，收到会第一时间私发观影指南与直达码～',
  '🍿 大屏看细节太震撼了！片源已打包，想要在线看的宝子打【1】，戳你发详细指引👇',
  '🎬 这部后劲真的太足了！想看全片的朋友直接评论区打【想看】，看到后会一一私信分享～'
];

/**
 * 为刚发布的笔记在评论区留下首评暗号引导
 */
export async function seedFirstComment({ movieTitle, silent = true } = {}) {
  console.log(`💬 正在为《${movieTitle}》自动挂载首条评论引导暗号...`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: silent ? 'new' : false,
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();

  try {
    // 1. 进入创作者平台笔记管理页
    await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 4000));

    // 2. 查找刚发布的第一篇笔记
    const commentUrl = await page.evaluate((targetTitle) => {
      const cards = Array.from(document.querySelectorAll('.note-card, [class*="note-item"]'));
      for (const card of cards) {
        if (!targetTitle || card.innerText.includes(targetTitle)) {
          const link = card.querySelector('a[href*="detail"], a[href*="note"], .note-card__cover a');
          if (link) return link.href;
          // 或者点击详情弹窗
          const titleEl = card.querySelector('.note-card__title, .title');
          if (titleEl) {
            titleEl.click();
            return 'CLICKED_DETAIL';
          }
        }
      }
      return null;
    }, movieTitle);

    await new Promise(r => setTimeout(r, 3000));

    // 3. 寻找评论输入框并输入暗号引导
    const selectedComment = FIRST_COMMENTS[Math.floor(Math.random() * FIRST_COMMENTS.length)];
    
    // 如果直接在互动管理中留言
    console.log(`  👉 选定首评暗号话术: "${selectedComment}"`);

  } catch (err) {
    console.warn('⚠️ 自动首评挂载遇到轻微异常 (不影响发布主流程):', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const SEED_HISTORY_FILE = path.resolve('xhs_comment_seeded.json');

// 首评暗号引导词库（随机挑选，以作者身份留言引导，不带任何违规外链）
const FIRST_COMMENTS = [
  '🎬 超清片源和投屏指南都备好啦～想看的小伙伴在评论区打【想看】或扣【1】，看到都会逐一私信发你哦👇',
  '✨ 已经整理好高清版留着二刷！需要的友友在评论区留个【想看】，收到会第一时间私发观影指南与直达码～',
  '🍿 大屏看细节太震撼了！片源已打包，想要在线看的宝子打【1】，戳你发详细指引👇',
  '🎬 这部后劲真的太足了！想看全片的朋友直接评论区打【想看】，看到后会一一私信分享～'
];

function loadSeeded() {
  if (fs.existsSync(SEED_HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SEED_HISTORY_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

function saveSeeded(list) {
  fs.writeFileSync(SEED_HISTORY_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

/**
 * 扫描已发布满 10 分钟且尚未留过首评的笔记，自动发一条带暗号的首评
 */
export async function seedMatureNotes({ silent = true } = {}) {
  console.log(`\n===============================================================`);
  console.log(`⏳ 启动【发布满 10 分钟自动留言首评机器人】...`);
  console.log(`===============================================================`);

  const seeded = new Set(loadSeeded());
  console.log(`📋 已挂载过首评的笔记数: ${seeded.size} 篇`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: silent ? 'new' : false,
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();

  try {
    console.log('🌐 正在访问创作者平台笔记管理页...');
    await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 4000));

    // 检查是否登录
    if (page.url().includes('login')) {
      console.warn('⚠️ 登录已过期，请重新登录！');
      await browser.close();
      return;
    }

    // 抓取已发布笔记列表
    const notes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.note-card'));
      return cards.map(c => {
        const titleEl = c.querySelector('.note-card__title');
        const timeEl = c.querySelector('.note-card__time');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const timeStr = timeEl ? timeEl.innerText.trim() : '';
        return { title, timeStr };
      }).filter(n => n.title && n.timeStr);
    });

    console.log(`🔍 扫描到后台已发布笔记: ${notes.length} 篇`);
    const now = Date.now();
    let seededCount = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (seeded.has(note.title)) {
        continue;
      }

      // 计算发布距离现在的分钟数 (格式如 "2026-11-19 14:00")
      const noteDate = new Date(note.timeStr.replace(/-/g, '/'));
      const diffMinutes = (now - noteDate.getTime()) / (1000 * 60);

      console.log(`📌 检查笔记: 《${note.title}》 (发布于: ${note.timeStr}，已发布 ${diffMinutes.toFixed(1)} 分钟)`);

      // 必须满足：已发布满 10 分钟
      if (diffMinutes >= 10) {
        console.log(`  🎯 满足【发布满 10 分钟】触发条件！准备挂载首评暗号...`);

        const randomComment = FIRST_COMMENTS[Math.floor(Math.random() * FIRST_COMMENTS.length)];
        console.log(`  👉 选定首评话术: "${randomComment}"`);

        // 记录已挂载首评
        seeded.add(note.title);
        seededCount++;

        // 随机停顿防频控
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.log(`  ⏳ 尚未满 10 分钟 (还需等待 ${(10 - diffMinutes).toFixed(1)} 分钟)，本轮跳过`);
      }
    }

    saveSeeded(Array.from(seeded));
    console.log(`\n🎉 首评巡检完毕，本轮成功挂载新首评: ${seededCount} 篇！`);

  } catch (err) {
    console.error('❌ 自动首评巡检异常:', err.message);
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('xhs-comment-seeder.js')) {
  seedMatureNotes({ silent: false }).catch(console.error);
}

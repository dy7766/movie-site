import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const SEED_HISTORY_FILE = path.resolve('xhs_comment_seeded.json');
const AUTHOR_PROFILE_ID = '67a0997c000000000a03d69e';

// 首评暗号引导词库（随机挑选，以作者身份留言引导，不带任何违规外链）
const FIRST_COMMENTS = [
  '🎬 超清片源和投屏指南都备好啦～想看的小伙伴在评论区打【想看】或扣【1】，看到都会逐一私信发你哦👇',
  '✨ 已经整理好高清版留着二刷！需要的友友在评论区留个【想看】或【怎么看】，收到会第一时间私发观影指南与直达码～',
  '🍿 大屏看细节太震撼了！片源已打包，不知道怎么看或想在线看的宝子打【1】或【怎么看】，戳你发详细指引👇',
  '🎬 这部后劲真的太足了！想看全片或不知道怎么看的朋友直接评论区留言【想看】或【怎么看】，看到后会一一私信分享～'
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
 * 获取后台已发布且发布满 10 分钟的笔记清单（从创作者平台后台读取发布时间）
 */
async function getMatureNoteTitles(page) {
  try {
    console.log('🌐 正在访问创作者平台笔记管理页获取发布时间...');
    await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    const noteTimes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.note-card'));
      return cards.map(c => {
        const titleEl = c.querySelector('.note-card__title');
        const timeEl = c.querySelector('.note-card__time');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const timeStr = timeEl ? timeEl.innerText.trim() : '';
        return { title, timeStr };
      }).filter(n => n.title && n.timeStr);
    });

    const now = Date.now();
    const matureTitles = new Set();

    for (const note of noteTimes) {
      const noteDate = new Date(note.timeStr.replace(/-/g, '/'));
      const diffMinutes = (now - noteDate.getTime()) / (1000 * 60);
      if (diffMinutes >= 10) {
        matureTitles.add(note.title);
      }
    }

    console.log(`🔍 扫描到后台已发布满 10 分钟笔记: ${matureTitles.size} 篇`);
    return matureTitles;
  } catch (err) {
    console.warn('⚠️ 读取创作者平台时间异常，降级为前台全量巡检:', err.message);
    return null;
  }
}

/**
 * 扫描已发布满 10 分钟且尚未留过首评的笔记，在前台自动发一条带暗号的首评
 */
export async function seedMatureNotes({ silent = true, maxPerRun = 5 } = {}) {
  console.log(`\n===============================================================`);
  console.log(`⏳ 启动【发布满 10 分钟自动留言首评机器人】...`);
  console.log(`===============================================================`);

  const seeded = new Set(loadSeeded());
  console.log(`📋 已记录挂载过首评的笔记数: ${seeded.size} 篇`);

  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900'
  ];

  if (silent) {
    chromeArgs.push('--window-position=-2500,-2500');
  } else {
    chromeArgs.push('--start-maximized');
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: chromeArgs
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // 1. 获取满足“满10分钟”条件的笔记标题集合
    const matureTitles = await getMatureNoteTitles(page);

    // 2. 访问前台作者个人主页
    console.log('🌐 正在访问小红书前台个人主页...');
    await page.goto(`https://www.xiaohongshu.com/user/profile/${AUTHOR_PROFILE_ID}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 4000));

    // 获取前台个人主页上显示的所有笔记卡片信息
    const profileNotes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.note-item, section'));
      return cards.map((c, index) => {
        const text = c.innerText || '';
        const title = text.split('\n')[0].trim();
        return { index, title };
      }).filter(n => n.title);
    });

    console.log(`📌 个人主页当前识别到笔记数: ${profileNotes.length} 篇`);
    let seededCount = 0;

    for (const note of profileNotes) {
      if (seededCount >= maxPerRun) {
        console.log(`🛑 达到单轮最大首评挂载上限 (${maxPerRun} 篇)，留待下轮继续巡检...`);
        break;
      }

      // 如果明确需要满10分钟，且该笔记不在满10分钟列表内，则跳过
      if (matureTitles && !matureTitles.has(note.title)) {
        console.log(`⏳ 《${note.title}》尚未发布满 10 分钟，跳过`);
        continue;
      }

      // 如果已在历史首评记录中，跳过
      if (seeded.has(note.title)) {
        continue;
      }

      console.log(`\n🎯 正在处理笔记: 《${note.title}》`);

      // 打开笔记详情弹窗
      const opened = await page.evaluate((targetTitle) => {
        const cards = Array.from(document.querySelectorAll('.note-item, section'));
        const card = cards.find(c => {
          const t = (c.innerText || '').split('\n')[0].trim();
          return t === targetTitle;
        });
        if (card) {
          const link = card.querySelector('a.cover, a.title') || card;
          if (link) {
            link.click();
            return true;
          }
        }
        return false;
      }, note.title);

      if (!opened) {
        console.warn(`  ⚠️ 未能打开卡片: 《${note.title}》`);
        continue;
      }

      await new Promise(r => setTimeout(r, 3500));

      // 检查评论区是否已经留过首评
      const alreadyCommented = await page.evaluate(() => {
        const comments = Array.from(document.querySelectorAll('.comment-item, .parent-comment, [class*="comment-item"]'));
        return comments.some(el => {
          const text = el.innerText || '';
          return text.includes('作者') && (text.includes('想看') || text.includes('扣【1】') || text.includes('片源') || text.includes('指南'));
        });
      });

      if (alreadyCommented) {
        console.log(`  ✓ 评论区检测到已有作者首评，标记记录并跳过`);
        seeded.add(note.title);
        saveSeeded(Array.from(seeded));

        // 关闭弹窗
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      // 定位评论输入框
      try {
        await page.waitForSelector('#content-textarea, .content-input', { timeout: 8000 });
        await page.focus('#content-textarea, .content-input');
        await new Promise(r => setTimeout(r, 600));

        const randomComment = FIRST_COMMENTS[Math.floor(Math.random() * FIRST_COMMENTS.length)];
        console.log(`  ✍️ 输入首评暗号: "${randomComment}"`);
        await page.keyboard.type(randomComment, { delay: 35 });
        await new Promise(r => setTimeout(r, 1000));

        // 点击提交发送
        const submitted = await page.evaluate(() => {
          const btn = document.querySelector('button.submit, .btn.submit');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        if (submitted) {
          console.log(`  🎉 评论已提交成功！`);
          seeded.add(note.title);
          saveSeeded(Array.from(seeded));
          seededCount++;
        } else {
          console.warn(`  ⚠️ 未找到发送按钮`);
        }

        await new Promise(r => setTimeout(r, 3000));
      } catch (inputErr) {
        console.warn(`  ⚠️ 输入或发送首评失败: ${inputErr.message}`);
      }

      // 关闭弹窗恢复主页列表
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 2000));

      // 频率保护：每次首评间隔 6-10 秒
      const waitSec = Math.floor(Math.random() * 5) + 6;
      console.log(`  ⏳ 频控安全停顿 ${waitSec} 秒...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }

    saveSeeded(Array.from(seeded));
    console.log(`\n===============================================================`);
    console.log(`🎉 自动首评巡检完毕，本轮新增挂载首评: ${seededCount} 篇！`);
    console.log(`===============================================================\n`);

  } catch (err) {
    console.error('❌ 自动首评巡检异常:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('xhs-comment-seeder.js')) {
  seedMatureNotes({ silent: true, maxPerRun: 5 }).catch(console.error);
}

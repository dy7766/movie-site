import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { getMovies } from '../src/lib/db.js';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const AUTHOR_PROFILE_ID = '67a0997c000000000a03d69e';
const PROCESSED_USERS_FILE = path.resolve('xhs_replied_users.json');

// 触发回复的意图关键词库（精准覆盖扣1、怎么看、在哪看、求资源等互动表达）
const TRIGGER_KEYWORDS = [
  '1', '111', '扣1', '+1',
  '怎么看', '在哪里看', '在哪看', '去哪看', '哪里看', '在哪能看', '哪里能看', '如何看',
  '怎么搜', '怎么找', '怎么看全片',
  '想看', '求片', '求看', '求资源', '有资源吗', '求链接', '求分享', '求发', '发我',
  '看全片', '看全集', '指引', '指南', '蹲', '蹲个', '私我', '求', '666'
];

// 回复评论区的话术库（针对性强、安全合规、引导私信或点主页）
const COMMENT_REPLIES = [
  '宝子已收到～超清片源和投屏直达指南都备好啦，可以戳我主页私信发你专属二维码和片源哦！',
  '收到！大屏高清片源已整理好，快戳我主页私信，第一时间发你观影直达码和使用指南～',
  '宝子戳我主页私信发个【想看】，看到后会立即把高清片源和投屏直达码发你哦✨',
  '已经备好啦！大屏看细节画质超绝，直接戳我主页私信，发你详细指引与专属码👇'
];

function loadProcessedUsers() {
  if (fs.existsSync(PROCESSED_USERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROCESSED_USERS_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

function saveProcessedUsers(list) {
  fs.writeFileSync(PROCESSED_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

/**
 * 严格、精准判定评论是否表达了“求片/求指引/扣1/询问怎么看”意图
 */
export function isTriggerComment(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return false;
  const content = rawContent.trim();
  
  if (/^1+$/.test(content) || /扣\s*1/.test(content) || /\+1/.test(content)) {
    return true;
  }

  return TRIGGER_KEYWORDS.some(kw => {
    if (kw === '1') return false;
    return content.includes(kw);
  });
}

/**
 * 核心巡检与自动回复服务：
 * 扫描前台主页最新笔记评论区，识别“想看 / 怎么看 / 扣1”，直接针对该评论执行 @回复 并引导下一步
 */
export async function runAutoReplyBot({ silent = true, maxNotesToCheck = 10 } = {}) {
  console.log(`\n===============================================================`);
  console.log(`🤖 启动小红书【评论互动自动回复机器人】...`);
  console.log(`===============================================================`);

  const processedUsers = new Set(loadProcessedUsers());
  console.log(`📋 历史已处理互动用户数: ${processedUsers.size} 人`);

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
    console.log('🌐 正在访问小红书作者前台主页...');
    await page.goto(`https://www.xiaohongshu.com/user/profile/${AUTHOR_PROFILE_ID}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 4000));

    // 获取前台个人主页上显示的笔记列表
    const profileNotes = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.note-item, section'));
      return cards.map(c => {
        const text = c.innerText || '';
        const title = text.split('\n')[0].trim();
        return { title };
      }).filter(n => n.title);
    });

    console.log(`📌 识别到主页笔记数: ${profileNotes.length} 篇，正在巡检前 ${Math.min(profileNotes.length, maxNotesToCheck)} 篇评论互动...`);
    let repliedTotal = 0;

    for (let i = 0; i < Math.min(profileNotes.length, maxNotesToCheck); i++) {
      const targetTitle = profileNotes[i].title;

      // 打开笔记详情弹窗
      const opened = await page.evaluate((title) => {
        const cards = Array.from(document.querySelectorAll('.note-item, section'));
        const card = cards.find(c => (c.innerText || '').split('\n')[0].trim() === title);
        if (card) {
          const link = card.querySelector('a.cover, a.title') || card;
          link.click();
          return true;
        }
        return false;
      }, targetTitle);

      if (!opened) continue;
      await new Promise(r => setTimeout(r, 3000));

      // 提取弹窗内所有评论
      const commentsToReply = await page.evaluate((keywords) => {
        const items = Array.from(document.querySelectorAll('.comment-item, .parent-comment, [class*="comment-item"]'));
        const list = [];

        items.forEach((el, index) => {
          const text = (el.innerText || '').trim();
          // 如果该节点本身是作者发的，跳过
          const authorEl = el.querySelector('.name, .author, [class*="name"]');
          const authorName = authorEl ? authorEl.innerText.trim() : '';

          if (text.includes('作者') && !text.includes('回复 作者')) {
            return;
          }

          const contentEl = el.querySelector('.content, .note-text, .comment-content, .text') || el;
          const content = (contentEl.innerText || '').trim();

          // 意图匹配
          let isMatch = false;
          if (/^1+$/.test(content) || /扣\s*1/.test(content) || /\+1/.test(content)) {
            isMatch = true;
          } else {
            isMatch = keywords.some(kw => kw !== '1' && (content.includes(kw) || text.includes(kw)));
          }

          // 检查该条评论下方是否已经有作者回复过了
          const hasAuthorReplied = text.includes('作者') && (text.includes('宝子') || text.includes('收到') || text.includes('私信'));

          const userProfileHref = authorEl ? (authorEl.getAttribute('href') || authorEl.closest('a')?.getAttribute('href') || '') : '';

          if (isMatch && !hasAuthorReplied && authorName) {
            list.push({
              index,
              userName: authorName,
              userProfileHref,
              content: content.slice(0, 50)
            });
          }
        });

        return list;
      }, TRIGGER_KEYWORDS);

      if (commentsToReply.length > 0) {
        console.log(`\n🎯 在《${targetTitle}》中发现 ${commentsToReply.length} 条待回复留言:`);
      }

      for (const item of commentsToReply) {
        if (processedUsers.has(item.userName)) {
          continue;
        }

        console.log(`  💬 正在回复用户 [${item.userName}]: "${item.content}"`);

        // 点击该条评论下的【回复】按钮
        const clicked = await page.evaluate((userName) => {
          const items = Array.from(document.querySelectorAll('.comment-item, .parent-comment, [class*="comment-item"]'));
          const target = items.find(el => {
            const author = el.querySelector('.name, .author, [class*="name"]')?.innerText?.trim();
            return author === userName;
          });
          if (target) {
            const replyBtn = Array.from(target.querySelectorAll('span, button, a')).find(el => el.innerText && el.innerText.trim() === '回复');
            if (replyBtn) {
              replyBtn.click();
              return true;
            }
          }
          return false;
        }, item.userName);

        if (!clicked) {
          console.warn(`    ⚠️ 未能点击到 [${item.userName}] 的回复按钮`);
          continue;
        }

        await new Promise(r => setTimeout(r, 800));

        // 输入回复内容
        const replyText = COMMENT_REPLIES[Math.floor(Math.random() * COMMENT_REPLIES.length)];
        await page.focus('#content-textarea, .content-input');
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.type(replyText, { delay: 35 });
        await new Promise(r => setTimeout(r, 800));

        // 点击发送
        const sent = await page.evaluate(() => {
          const btn = document.querySelector('button.submit, .btn.submit');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        if (sent) {
          console.log(`    🎉 成功公开回复用户 [${item.userName}]: "${replyText}"`);
          processedUsers.add(item.userName);
          saveProcessedUsers(Array.from(processedUsers));
          repliedTotal++;

          // 触发主动私信直达
          if (item.userProfileHref) {
            try {
              console.log(`    ✉️ 正在打开用户 [${item.userName}] 个人主页，触发主动私信...`);
              const dmPage = await browser.newPage();
              const fullProfileUrl = item.userProfileHref.startsWith('http')
                ? item.userProfileHref
                : `https://www.xiaohongshu.com${item.userProfileHref}`;
              await dmPage.goto(fullProfileUrl, { waitUntil: 'networkidle2', timeout: 20000 });
              await new Promise(r => setTimeout(r, 1500));

              const clickedIm = await dmPage.evaluate(() => {
                const imBtn = document.querySelector('.xhs-user-im-btn, button[title="发消息"]');
                if (imBtn) {
                  imBtn.click();
                  return true;
                }
                return false;
              });

              if (clickedIm) {
                await new Promise(r => setTimeout(r, 2500));
                const allPages = await browser.pages();
                const chatPage = allPages.find(p => p.url().includes('/chat')) || dmPage;

                await chatPage.waitForSelector('.xhs-im-input-bar-editor', { timeout: 10000 });
                await chatPage.focus('.xhs-im-input-bar-editor');
                await new Promise(r => setTimeout(r, 300));

                let matchedMovie = null;
                try {
                  const cleanTitle = targetTitle.match(/《([^》]+)》/)?.[1] || targetTitle;
                  const movies = await getMovies({ search: cleanTitle, limit: 1 });
                  if (movies && movies.length > 0) matchedMovie = movies[0];
                } catch (e) {}

                const dmMessage = matchedMovie
                  ? `宝子久等啦！《${matchedMovie.title}》片源已为你备好：\n🎬 在线免广告看：https://xkykmovie.com/movie/${matchedMovie.id}\n${matchedMovie.share_link ? `💾 夸克原画转存：${matchedMovie.share_link}\n` : ''}${matchedMovie.share_link_uc ? `💾 UC网盘转存：${matchedMovie.share_link_uc}\n` : ''}（手机浏览器直接打开即可观看或保存投屏哦🍿）`
                  : `宝子久等啦！你想要的影视资源已备好，前往主站搜片名直接免广告在线看：https://xkykmovie.com 🍿`;

                const lines = dmMessage.split('\n');
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                  await chatPage.keyboard.type(lines[lineIdx], { delay: 15 });
                  if (lineIdx < lines.length - 1) {
                    await chatPage.keyboard.down('Shift');
                    await chatPage.keyboard.press('Enter');
                    await chatPage.keyboard.up('Shift');
                    await new Promise(r => setTimeout(r, 100));
                  }
                }
                await new Promise(r => setTimeout(r, 400));
                await chatPage.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 1500));
                console.log(`    🎉 主动私信资源已成功送达用户 [${item.userName}]！`);
                if (chatPage !== page) await chatPage.close().catch(() => {});
              } else {
                console.warn(`    ⚠️ 未在用户 [${item.userName}] 主页检测到发消息按钮`);
              }
              if (!dmPage.isClosed() && dmPage !== page) await dmPage.close().catch(() => {});
            } catch (dmErr) {
              console.warn(`    ⚠️ 主动私信执行异常:`, dmErr.message);
            }
          }
        }

        // 频控保护
        const waitSec = Math.floor(Math.random() * 4) + 4;
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }

      // 关闭详情弹窗
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 1500));
    }

    saveProcessedUsers(Array.from(processedUsers));
    console.log(`\n===============================================================`);
    console.log(`🎉 互动回复巡检完成，本轮成功响应新用户: ${repliedTotal} 位！`);
    console.log(`===============================================================\n`);

  } catch (err) {
    console.error('❌ 互动回复机器人巡检异常:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('xhs-auto-replier.js')) {
  runAutoReplyBot({ silent: true }).catch(console.error);
}

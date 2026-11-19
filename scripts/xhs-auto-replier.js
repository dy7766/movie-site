import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { generateMovieDetailQrCard } from './generate-movie-qr-card.js';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const GUIDE_IMAGE_PATH = path.resolve('public/guide-card.png');
const HISTORY_FILE = path.resolve('xhs_history.json');
const PROCESSED_USERS_FILE = path.resolve('xhs_replied_users.json');

// 触发扣1回复的关键词列表
const TRIGGER_KEYWORDS = ['1', '想看', '求', '看全片', '全集', '666', '怎么看', '在哪里看', '蹲', '指引'];

// 回复评论区的话术库（随机选用，避免重复刷屏）
const COMMENT_REPLIES = [
  '宝子看私信哦，已把观影指南与专属直达码发你啦～',
  '专属直达码已私信，请查收哦～祝观影愉快 ✨',
  '戳你啦！电影直达二维码和指南已发私信哦～',
  '已经私信你啦，大屏看画质更赞，扫码即看！'
];

function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

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
 * 根据评论所在的笔记标题或上下文，智能匹配对应的电影数据
 */
function findMatchingMovie(noteTitleOrContent, history) {
  if (!noteTitleOrContent) return null;

  // 1. 尝试从历史中精确比对 postTitle 或 title
  for (const item of history) {
    if (noteTitleOrContent.includes(item.title) || (item.postTitle && noteTitleOrContent.includes(item.postTitle))) {
      return item;
    }
  }

  // 2. 尝试从书名号《...》中提取片名
  const match = noteTitleOrContent.match(/《([^》]+)》/);
  if (match) {
    const movieName = match[1].trim();
    const found = history.find(h => h.title.includes(movieName) || movieName.includes(h.title));
    if (found) return found;
  }

  // 3. 兜底返回最近发布的一部电影
  return history[history.length - 1] || null;
}

/**
 * 核心巡检与自动私信服务（统一指引图 + 专属直达二维码卡片双连发）
 */
export async function runAutoReplyBot({ silent = true } = {}) {
  console.log(`\n===============================================================`);
  console.log(`🤖 启动小红书【评论区扣1自动私信机器人 (带专属详情页直达码)】...`);
  console.log(`===============================================================`);

  const history = loadHistory();
  const processedUsers = new Set(loadProcessedUsers());
  console.log(`📋 历史发布影视库: ${history.length} 部 | 已处理互动用户: ${processedUsers.size} 人`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: silent ? 'new' : false,
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();

  try {
    // 1. 进入创作者平台 - 评论互动中心
    console.log('🌐 正在访问小红书互动消息管理中心...');
    await page.goto('https://creator.xiaohongshu.com/creator/comment', {
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

    // 2. 抓取待处理的评论列表（包含评论所属笔记标题、用户名、评论内容）
    console.log('🔍 正在扫描最新互动评论与对应影视笔记...');
    const comments = await page.evaluate((keywords) => {
      const items = Array.from(document.querySelectorAll('.comment-item, .item-container, tr, [class*="comment"]'));
      const matches = [];

      for (const el of items) {
        const text = el.innerText || '';
        // 匹配关键词
        const matchedKw = keywords.find(kw => text.includes(kw));
        if (matchedKw) {
          // 提取用户名
          const userEl = el.querySelector('.user-name, .author, .nickname, a[href*="user"]');
          const userName = userEl ? userEl.innerText.trim() : '匿名影迷';
          
          // 提取所属笔记标题
          const noteEl = el.querySelector('.note-title, .source-title, a[href*="note"], [class*="title"]');
          const noteTitle = noteEl ? noteEl.innerText.trim() : '';

          matches.push({
            userName,
            content: text.slice(0, 80),
            noteTitle,
            matchedKw
          });
        }
      }
      return matches;
    }, TRIGGER_KEYWORDS);

    console.log(`🎯 扫描到符合“扣1/求看”特征的评论: ${comments.length} 条`);

    let repliedCount = 0;
    for (const comment of comments) {
      if (processedUsers.has(comment.userName)) {
        continue;
      }

      // 锁定当前评论针对的是哪部电影
      const targetMovie = findMatchingMovie(comment.noteTitle || comment.content, history);
      console.log(`\n💬 命中用户 [${comment.userName}] 留言: "${comment.content.trim()}" (暗号: ${comment.matchedKw})`);
      if (targetMovie) {
        console.log(`  🎬 对应锁定影视: 《${targetMovie.title}》 (${targetMovie.id})`);
      }

      // 1. 准备专属物料 1：统一通用观影指引
      const guideCard = GUIDE_IMAGE_PATH;

      // 2. 准备专属物料 2：该部电影详情页二维码
      let qrCardPath = null;
      if (targetMovie) {
        qrCardPath = await generateMovieDetailQrCard(targetMovie);
      }

      // 3. 模拟公开回复与双图私信发送
      const randomReply = COMMENT_REPLIES[Math.floor(Math.random() * COMMENT_REPLIES.length)];
      console.log(`  👉 拟发送公开回复: "${randomReply}"`);
      console.log(`  📩 拟私信发送序列:`);
      console.log(`     [第 1 张] 统一观影指引图: ${guideCard}`);
      if (qrCardPath) {
        console.log(`     [第 2 张] 《${targetMovie.title}》直达二维码: ${qrCardPath}`);
      }

      // 记录已处理
      processedUsers.add(comment.userName);
      repliedCount++;

      // 频控保护：避免连续触发小红书限频
      const delay = Math.floor(Math.random() * 5000) + 3000;
      await new Promise(r => setTimeout(r, delay));
    }

    saveProcessedUsers(Array.from(processedUsers));
    console.log(`\n🎉 本轮巡检完毕，成功响应新用户: ${repliedCount} 位！`);

  } catch (err) {
    console.error('❌ 自动回复机器人异常:', err.message);
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('xhs-auto-replier.js')) {
  runAutoReplyBot({ silent: false }).catch(console.error);
}

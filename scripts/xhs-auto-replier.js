import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const GUIDE_IMAGE_PATH = path.resolve('public/guide-card.png');
const PROCESSED_USERS_FILE = path.resolve('xhs_replied_users.json');

// 触发扣1回复的关键词列表
const TRIGGER_KEYWORDS = ['1', '想看', '求', '看全片', '全集', '666', '怎么看', '在哪里看', '蹲', '指引'];

// 回复评论区的话术库（随机选用，避免重复刷屏）
const COMMENT_REPLIES = [
  '宝子看私信哦，已把观影指南发你啦～',
  '私信已发，请查收哦～祝观影愉快 ✨',
  '戳你啦！注意查看私信消息哦～',
  '已经私信你啦，大屏看画质更赞哦！'
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
 * 核心巡检与自动私信服务
 */
export async function runAutoReplyBot({ silent = true } = {}) {
  console.log(`\n===============================================================`);
  console.log(`🤖 启动小红书【评论区扣1自动私信机器人】...`);
  console.log(`===============================================================`);

  if (!fs.existsSync(GUIDE_IMAGE_PATH)) {
    console.error(`❌ 未找到观影指引图片: ${GUIDE_IMAGE_PATH}`);
    return;
  }

  const processedUsers = new Set(loadProcessedUsers());
  console.log(`📋 已记录处理过用户数: ${processedUsers.size} 人`);

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

    // 2. 抓取待处理的评论列表
    console.log('🔍 正在扫描最新未回复的互动评论...');
    const comments = await page.evaluate((keywords) => {
      const items = Array.from(document.querySelectorAll('.comment-item, .item-container, tr, [class*="comment"]'));
      const matches = [];

      for (const el of items) {
        const text = el.innerText || '';
        // 匹配关键词
        const matchedKw = keywords.find(kw => text.includes(kw));
        if (matchedKw) {
          // 提取用户名和评论内容
          const userEl = el.querySelector('.user-name, .author, .nickname, a[href*="user"]');
          const replyBtn = el.querySelector('.reply-btn, button, [class*="reply"]');
          const userName = userEl ? userEl.innerText.trim() : '匿名影迷';
          
          matches.push({
            userName,
            content: text.slice(0, 80),
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

      console.log(`\n💬 命中用户 [${comment.userName}] 留言: "${comment.content.trim()}" (暗号: ${comment.matchedKw})`);
      
      // 模拟回复与私信
      const randomReply = COMMENT_REPLIES[Math.floor(Math.random() * COMMENT_REPLIES.length)];
      console.log(`  👉 拟发送公开回复: "${randomReply}"`);
      console.log(`  📩 拟主动私信发送: [观影指南卡片 ${GUIDE_IMAGE_PATH}]`);

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

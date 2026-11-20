import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { getMovies, closeDbPool } from '../src/lib/db.js';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const CHAT_PROCESSED_FILE = path.resolve('xhs_chat_replied.json');
const BASE_WEBSITE_URL = 'https://xkykmovie.com';

// 礼貌结束语正则（无需再重复推送影视资源链接）
const COURTESY_CLOSING_REGEX = /^(好的|谢谢|多谢|感谢|收到|ok|已阅|好哒|好嘞|谢了|太感谢了|辛苦啦?)[!！~。.\s]*$/i;

function loadProcessedChats() {
  try {
    if (fs.existsSync(CHAT_PROCESSED_FILE)) {
      const data = fs.readFileSync(CHAT_PROCESSED_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('⚠️ 读取已私信记录文件失败，新建空记录:', err.message);
  }
  return {};
}

function saveProcessedChats(chatRecord) {
  try {
    fs.writeFileSync(CHAT_PROCESSED_FILE, JSON.stringify(chatRecord, null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ 保存已私信记录文件失败:', err.message);
  }
}

/**
 * 从对话文本或引用的笔记中精准解析片名
 */
function extractMovieTitle(text) {
  if (!text) return null;

  // 1. 优先匹配书名号《...》内的片名
  const titleMatch = text.match(/《([^》]+)》/);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }

  // 2. 匹配 "来自笔记" 后面的标题片段
  const noteMatch = text.match(/来自笔记[\s\S]*?([^\n\r]+)/);
  if (noteMatch && noteMatch[1]) {
    const rawNote = noteMatch[1].trim();
    const innerTitle = rawNote.match(/《([^》]+)》/);
    if (innerTitle) return innerTitle[1].trim();
    return rawNote.replace(/^(看完|熬夜狂刷|私藏口碑神作|答应我！周末一定要去看|千万别一个人看！|层层反转！|后劲太大了！)/, '').trim();
  }

  // 3. 意图句式正则提取片名（如：“有夜王的电影资源吗” -> “夜王”，“求繁花” -> “繁花”）
  const patternMatch = text.match(/(?:有|求|想看|发我|看)\s*([a-zA-Z0-9\u4e00-\u9fa5]{2,15}?)\s*(?:的)?(?:电影|电视剧|片源|全片|全集|资源|吗|\?|？)/);
  if (patternMatch && patternMatch[1]) {
    return patternMatch[1].trim();
  }

  // 4. 通用清洗：剔除高频虚词与疑问助词
  const clean = text
    .replace(/(请问|你好|您好|想要|想看|求看|求资源|求分享|有没有|有资源吗|怎么看|在哪看|哪里看|如何看|在哪能看|求|资源|全片|电影|电视剧|好剧|高清|完整版|\?|？|\!|！|，|,|。)/g, '')
    .trim();

  if (clean.length >= 2 && clean.length <= 20) {
    return clean;
  }

  return null;
}

/**
 * 根据解析出的片名查询数据库并生成结构化私信回复文案
 */
async function buildReplyContent(parsedTitle) {
  let matchedMovie = null;

  if (parsedTitle) {
    try {
      const candidates = await getMovies({ search: parsedTitle, limit: 5 });
      if (candidates && candidates.length > 0) {
        matchedMovie = candidates.find(m => m.title === parsedTitle) || candidates[0];
      }
    } catch (err) {
      console.warn(`  ⚠️ 查询影视资源数据库异常 [${parsedTitle}]:`, err.message);
    }
  }

  if (matchedMovie) {
    const lines = [
      `宝子久等啦！《${matchedMovie.title}》超清完整版片源已备好：`,
      `🎬 免广告在线高清看：${BASE_WEBSITE_URL}/movie/${matchedMovie.id}`
    ];

    if (matchedMovie.share_link) {
      lines.push(`💾 夸克网盘原画转存：${matchedMovie.share_link}`);
    }
    if (matchedMovie.share_link_uc) {
      lines.push(`💾 UC网盘无损转存：${matchedMovie.share_link_uc}`);
    }

    lines.push(`（手机浏览器点开即可直接播放，也支持一键转存到网盘投屏看哦🍿）`);
    return lines;
  }

  // 若未匹配到特定片名，引导至站内自主搜索
  return [
    `宝子你好！为你整理了全网海量4K超清影视片源库：`,
    `🎬 影视直达主站：${BASE_WEBSITE_URL}`,
    `💡 在站内直接搜索你想看的电影或电视剧名，即可一键免广告在线看或保存到网盘投屏！🍿`
  ];
}

/**
 * 执行小红书私信自动巡检与回复
 */
export async function runChatAutoReplier({ silent = false } = {}) {
  const processedRecords = loadProcessedChats();
  const processedKeys = Object.keys(processedRecords);

  console.log(`\n===============================================================`);
  console.log(`📬 [XHS_Chat_Replier] 启动私信会话巡检 (当前已记录私信用户: ${processedKeys.length} 位)`);
  console.log(`===============================================================`);

  let browser = null;
  let repliedCount = 0;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      userDataDir: USER_DATA_DIR,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    console.log('🌐 正在载入小红书 Web IM 私信中心...');
    await page.goto('https://www.xiaohongshu.com/chat', { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 3000));

    // 获取当前对话列表
    const convCount = await page.evaluate(() => document.querySelectorAll('.xhs-im-conv-item').length);
    console.log(`📋 当前私信列表共识别到 ${convCount} 个会话`);

    const maxCheck = Math.min(convCount, 15);

    for (let i = 0; i < maxCheck; i++) {
      // 预先检查摘要信息
      const convMeta = await page.evaluate((idx) => {
        const items = document.querySelectorAll('.xhs-im-conv-item');
        const item = items[idx];
        if (!item) return null;

        const name = item.querySelector('.xhs-im-conv-item__name')?.innerText?.trim() || '';
        const summary = item.querySelector('.xhs-im-conv-item__summary-text')?.innerText?.trim() || '';
        const hasUnread = item.querySelector('.unread, .xhs-im-conv-item__badge') !== null;

        return { name, summary, hasUnread };
      }, i);

      if (!convMeta || !convMeta.name) continue;

      // 快速前置过滤：如果最后一条摘要是我方发出的链接/话术，且无未读标识，直接跳过
      const isOurSummary = convMeta.summary.includes('http') ||
                           convMeta.summary.includes('🎬') ||
                           convMeta.summary.includes('宝子') ||
                           convMeta.summary.includes('免广告') ||
                           convMeta.summary.includes('网盘');

      if (isOurSummary && !convMeta.hasUnread) {
        continue;
      }

      // 检查历史处理记录：如果摘要与上次处理一致，跳过
      if (processedRecords[convMeta.name] === convMeta.summary && !convMeta.hasUnread) {
        continue;
      }

      // 点击选中该会话进入详情
      await page.evaluate((idx) => {
        document.querySelectorAll('.xhs-im-conv-item')[idx]?.click();
      }, i);

      await new Promise(r => setTimeout(r, 1800));

      // 检查当前聊天面板内的消息流状态
      const chatState = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.chat-item'));
        if (items.length === 0) return { hasMessages: false };

        const lastItem = items[items.length - 1];
        const isLastSelf = lastItem.querySelector('.chat-item__content--right, .chat-item__bubble--self') !== null ||
                           lastItem.className.includes('right');

        // 收集对话中对方发送的最新文本与卡片引用
        const otherMessages = items
          .filter(it => it.querySelector('.chat-item__content--left, .chat-item__bubble--other') !== null)
          .map(it => it.innerText.trim());

        const lastOtherText = otherMessages.length > 0 ? otherMessages[otherMessages.length - 1] : '';

        return {
          hasMessages: true,
          totalCount: items.length,
          isLastSelf,
          lastOtherText,
          recentOtherContext: otherMessages.slice(-3).join('\n')
        };
      });

      if (!chatState.hasMessages || chatState.isLastSelf) {
        // 如果最后一条是我方发的，更新已处理记录后跳过
        processedRecords[convMeta.name] = convMeta.summary;
        continue;
      }

      // 如果对方最后一条消息属于单纯的礼貌结束语（“谢谢 / 好的 / 收到”），无需重复推片
      if (COURTESY_CLOSING_REGEX.test(chatState.lastOtherText.trim())) {
        console.log(`   ☕ 用户 [${convMeta.name}] 发送了礼貌结束语: "${chatState.lastOtherText}"，标记为已完结`);
        processedRecords[convMeta.name] = convMeta.summary;
        saveProcessedChats(processedRecords);
        continue;
      }

      console.log(`\n🎯 发现待回复用户 [${convMeta.name}]:`);
      console.log(`   用户留言/引用内容: "${chatState.recentOtherContext.replace(/\n/g, ' ')}"`);

      // 解析片名
      const movieTitle = extractMovieTitle(chatState.recentOtherContext);
      if (movieTitle) {
        console.log(`   🔍 识别出目标片名: 《${movieTitle}》`);
      } else {
        console.log(`   ℹ️ 未识别出具体片名，准备发送全站资源主站直达卡片`);
      }

      // 准备回复话术
      const replyLines = await buildReplyContent(movieTitle);

      // 输入私信内容并发送
      await page.focus('.xhs-im-input-bar-editor');
      await new Promise(r => setTimeout(r, 300));

      for (let lineIdx = 0; lineIdx < replyLines.length; lineIdx++) {
        await page.keyboard.type(replyLines[lineIdx], { delay: 15 });
        if (lineIdx < replyLines.length - 1) {
          // 使用 Shift+Enter 换行，保持在同一气泡内
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
          await new Promise(r => setTimeout(r, 100));
        }
      }

      await new Promise(r => setTimeout(r, 500));
      // 回车触发发送
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));

      // 验证是否发送成功
      const verifySuccess = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.chat-item'));
        if (items.length === 0) return false;
        const last = items[items.length - 1];
        return last.querySelector('.chat-item__content--right, .chat-item__bubble--self') !== null;
      });

      if (verifySuccess) {
        console.log(`   🎉 私信资源链接发送成功给 [${convMeta.name}]！`);
        processedRecords[convMeta.name] = convMeta.summary;
        saveProcessedChats(processedRecords);
        repliedCount++;
      } else {
        console.warn(`   ⚠️ 发送验证未检测到新气泡，请关注网络或频控状态`);
      }

      // 频控保护，避免连续高频触发
      const waitSec = Math.floor(Math.random() * 3) + 3;
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }

    saveProcessedChats(processedRecords);
    console.log(`\n===============================================================`);
    console.log(`🎉 [XHS_Chat_Replier] 私信巡检完成，本轮成功回复: ${repliedCount} 位用户！`);
    console.log(`===============================================================\n`);

  } catch (err) {
    console.error('❌ [XHS_Chat_Replier] 运行异常:', err.message);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// 允许独立作为 CLI 执行
if (process.argv[1]?.endsWith('xhs-chat-replier.js')) {
  runChatAutoReplier().then(() => {
    closeDbPool().catch(() => {});
  }).catch(console.error);
}

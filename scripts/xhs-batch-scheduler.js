import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDbPool } from '../src/lib/db.js';
import { renderXhsCover, generateXhsCopy } from './xhs-generator.js';
import { publishToXiaohongshu } from './xhs-auto-publisher.js';

const HISTORY_FILE = path.resolve('xhs_history.json');
const DEFAULT_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=b4b05e7b29bfcd9d649c48a3669a201817e5069255bfd2d30cf14b28747ebe4d';
const DEFAULT_SECRET = 'SECc1a492c159ef4fcd7a81cb81e505f8534fe0ed817a90467be300c6808cef4b10';
const DEFAULT_PHONE = '15210865171';

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

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 发送钉钉聚合汇报通知
 */
async function sendDingTalkBatchReport({ successList, failedList, totalCount }) {
  const webhookUrl = process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET || DEFAULT_SECRET;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = encodeURIComponent(hmac.digest('base64'));
  const finalUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const itemsMarkdown = successList.map((item, idx) => {
    const cycleTag = item.isRecycled ? '<font color="#FF8C00">【轮循复发】</font>' : '<font color="#008000">【新片首发】</font>';
    return `${idx + 1}. ${cycleTag} **《${item.title}》** (${item.year || '2024'})\n   - 📌 标题: "${item.postTitle}"\n   - 🔗 网盘: ${item.driveType}\n   - 🖼️ 封面: 3:4 视觉图已同步注入`;
  }).join('\n\n');

  const failedMarkdown = failedList.length > 0 
    ? `\n\n⚠️ **异常项目 (${failedList.length} 个)**:\n` + failedList.map(f => `- 《${f.title}》: ${f.error}`).join('\n')
    : '';

  const text = `### ⏰ 小红书每小时定时发帖任务报告
---
- ⏱️ **执行时间**：${now}
- 📊 **本轮计划**：${totalCount} 篇笔记 | **实际成功**：<font color="#008000">**${successList.length}** 篇</font>
- 🔄 **智能选片**：优先未发优质大片，无剩余时自动轮循最早历史

${itemsMarkdown}${failedMarkdown}

---
> 💡 下次自动化发布将于 **1 小时后** 静默触发。如需微调请查看本地日志。`;

  try {
    await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: `⏰ 小红书定时任务完成 (${successList.length}/${totalCount} 篇)`,
          text
        }
      })
    });
    console.log('✓ 钉钉运营群已同步推送本轮发布大盘报告');
  } catch (err) {
    console.warn('⚠️ 钉钉通知发送失败:', err.message);
  }
}

/**
 * 发送登录失效紧急告警
 */
async function sendLoginAlert(errorMsg) {
  const webhookUrl = process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET || DEFAULT_SECRET;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = encodeURIComponent(hmac.digest('base64'));
  const finalUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;

  const text = `### 🔴【P0 紧急告警】小红书创作者登录态失效！
---
- ⚠️ **异常原因**：${errorMsg}
- 🚨 **受影响流程**：每小时自动定时发帖任务已挂起
- 👤 **责任人**：@${DEFAULT_PHONE}

> **一键修复指南**：
> 请在电脑终端执行：\`npm run xhs:publish\`，在弹出的浏览器中扫码登录一次即可永久恢复！`;

  try {
    await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: '🚨 小红书登录态失效告警',
          text
        },
        at: {
          atMobiles: [DEFAULT_PHONE],
          isAtAll: false
        }
      })
    });
  } catch {}
}

/**
 * 挑选 2~3 部候选电影（支持新片优先 + 轮循已发）
 */
async function selectBatchMovies(count) {
  const pool = getDbPool();
  const history = loadHistory();

  // 查询所有带网盘资源的影视
  const res = await pool.query(`
    SELECT * FROM resources 
    WHERE (share_link IS NOT NULL OR share_link_uc IS NOT NULL)
    ORDER BY created_at DESC, score DESC
  `);

  const allMovies = res.rows;
  if (allMovies.length === 0) {
    return [];
  }

  // 统计每部电影的历史发布次数与最新发布时间
  const historyMap = new Map();
  for (const h of history) {
    const prev = historyMap.get(h.id) || { count: 0, lastTime: 0 };
    historyMap.set(h.id, {
      count: prev.count + 1,
      lastTime: Math.max(prev.lastTime, new Date(h.publishedAt).getTime() || 0)
    });
  }

  const unposted = [];
  const posted = [];

  for (const movie of allMovies) {
    const hist = historyMap.get(movie.id);
    if (!hist || hist.count === 0) {
      unposted.push({ ...movie, isRecycled: false, postCount: 0 });
    } else {
      posted.push({ ...movie, isRecycled: true, postCount: hist.count, lastTime: hist.lastTime });
    }
  }

  // posted 按照最后发布时间升序排列（最久未发的排前面 - LRU）
  posted.sort((a, b) => a.lastTime - b.lastTime);

  const selected = [];

  // 1. 优先拿未发布的
  while (selected.length < count && unposted.length > 0) {
    selected.push(unposted.shift());
  }

  // 2. 如果未发布的不够，从已发布的最老历史中轮循补充
  while (selected.length < count && posted.length > 0) {
    selected.push(posted.shift());
  }

  return selected;
}

/**
 * 核心批量调度引擎
 */
export async function runBatchHourlyTask({
  count = null,
  silent = true
} = {}) {
  // 默认每轮随机 2 到 3 篇笔记，符合真实博主发布节奏
  const targetCount = count || (Math.floor(Math.random() * 2) + 2); // 2 or 3

  console.log(`\n===============================================================`);
  console.log(`⏰ 启动小红书每小时定时发帖任务（目标篇数: ${targetCount} 篇，静默模式: ${silent}）`);
  console.log(`===============================================================`);

  const candidates = await selectBatchMovies(targetCount);
  if (candidates.length === 0) {
    console.log('⚠️ 片库中暂无可用网盘影视资源');
    return;
  }

  console.log(`🎯 命中本轮待发布影片列表 (${candidates.length} 部):`);
  candidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. 《${c.title}》 (${c.year}) - ${c.isRecycled ? `【轮循复发 第${c.postCount + 1}次】` : '【新片首发】'}`);
  });

  const successList = [];
  const failedList = [];
  const history = loadHistory();

  for (let i = 0; i < candidates.length; i++) {
    const movie = candidates[i];
    console.log(`\n---------------------------------------------------------------`);
    console.log(`🎬 [${i + 1}/${candidates.length}] 正在处理: 《${movie.title}》...`);

    try {
      // 1. 生成 3:4 封面图
      console.log('  🖼️ 生成 3:4 (1080x1440) 高清视觉海报...');
      const imagePath = await renderXhsCover(movie);

      // 2. 生成标题和正文（轮循影片根据发布次数切换不同风格标题）
      console.log('  ✍️ 匹配算法标题与安全防封文案...');
      const { titles, body } = generateXhsCopy(movie);
      const postTitle = titles[movie.postCount % titles.length];

      // 3. 调起自动化发布
      console.log('  🚀 提交至创作者服务平台...');
      await publishToXiaohongshu({
        imagePath,
        title: postTitle,
        content: body,
        autoSubmit: true, // 定时任务全自动点击发布
        silent
      });

      // 记录成功历史
      history.push({
        id: movie.id,
        title: movie.title,
        publishedAt: new Date().toISOString(),
        postTitle,
        imagePath
      });
      saveHistory(history);

      const driveType = (movie.share_link && movie.share_link_uc) 
        ? '夸克 + UC 双线路' 
        : (movie.share_link_uc ? 'UC 网盘独家' : '夸克网盘独家');

      successList.push({
        title: movie.title,
        year: movie.year,
        postTitle,
        driveType,
        isRecycled: movie.isRecycled
      });

      console.log(`  ✓ 《${movie.title}》发布成功！`);

      // 若后面还有笔记，等待 45~60 秒安全防刷限流间隔
      if (i < candidates.length - 1) {
        const jitterWait = Math.floor(Math.random() * 15) + 45; // 45~60秒
        console.log(`  ⏳ 为规避小红书高频发帖风控，安全休眠 ${jitterWait} 秒后发布下一篇...`);
        await new Promise(r => setTimeout(r, jitterWait * 1000));
      }
    } catch (err) {
      console.error(`  ❌ 《${movie.title}》发布失败:`, err.message);
      failedList.push({ title: movie.title, error: err.message });

      if (err.message.includes('未登录') || err.message.includes('登录已失效')) {
        await sendLoginAlert(err.message);
        break; // 登录失效则停止本轮后续任务，等待用户扫码
      }
    }
  }

  // 发送钉钉大盘总结
  await sendDingTalkBatchReport({
    successList,
    failedList,
    totalCount: candidates.length
  });

  console.log(`\n===============================================================`);
  console.log(`🎉 本轮定时任务完成！成功: ${successList.length} 篇，失败: ${failedList.length} 篇`);
  console.log(`===============================================================\n`);
}

// CLI 执行入口
if (process.argv[1]?.endsWith('xhs-batch-scheduler.js')) {
  const args = process.argv.slice(2);
  const isSilent = !args.includes('--visible');
  const countArg = args.find(a => /^\d+$/.test(a));
  const count = countArg ? parseInt(countArg, 10) : null;

  runBatchHourlyTask({
    count,
    silent: isSilent
  }).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

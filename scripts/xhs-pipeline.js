import fs from 'fs';
import path from 'path';
import { getDbPool } from '../src/lib/db.js';
import { renderXhsCover, generateXhsCopy, getMovieData } from './xhs-generator.js';
import { publishToXiaohongshu } from './xhs-auto-publisher.js';
import crypto from 'crypto';

const HISTORY_FILE = path.resolve('xhs_history.json');
const DEFAULT_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=b4b05e7b29bfcd9d649c48a3669a201817e5069255bfd2d30cf14b28747ebe4d';
const DEFAULT_SECRET = 'SECc1a492c159ef4fcd7a81cb81e505f8534fe0ed817a90467be300c6808cef4b10';

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

async function notifyDingTalk(movie, title) {
  const webhookUrl = process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET || DEFAULT_SECRET;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = encodeURIComponent(hmac.digest('base64'));
  const finalUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const text = `### 📕 小红书引流笔记自动发布成功
---
- 🎬 **目标影片**：**《${movie.title}》** (${movie.year || '2024'})
- 📌 **发布标题**：${title}
- ⭐ **影片评分**：${movie.score || '8.0'} 分
- 🖼️ **视觉物料**：3:4 (1080x1440) 玻璃拟态高清海报已同步上传
- 🔗 **变现渠道**：UC / 夸克专属转存 + 在线免流播放双闭环
- 🛡️ **安全导流**：置顶粉丝群公告 + 评论区暗号 + 站点品牌词
- ⏱️ **发布时间**：${now}

> 💡 系统已自动将该影片录入已发去重库，下次将自动推荐下一部优质大片！`;

  try {
    await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: `📕 小红书自动发布: 《${movie.title}》`,
          text
        }
      })
    });
    console.log('✓ 钉钉运营群已同步推送发布报告');
  } catch (err) {
    console.warn('⚠️ 钉钉通知发送失败:', err.message);
  }
}

async function selectBestMovie(keyword) {
  const pool = getDbPool();
  if (keyword) {
    return await getMovieData(keyword);
  }

  const history = loadHistory();
  const postedIds = history.map(h => h.id).filter(Boolean);

  let query = `
    SELECT * FROM resources 
    WHERE (share_link IS NOT NULL OR share_link_uc IS NOT NULL)
  `;
  const params = [];
  if (postedIds.length > 0) {
    query += ` AND id != ALL($1)`;
    params.push(postedIds);
  }

  // 优先选择近期更新、有双网盘、且高评分的大热电影
  query += ` ORDER BY created_at DESC, score DESC LIMIT 1`;

  const res = await pool.query(query, params);
  if (res.rows.length > 0) {
    return res.rows[0];
  }

  // 若全部都发过，则循环发评分最高的热门
  const fallbackRes = await pool.query(`
    SELECT * FROM resources 
    WHERE (share_link IS NOT NULL OR share_link_uc IS NOT NULL)
    ORDER BY score DESC LIMIT 1
  `);
  return fallbackRes.rows[0] || null;
}

export async function runXhsPipeline({
  keyword = '',
  autoSubmit = false
} = {}) {
  console.log(`\n===============================================================`);
  console.log(`🚀 启动小红书【自动化引流与发布流水线】 (Auto-Pipeline)`);
  console.log(`===============================================================`);

  const movie = await selectBestMovie(keyword);
  if (!movie) {
    console.error('❌ 未在片库中找到可用影视资源');
    return;
  }

  console.log(`🎯 命中本次发布影片: 《${movie.title}》 (${movie.year || '2024'})`);
  console.log(`⭐ 评分: ${movie.score || '8.0'} | 演职员: ${movie.actors || '群星'}`);

  console.log('\n[1/3] 正在生成 3:4 (1080x1440) 高清爆款视觉封面...');
  const imagePath = await renderXhsCover(movie);
  console.log(`✓ 封面图就绪: ${imagePath}`);

  console.log('\n[2/3] 正在生成高点击文案矩阵与安全防封导流方案...');
  const { titles, body } = generateXhsCopy(movie);
  const selectedTitle = titles[0];
  console.log(`✓ 优选标题: "${selectedTitle}"`);

  console.log('\n[3/3] 正在调起创作者服务平台执行发布流程...');
  await publishToXiaohongshu({
    imagePath,
    title: selectedTitle,
    content: body,
    autoSubmit
  });

  // 记录历史
  const history = loadHistory();
  history.push({
    id: movie.id,
    title: movie.title,
    publishedAt: new Date().toISOString(),
    imagePath
  });
  saveHistory(history);

  // 通知钉钉
  await notifyDingTalk(movie, selectedTitle);

  console.log('\n🎉【全流程执行完毕】小红书自动化引流流水线圆满完成！\n');
}

// CLI 执行
if (process.argv[1]?.endsWith('xhs-pipeline.js')) {
  const args = process.argv.slice(2);
  const autoSubmit = args.includes('--auto') || args.includes('-y');
  const keywordArg = args.find(a => !a.startsWith('-')) || '';

  runXhsPipeline({
    keyword: keywordArg,
    autoSubmit
  }).catch(err => {
    console.error('❌ 流水线执行失败:', err);
    process.exit(1);
  });
}

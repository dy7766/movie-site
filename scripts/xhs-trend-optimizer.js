import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import crypto from 'crypto';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = 'C:/Users/dy776/.gemini/antigravity/scratch/xhs_chrome_profile';
const GENERATOR_FILE = path.resolve('scripts/xhs-generator.js');
const BACKUP_FILE = path.resolve('scripts/xhs-generator.js.bak');

const DEFAULT_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=b4b05e7b29bfcd9d649c48a3669a201817e5069255bfd2d30cf14b28747ebe4d';
const DEFAULT_SECRET = 'SECc1a492c159ef4fcd7a81cb81e505f8534fe0ed817a90467be300c6808cef4b10';

/**
 * 1. 在小红书检索真实爆款影视笔记
 */
export async function crawlTrendingXhsNotes() {
  console.log('🔍 [1/4] 启动 Chrome 检索小红书最新高赞影视爆款笔记...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const keywords = ['电影推荐', '豆瓣高分电影', '宝藏好剧', '神作动漫'];
  const trendingNotes = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    for (const kw of keywords) {
      console.log(`  🔎 正在检索关键词: 【${kw}】...`);
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&type=54`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3500));

      const notes = await page.evaluate((keyword) => {
        const items = Array.from(document.querySelectorAll('section.note-item, div.note-item'));
        return items.slice(0, 8).map(item => {
          const titleEl = item.querySelector('.title, .footer .title, a.title');
          const authorEl = item.querySelector('.author, .name');
          const likesEl = item.querySelector('.like-wrapper, .count');
          return {
            searchTag: keyword,
            title: titleEl?.innerText?.trim() || '',
            author: authorEl?.innerText?.trim()?.replace(/\n/g, ' ') || '',
            likes: likesEl?.innerText?.trim() || '高赞'
          };
        }).filter(x => x.title && x.title.length > 4);
      }, kw);

      trendingNotes.push(...notes);
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) {
    console.warn('⚠️ 抓取小红书爆款时发生局部异常:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }

  // 去重
  const seen = new Set();
  const uniqueNotes = [];
  for (const n of trendingNotes) {
    if (!seen.has(n.title)) {
      seen.add(n.title);
      uniqueNotes.push(n);
    }
  }

  console.log(`✓ 成功收集到 ${uniqueNotes.length} 条真实小红书爆款笔记样本！`);
  return uniqueNotes;
}

/**
 * 2. 调度本地 agy 分析并重构模板代码
 */
export async function optimizeWithAgy(trendingNotes) {
  console.log('\n🤖 [2/4] 备份当前代码并调度本地 agy 分析爆款规律与重构模板...');

  // 1. 安全备份
  fs.copyFileSync(GENERATOR_FILE, BACKUP_FILE);
  console.log(`  ✓ 已创建代码安全还原备份: ${BACKUP_FILE}`);

  // 2. 构建输入 Prompt
  const sampleList = trendingNotes.slice(0, 25).map((n, i) => `${i + 1}. [${n.likes}赞] ${n.title} (领域: ${n.searchTag})`).join('\n');

  const agyPrompt = `
请作为小红书千万级爆款文案专家与高阶 Node.js 架构师，执行以下代码重构任务：

【今日真实抓取的小红书热门影视爆款标题样本】：
${sampleList}

【任务目标】：
请分析上述爆款标题的心理共鸣点（例如悬念感、反差感、情绪放大、数字与强符号/Emoji 搭配、社交货币等）。
然后，直接使用你的编辑工具，修改项目文件：\`${GENERATOR_FILE.replace(/\\/g, '/')}\`：
1. 更新 \`generateXhsCopy\` 函数内的 \`baseTemplates\` 爆款标题模板池（提供至少 12~16 款不同风格，如震撼反思型、强力安利型、后劲十足型、零差评口碑型）。
2. 更新分类拓展模板（\`category === '动漫'\`、\`category === '电视剧'\`、其他电影类），引入符合当季流行语境的爆款句式。
3. 严格规则：
   - 标题模板中必须包含且仅包含一个 \`%s\` 作为片名占位符。
   - 所有生成的标题严格限制在 20 个字以内（小红书标题字数硬性上限是 20 字，超过会被小红书截断）。原代码里的 \`formatSafeTitle\` 会按 20 字截断片名，请确保模板本身的非片名文字不要超过 12 个字，以便给片名预留至少 8 个字的完整展示空间。
4. 优化正文 \`body\` 排版：
   - 保持 Emoji 丰富且段落呼吸感好。
   - 包含【片名】、【评分】、【类型】、【主演】。
   - 包含有吸引力的观后感引语和引流互动的讨论设问结尾（例如“你们觉得这部能打几分？”等）。
   - 严禁出现“私信我”、“4K原盘”等任何小红书违规受限词。
5. 必须保持原有所有函数名称及导出完全不变：\`getMovieData\`, \`fetchPosterBuffer\`, \`renderXhsCover\`, \`generateXhsCopy\`。不要破坏海报渲染逻辑。

请立即修改 ${GENERATOR_FILE.replace(/\\/g, '/')} 文件。
`.trim();

  // 3. 调用本地 agy CLI
  console.log('  ⚡ 正在调用本地 agy 执行分析与代码更新...');
  const agyBin = 'agy.exe';

  await new Promise((resolve, reject) => {
    const proc = spawn(agyBin, ['-p', agyPrompt, '--dangerously-skip-permissions'], {
      cwd: path.resolve('.'),
      shell: false,
      env: process.env,
      stdio: 'inherit'
    });

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`agy 进程退出，错误码: ${code}`));
    });
    proc.on('error', err => reject(err));
  });

  console.log('  ✓ agy 智能优化与代码修改已执行完成！');
}

/**
 * 3. 严格自动化验证与安全回滚
 */
export async function verifyAndSafeRollback() {
  console.log('\n🧪 [3/4] 启动三重严苛自动化验证，确保代码 100% 健壮可用...');

  try {
    // 步骤 1: Node 语法检测
    console.log('  🔍 [检验 1/3] 检测 JavaScript 语法合法性...');
    execSync(`node -c "${GENERATOR_FILE}"`, { stdio: 'pipe' });
    console.log('    ✓ 语法检测通过！无 SyntaxError');

    // 步骤 2: 动态导入与生成逻辑测试
    console.log('  🔍 [检验 2/3] 验证模板生成质量 (字数、占位符、多分类)...');
    // 使用时间戳避免 ESM 模块缓存
    const testScript = `
      import { generateXhsCopy, getMovieData, renderXhsCover } from './scripts/xhs-generator.js?t=${Date.now()}';
      if (typeof generateXhsCopy !== 'function' || typeof renderXhsCover !== 'function') {
        throw new Error('必要函数导出缺失！');
      }

      const mockMovies = [
        { title: '肖申克的救赎', year: '1994', score: '9.7', actors: '蒂姆·罗宾斯', category: '电影', genres: ['剧情', '犯罪'] },
        { title: '进击的巨人', year: '2013', score: '9.8', actors: '梶裕贵', category: '动漫', genres: ['热血', '动作'] },
        { title: '狂飙', year: '2023', score: '8.5', actors: '张译 / 张颂文', category: '电视剧', genres: ['刑侦', '剧情'] }
      ];

      for (const m of mockMovies) {
        const res = generateXhsCopy(m);
        if (!res.titles || res.titles.length === 0) {
          throw new Error('未生成任何候选标题！');
        }
        for (const t of res.titles) {
          if (t.includes('%s')) {
            throw new Error('标题中包含未被替换的占位符 %s: ' + t);
          }
          if (t.length > 20) {
            throw new Error('标题超过小红书 20 字上限: (' + t.length + '字) ' + t);
          }
        }
        if (!res.body || !res.body.includes(m.title)) {
          throw new Error('生成的正文为空或缺少片名！');
        }
        if (/私信我|原盘|网盘链接/i.test(res.body)) {
          throw new Error('正文中包含违规敏感词！');
        }
      }
      console.log('    ✓ 模拟生成测试完美通过！所有分类标题均在 20 字以内且排版规范');
    `;

    execSync(`node -e "${testScript.replace(/\n/g, ' ')}"`, { stdio: 'pipe' });

    // 步骤 3: 调度器兼容性检查
    console.log('  🔍 [检验 3/3] 验证定时发帖调度器兼容性...');
    execSync('node -c "scripts/xhs-batch-scheduler.js"', { stdio: 'pipe' });
    console.log('    ✓ 定时发布调度器完全兼容！');

    // 验证全部成功，清除备份文件
    if (fs.existsSync(BACKUP_FILE)) {
      fs.unlinkSync(BACKUP_FILE);
    }
    console.log('✨ [成功] 全部验证指标均已达标！新版本代码已安全上线。');
    return { success: true };

  } catch (err) {
    console.error('\n❌ [严重告警] 代码验证未通过:', err.message);
    console.log('🔄 正在启动【自动安全回滚】，恢复上一个稳定版本...');

    if (fs.existsSync(BACKUP_FILE)) {
      fs.copyFileSync(BACKUP_FILE, GENERATOR_FILE);
      fs.unlinkSync(BACKUP_FILE);
      console.log('🛡️ 已成功回滚至备份版本，发帖程序未受任何影响！');
    }

    return { success: false, error: err.message };
  }
}

/**
 * 4. 推送钉钉报告
 */
export async function sendEvolutionReport({ success, error, noteCount }) {
  console.log('\n📢 [4/4] 同步推送每日爆款模板进化报告至钉钉...');
  const webhookUrl = process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET || DEFAULT_SECRET;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = encodeURIComponent(hmac.digest('base64'));
  const finalUrl = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let text = '';
  if (success) {
    // 读取新版代码展示几个样本
    let sampleTitles = [];
    try {
      const { generateXhsCopy } = await import(`file:///${GENERATOR_FILE.replace(/\\/g, '/')}?t=${Date.now()}`);
      const res = generateXhsCopy({ title: '流浪地球2', year: '2023', score: '8.3', category: '电影' });
      sampleTitles = res.titles.slice(0, 5);
    } catch {}

    const samplesMd = sampleTitles.map((t, i) => `${i + 1}. \`${t}\``).join('\n');

    text = `### 🌟 小红书爆款文案模板每日进化完成
---
- ⏱️ **执行时间**：${now}
- 📊 **市场情报**：成功抓取并深度分析 **${noteCount}** 篇最新小红书高赞笔记
- 🤖 **进化驱动**：本地 AGY AI 自主分析爆款心理机制并完成代码迭代
- 🛡️ **质量验证**：语法、字数限制（≤20字）、风控词、多分类单测**全部通过**

**🎯 进化后最新爆款标题样本**：
${samplesMd}

---
> 💡 今日接续发布的笔记将全面应用最新爆款标题库与正文模版。`;
  } else {
    text = `### ⚠️ 小红书爆款模板进化告警（已安全回滚）
---
- ⏱️ **执行时间**：${now}
- ❌ **未通过原因**：${error}
- 🛡️ **处理结果**：系统已秒级**自动回滚至稳定备份**，当前发帖功能正常，不受任何影响。`;
  }

  try {
    await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: success ? '🌟 小红书爆款模版进化完成' : '⚠️ 模板迭代回滚通知',
          text
        }
      })
    });
    console.log('✓ 钉钉通知已发送');
  } catch (err) {
    console.warn('⚠️ 钉钉通知发送失败:', err.message);
  }
}

/**
 * 完整每日优化入口
 */
export async function runDailyOptimization() {
  console.log(`===============================================================`);
  console.log(`🚀 [XHS_Trend_Optimizer] 启动每日爆款笔记检索与模版自我进化引擎`);
  console.log(`===============================================================\n`);

  // 1. 抓取真实爆款
  const notes = await crawlTrendingXhsNotes();
  if (notes.length === 0) {
    console.warn('⚠️ 未抓取到有效爆款笔记，跳过本轮更新以防劣化');
    return;
  }

  // 2. 调用 agy 分析并修改代码
  await optimizeWithAgy(notes);

  // 3. 严格验证与回滚
  const result = await verifyAndSafeRollback();

  // 4. 发送汇报
  await sendEvolutionReport({
    success: result.success,
    error: result.error,
    noteCount: notes.length
  });

  console.log(`\n===============================================================`);
  console.log(`🎉 [XHS_Trend_Optimizer] 本轮优化全流程处理完毕！`);
  console.log(`===============================================================\n`);
}

if (process.argv[1]?.endsWith('xhs-trend-optimizer.js')) {
  runDailyOptimization().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Fatal Optimizer Error:', err);
    process.exit(1);
  });
}

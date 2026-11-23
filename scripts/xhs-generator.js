import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT_DIR = path.resolve('public/xhs-covers');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 1. 从 Supabase 获取影视详情
 */
export async function getMovieData(keyword) {
  const pool = getDbPool();
  let query = 'SELECT * FROM resources ';
  const params = [];
  if (keyword) {
    query += 'WHERE title ILIKE $1 LIMIT 1';
    params.push(`%${keyword}%`);
  } else {
    query += 'ORDER BY created_at DESC LIMIT 1';
  }
  const res = await pool.query(query, params);
  return res.rows[0] || null;
}

/**
 * 健壮下载海报为 Buffer（自动尝试环境变量代理、本地 Clash 端口 7897/7890、CDN 镜像 wsrv.nl 及直连）
 */
export function fetchPosterBuffer(rawPoster) {
  if (!rawPoster) return null;
  const isWin = process.platform === 'win32';
  const curlBin = isWin ? 'curl.exe' : 'curl';
  const proxies = [
    process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
    'http://127.0.0.1:7897',
    'http://127.0.0.1:7890',
    null
  ].filter((v, i, a) => a.indexOf(v) === i);

  // 1. 尝试直接拉取原图
  for (const proxy of proxies) {
    try {
      const args = ['-s', '-L', '--max-time', '15'];
      if (proxy) args.push('-x', proxy);
      args.push(rawPoster);
      const buf = execFileSync(curlBin, args, { maxBuffer: 15 * 1024 * 1024, timeout: 18000 });
      if (buf && buf.length > 2000) {
        return buf;
      }
    } catch (e) {}
  }

  // 2. 尝试国内可访问的 CDN 镜像
  const mirrorUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawPoster)}`;
  for (const proxy of proxies) {
    try {
      const args = ['-s', '-L', '--max-time', '15'];
      if (proxy) args.push('-x', proxy);
      args.push(mirrorUrl);
      const buf = execFileSync(curlBin, args, { maxBuffer: 15 * 1024 * 1024, timeout: 18000 });
      if (buf && buf.length > 2000) {
        return buf;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * 2. 使用 Chrome 无头渲染生成 3:4 爆款视觉封面图 (1080 x 1440)
 */
export async function renderXhsCover(movie, forceRegenerate = false) {
  const fileName = `${movie.title.replace(/[\/\\?%*:|"<>]/g, '_')}_xhs_3x4.jpg`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  // 视觉完整封面文件必须 > 200KB；小于 200KB 说明缺少封面海报需重新生成
  if (!forceRegenerate && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 200000) {
    console.log(`  ✓ 复用已缓存的高清视觉海报: ${outputPath}`);
    return outputPath;
  }

  const rawPoster = movie.poster_url || 'https://image.tmdb.org/t/p/w500/dXjYk7fnA6HNqhJHTnmeD6rV4Aw.jpg';
  const posterBuf = fetchPosterBuffer(rawPoster);
  if (!posterBuf) {
    throw new Error(`无法获取影视《${movie.title}》的海报图片，取消生成以防产出空白封面`);
  }
  const posterUrl = `data:image/jpeg;base64,${posterBuf.toString('base64')}`;
  console.log(`  ✓ 成功下载海报并转为本地 Base64 内存直嵌 (大小: ${(posterBuf.length / 1024).toFixed(1)} KB)`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1440, deviceScaleFactor: 1 });
  const genres = Array.isArray(movie.tags) ? movie.tags.slice(0, 3) : ['剧情', '热门'];
  const actors = movie.actors || '群星领衔主演';
  const score = movie.score || 8.0;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
    body {
      width: 1080px;
      height: 1440px;
      background: #090d16;
      color: #fff;
      overflow: hidden;
      position: relative;
    }
    .backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-image: url('${posterUrl}');
      background-size: cover;
      background-position: center top;
      filter: blur(32px) brightness(0.32);
      transform: scale(1.1);
    }
    .overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(9,13,22,0.3) 0%, rgba(9,13,22,0.8) 55%, rgba(9,13,22,0.98) 100%);
    }
    .content {
      position: relative;
      z-index: 10;
      width: 100%;
      height: 100%;
      padding: 60px 70px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 107, 0, 0.15);
      border: 1px solid rgba(255, 107, 0, 0.4);
      padding: 12px 26px;
      border-radius: 40px;
      font-size: 24px;
      font-weight: 700;
      color: #ff8c00;
    }
    .quality-badge {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      padding: 12px 24px;
      border-radius: 14px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 1px;
      box-shadow: 0 4px 20px rgba(234, 88, 12, 0.4);
    }
    .center-showcase {
      display: flex;
      gap: 50px;
      align-items: center;
      margin-top: 20px;
    }
    .poster-frame {
      width: 440px;
      height: 620px;
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 30px 60px rgba(0,0,0,0.85), 0 0 0 2px rgba(255,255,255,0.15);
      flex-shrink: 0;
    }
    .poster-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .info-side {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .tagline-pill {
      display: inline-block;
      color: #fbbf24;
      font-size: 24px;
      font-weight: 700;
      background: rgba(251, 191, 36, 0.12);
      padding: 8px 18px;
      border-radius: 8px;
      border-left: 4px solid #fbbf24;
    }
    .movie-title {
      font-size: 64px;
      font-weight: 900;
      line-height: 1.15;
      text-shadow: 0 4px 16px rgba(0,0,0,0.6);
      background: linear-gradient(180deg, #ffffff 40%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .meta-row {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .score-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 32px;
      font-weight: 800;
      color: #fbbf24;
    }
    .genres-list {
      display: flex;
      gap: 10px;
    }
    .genre-tag {
      background: rgba(255,255,255,0.1);
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 20px;
      color: #e2e8f0;
    }
    .cast-text {
      font-size: 22px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .bottom-card {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 107, 0, 0.35);
      border-radius: 28px;
      padding: 34px 44px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .cta-text h3 {
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 8px;
    }
    .cta-text p {
      font-size: 22px;
      color: #94a3b8;
    }
    .cta-btn {
      background: linear-gradient(135deg, #ff6b00, #ff8c00);
      color: #fff;
      font-size: 24px;
      font-weight: 800;
      padding: 16px 32px;
      border-radius: 20px;
      box-shadow: 0 10px 25px rgba(255, 107, 0, 0.4);
    }
  </style>
</head>
<body>
  <div class="backdrop"></div>
  <div class="overlay"></div>
  <div class="content">
    <div class="header-bar">
      <div class="brand-badge">🎬 影迷私藏推荐</div>
      <div class="quality-badge">豆瓣高分 · 口碑佳作</div>
    </div>

    <div class="center-showcase">
      <div class="poster-frame">
        <img src="${posterUrl}" />
      </div>
      <div class="info-side">
        <div class="tagline-pill">${movie.year} · 必看高分神作</div>
        <h1 class="movie-title">《${movie.title}》</h1>
        <div class="meta-row">
          <div class="score-badge">⭐ ${score}分</div>
          <div class="genres-list">
            ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
          </div>
        </div>
        <div class="cast-text">
          <strong>领衔主演：</strong><br/>
          ${actors}
        </div>
      </div>
    </div>

    <div class="bottom-card">
      <div class="cta-text">
        <h3>院线超清视效 · 沉浸观影</h3>
        <p>杜比全景声 · 细节纤毫毕现 · 建议大屏观赏</p>
      </div>
      <div class="cta-btn">影迷私藏推荐 ⭐</div>
    </div>
  </div>
</body>
</html>
  `;

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // 等待海报图片真实加载完毕
    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
          setTimeout(resolve, 3000);
        });
      }));
    });
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: outputPath, type: 'jpeg', quality: 95 });
    return outputPath;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * 3. 生成小红书高点击文案矩阵
 */
export function generateXhsCopy(movie) {
  const title = movie.title || '未知片名';
  const year = movie.year || '';
  const actors = Array.isArray(movie.actors) ? movie.actors.join(' / ') : (movie.actors || '群星领衔主演');
  const score = movie.score || 8.0;

  // 兼容 tags, genres (数组、JSON字符串或逗号分隔)
  let genres = ['剧情', '热门'];
  if (Array.isArray(movie.tags) && movie.tags.length > 0) {
    genres = movie.tags;
  } else if (movie.genres) {
    try {
      const parsed = Array.isArray(movie.genres) ? movie.genres : JSON.parse(movie.genres);
      if (Array.isArray(parsed) && parsed.length > 0) genres = parsed;
    } catch (e) {
      if (typeof movie.genres === 'string') {
        genres = movie.genres.split(/[\/,，\s]+/).filter(Boolean);
      }
    }
  }

  // 小红书标题上限严格为 20 个字。构建多风格爆款标题库，非片名文字严格控制在 9~12 字以内
  const formatSafeTitle = (template, movieTitle) => {
    const overhead = template.replace('%s', '').length;
    const maxTitleLen = Math.max(2, 20 - overhead);
    const cleanName = movieTitle.length > maxTitleLen ? movieTitle.slice(0, maxTitleLen) : movieTitle;
    return template.replace('%s', cleanName).slice(0, 20);
  };

  // 1. 基础爆款模板池 (覆盖：强力安利型、震撼反思型、后劲十足型、零差评口碑型、情绪钩子型)
  // 严格规则：仅含一个 %s，overhead (去 %s 后的 length) 必须 <= 12，给片名预留至少 8 字
  const baseTemplates = [
    // [强力安利型]
    '反复刷3遍❗️《%s》真封神',
    '求你们去看《%s》❗️太顶了',
    '私心吹爆❗️最爱《%s》',
    '想推给所有人❗️《%s》封神',

    // [震撼反思与生理共鸣型]
    '根本走不出来❗️《%s》看哭',
    '后劲太大了❗️《%s》失眠',
    '看完彻底沦陷❗️《%s》太绝',
    '生理性喜欢❗️《%s》太震撼',

    // [零差评口碑与高分型]
    '公认零差评❗️《%s》太好看',
    '评分9+神作❗️《%s》封神',
    '低调却封神❗️《%s》后劲大',
    '高分神作❗️《%s》片荒必看',

    // [极致反差与情绪钩子型]
    '第一秒就沦陷❗️《%s》太疯',
    '太敢拍了❗️《%s》后劲极大',
    '年度黑马巨作❗️《%s》封神',
    '答应我一定要看《%s》❗️'
  ];

  const category = movie.category || '电影';
  if (category === '动漫') {
    baseTemplates.push(
      '讨论度低却封神❗️《%s》',
      '治愈天花板🌸《%s》太绝',
      '此生必看神番❗️《%s》对味',
      '9分神漫❗️《%s》后劲贼大',
      '每一集都封神❗️《%s》太顶',
      '画风太对味了❗️《%s》封神'
    );
  } else if (category === '电视剧') {
    baseTemplates.push(
      '第一集就杀疯❗️《%s》太顶',
      '播了播了❗️《%s》太敢拍',
      '熬夜狂刷❗️《%s》停不下',
      '年度高分好剧❗️《%s》真香',
      '连刷全集❗️《%s》后劲太足',
      '太敢拍了❗️《%s》直接封神'
    );
  } else {
    baseTemplates.push(
      '8分神作❗️《%s》残忍震撼',
      '年度必看大片❗️《%s》太绝',
      '每帧都是壁纸❗️《%s》封神',
      '反转又反转❗️《%s》猜不到',
      '看完直接跪了❗️《%s》封神',
      '影院欠张票❗️《%s》太敢拍'
    );
  }

  const titles = baseTemplates.map(tpl => formatSafeTitle(tpl, title));
  const selectedTitle = titles[Math.floor(Math.random() * titles.length)];

  // 智能匹配分类专属官方热门话题（严禁使用“4K原盘”、“私信”等受限风控词）
  let defaultTopics = ['电影推荐', title];
  if (category === '动漫') {
    defaultTopics = ['动漫推荐', '神作动漫', '治愈系动漫', '豆瓣高分动漫', '追番日常', title];
  } else if (category === '电视剧') {
    defaultTopics = ['电视剧推荐', '宝藏好剧', '追剧日常', '高分好剧', '一起追剧', title];
  } else {
    defaultTopics = ['电影推荐', '豆瓣高分电影', '周末看电影', '宝藏电影', '电影美学', title];
  }
  const topics = Array.from(new Set(defaultTopics)).filter(Boolean);
  const formattedTopics = topics.map(t => `#${t}`).join(' ');

  // 深度观后感引语与氛围描述
  const cleanIntro = (movie.intro || '').replace(/\s+/g, ' ').trim();
  const highlightQuote = cleanIntro
    ? (cleanIntro.length > 120 ? cleanIntro.slice(0, 120) + '...' : cleanIntro)
    : '剧情层层递进，细节耐人寻味，后劲实在太大了！';

  let vibeReview = '';
  let viewGuide = '';
  if (category === '动漫') {
    vibeReview = '🌸 画风每一帧都能直接截图当壁纸！剧情既有直击心灵的治愈温柔，又有令人拍案叫绝的高燃反转。看完内心久久不能平静，真的是后劲极大的一部神仙番！';
    viewGuide = '拉上窗帘、佩戴耳机，在安静的夜晚静静感受属于次元世界的纯粹与浪漫～';
  } else if (category === '电视剧') {
    vibeReview = '🔥 节奏紧凑完全无尿点，全员演技与智商双在线！从第一集就直接杀疯，剧情高能反转不断，根本停不下来，不知不觉就刷到停不下来！';
    viewGuide = '周末追剧沉浸感拉满！备好快乐水与零食，一口气连刷全集最过瘾～';
  } else {
    vibeReview = '🎞️ 视听质感与镜头语言登峰造极，光影美学直接拉满！全程让人屏住呼吸，后劲大到看完几天都走不出来，是真正值得反复咀嚼的影史佳作。';
    viewGuide = '强烈建议关掉房间灯光，调高音量沉浸式观看，感受细节与情绪交织的视听震撼！';
  }

  // 正文文案：排版呼吸感强，Emoji 丰富，纯净影视探讨与互动设问（严禁违规词，高转化留评设计）
  const body = `
🎬【片名】《${title}》${year ? ` (${year})` : ''}
⭐【评分】豆瓣 ${score} 分 · 高口碑神作
🏷️【类型】${genres.slice(0, 3).join(' / ')}
👥【主演】${actors}

━━━━━━━━━━━━━━━

💡【精选台词 & 核心看点】：
“${highlightQuote}”

💫【深度微评 · 观后心境】：
${vibeReview}

━━━━━━━━━━━━━━━

🍿【沉浸观影 TIPS】：
${viewGuide}

💬【影迷唠嗑区 · 灵魂发问】：
看过的宝子们快在评论区集合👇
① 满分 10 分，你愿意给这部作品打几分？
② 哪一幕或哪句台词让你瞬间破防、起鸡皮疙瘩？
③ 还有哪些同类型的私藏冷门神作？求在评论区互相安利一波～✨

${formattedTopics}
`.trim();

  return { titles, selectedTitle, body, topics };
}

/**
 * 主执行入口
 */
async function main() {
  const keyword = process.argv[2] || '';
  console.log(`\n===============================================================`);
  console.log(`🎨 启动小红书引流素材全自动生成引擎...`);
  console.log(`===============================================================`);

  const movie = await getMovieData(keyword);
  if (!movie) {
    console.error('❌ 未在数据库中检索到对应影视数据');
    process.exit(1);
  }

  console.log(`🎬 锁定目标影视: 《${movie.title}》 (${movie.year})`);

  console.log('🖼️ 正在调用 Chrome 引擎渲染 3:4 (1080x1440) 黄金比例封面图...');
  const imagePath = await renderXhsCover(movie, true);
  console.log(`✓ 封面图生成完成: ${imagePath}`);

  console.log('✍️ 正在生成爆款文案与安全导流闭环...');
  const { titles, selectedTitle, body } = generateXhsCopy(movie);

  console.log(`\n===============================================================`);
  console.log(`🎲【本次随机命中的优选标题】: "${selectedTitle}"`);
  console.log(`📌【备选爆款标题库 (共 ${titles.length} 款不同风格)】:`);
  titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log(`---------------------------------------------------------------`);
  console.log(`📝【小红书正文排版与安全导流文案】:\n`);
  console.log(body);
  console.log(`===============================================================`);
  console.log(`🖼️ 封面图片绝对路径: file:///${imagePath.replace(/\\/g, '/')}`);
  console.log(`===============================================================\n`);

  process.exit(0);
}

if (process.argv[1]?.endsWith('xhs-generator.js')) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

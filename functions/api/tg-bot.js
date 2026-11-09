// Cloudflare Pages Function: /api/tg-bot
// 星光影库 · Telegram 交流群智能自动搜片机器人 Webhook 服务
// 运行在 Cloudflare 全球边缘网络，直连 Telegram API 与 Supabase 数据库，零服务器成本，毫秒级响应

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';
const DEFAULT_BOT_TOKEN = '9105332535:AAEyAFqc0TFyWQysqF_TfVQpMMDkPT8tT58';

export async function onRequestPost(context) {
  const token = context.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;

  try {
    let update = {};
    try {
      const text = await context.request.text();
      update = JSON.parse(text || '{}');
    } catch (_) {
      update = {};
    }

    // 1. 处理回调按钮点击 (Callback Query)
    if (update.callback_query) {
      await handleCallbackQuery(token, update.callback_query);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 2. 处理常规消息 (Message)
    const msg = update.message || update.channel_post;
    if (!msg || !msg.text) {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const chatId = msg.chat.id;
    const isPrivate = msg.chat.type === 'private';
    const text = msg.text.trim();
    const messageId = msg.message_id;

    // A. 处理 /start 或 /help 问候
    if (text.startsWith('/start') || text.startsWith('/help')) {
      const welcomeText = `👋 <b>欢迎来到星光影库搜片助手！</b>\n\n` +
        `🍿 <b>使用方法非常简单：</b>\n` +
        `• 群内发送：<code>搜 抓娃娃</code> 或 <code>找 繁花</code>\n` +
        `• 标准指令：<code>/search 庆余年</code>\n` +
        `• 今日热门：<code>/hot</code>（查看近期爆款榜单）\n` +
        `• 打开官网：<code>/site</code>（或直接点击左下角按钮）\n` +
        (isPrivate ? `• 私聊直接发送片名即可秒级检索！\n\n` : `\n`) +
        `⚡ 检索成功后将秒级返回 4K 原盘、免播切片与网盘秒存卡片。\n` +
        `🌐 官方片库：<a href="https://xkykmovie.com/">xkykmovie.com</a>`;

      await callTgApi(token, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: messageId,
        text: welcomeText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎬 打开星光影库 (小程序)', web_app: { url: 'https://xkykmovie.com/' } },
              { text: '🔍 探索全部片库', url: 'https://xkykmovie.com/explore' }
            ]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // B. 处理 /site 官网入口
    if (text.startsWith('/site')) {
      const siteText = `🌐 <b>星光影库 (Starlight Movie)</b>\n\n` +
        `海量 4K 院线大片、热播连续剧、顶级综艺与动漫极速更新。\n` +
        `零广告、支持免播放切片点播与 UC / 夸克网盘无损原盘秒存！\n\n` +
        `👉 点击下方按钮即可直接在 Telegram 内以极速小程序浏览：`;

      await callTgApi(token, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: messageId,
        text: siteText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎬 立即在 TG 内打开影库', web_app: { url: 'https://xkykmovie.com/' } }
            ],
            [
              { text: '🌐 在外部浏览器打开', url: 'https://xkykmovie.com/' }
            ]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // C. 处理 /hot 热门榜单
    if (text.startsWith('/hot')) {
      await sendHotMoviesMessage(token, chatId, messageId);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // D. 处理未带片名的单纯 /search 或 /find
    if (text.match(/^\/(?:search|find|s)(?:@[a-zA-Z0-9_]+)?$/i)) {
      const guideText = `🔍 <b>请在指令后带上您想看的片名哦！</b>\n\n` +
        `💡 <b>群内搜片推荐姿势：</b>\n` +
        `• <b>方式 1（最简单）</b>：直接发送 <code>搜 抓娃娃</code> 或 <code>找 繁花</code>\n` +
        `• <b>方式 2（带片名指令）</b>：发送 <code>/search 抓娃娃</code>\n` +
        `• <b>方式 3（全库浏览）</b>：点击下方按钮直接在 TG 里打开影库选片 👇`;

      await callTgApi(token, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: messageId,
        text: guideText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🎬 打开星光影库 (小程序选片)', web_app: { url: 'https://xkykmovie.com/explore' } }
            ],
            [
              { text: '🔥 查看今日热门榜单', callback_data: 'cmd:hot' }
            ]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // B. 提取搜片关键词
    const query = extractSearchQuery(text, isPrivate);
    if (!query) {
      // 在群聊中非搜索指令则忽略，避免打扰正常聊天
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // C. 直连 Supabase 检索片库资源
    const results = await searchMoviesFromSupabase(query);

    if (results.length === 0) {
      // 未匹配到结果
      const notFoundText = `抱歉群友，星光影库片库暂未收录<b>《${escapeHtml(query)}》</b> 😔\n\n` +
        `📝 已自动将该片加入【心愿求片清单】！\n` +
        `🌐 您也可以前往官网自主翻阅全部片源：\n` +
        `<a href="https://xkykmovie.com/explore">👉 点击进入片库多维检索中心</a>`;

      await callTgApi(token, 'sendMessage', {
        chat_id: chatId,
        reply_to_message_id: messageId,
        text: notFoundText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (results.length === 1) {
      // 精确匹配到 1 部：直接发送精美图文海报卡片
      await sendSingleMovieCard(token, chatId, messageId, results[0]);
    } else {
      // 匹配到多部：先发第一部卡片，下方附带其余候选条目的快捷切换按钮
      await sendMultiMovieChoice(token, chatId, messageId, query, results);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('TG Webhook error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200 });
  }
}

// 诊断与一键配置 Webhook / 快捷操作菜单入口
export async function onRequestGet(context) {
  const token = context.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
  const url = new URL(context.request.url);

  // 1. 一键激活 Webhook 绑定 + 左下角快捷菜单 (Web App) + 指令快捷抽屉 (Commands)
  if (url.searchParams.get('setup') === '1' || url.searchParams.get('menu') === '1') {
    const webhookUrl = 'https://xkykmovie.com/api/tg-bot';
    
    // a) 绑定 Webhook 监听
    const setHookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`);
    const setHookData = await setHookRes.json();

    // b) 设置快捷指令抽屉 (Commands Menu)
    const setCmdsRes = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'hot', description: '🔥 今日热门：一键查看爆款大片排行榜' },
          { command: 'site', description: '🎬 官网小程序：直接在 TG 浏览影库' },
          { command: 'search', description: '🔍 搜片指引：输入 /search 片名 或 搜 片名' },
          { command: 'help', description: '❓ 使用帮助：群内搜片与求片指南' }
        ]
      })
    });
    const setCmdsData = await setCmdsRes.json();

    // c) 设置左下角快捷菜单按钮为 Web App 小程序 (直达星光影库)
    const setMenuRes = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: '🎬 星光影库',
          web_app: {
            url: 'https://xkykmovie.com/'
          }
        }
      })
    });
    const setMenuData = await setMenuRes.json();

    return new Response(JSON.stringify({
      success: true,
      message: '🎉 Webhook、左下角 Web App 快捷按钮与指令快捷抽屉已全部配置成功！',
      results: {
        webhook: setHookData,
        commandsMenu: setCmdsData,
        bottomLeftMenuButton: setMenuData
      }
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 2. 查看当前 Webhook 与菜单按钮状态
  if (url.searchParams.get('info') === '1') {
    const [infoRes, menuRes, cmdsRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then(r => r.json()).catch(() => null),
      fetch(`https://api.telegram.org/bot${token}/getChatMenuButton`).then(r => r.json()).catch(() => null),
      fetch(`https://api.telegram.org/bot${token}/getMyCommands`).then(r => r.json()).catch(() => null)
    ]);

    return new Response(JSON.stringify({
      action: 'getBotSettingsInfo',
      webhook: infoRes,
      menuButton: menuRes,
      commands: cmdsRes
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(JSON.stringify({
    status: 'online',
    service: 'Starlight Movie TG Search Bot Webhook',
    bot: '@xkykMovie_bot',
    webhookEndpoint: 'https://xkykmovie.com/api/tg-bot',
    quickSetupUrl: 'https://xkykmovie.com/api/tg-bot?setup=1',
    checkInfoUrl: 'https://xkykmovie.com/api/tg-bot?info=1',
    time: new Date().toISOString()
  }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/**
 * 获取今日热门推荐列表
 */
async function getHotMoviesFromSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resources?has_metadata=eq.true&is_released=eq.true&order=year.desc,score.desc&limit=5`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (_) {
    return [];
  }
}

/**
 * 提取片名关键词
 */
function extractSearchQuery(text, isPrivate) {
  let clean = text.replace(/@xkykMovie_bot/gi, '').trim();

  // 1. 命令模式: /search, /find, /s
  const cmdMatch = clean.match(/^\/(?:search|find|s)(?:@[a-zA-Z0-9_]+)?\s+(.+)$/i);
  if (cmdMatch) return cleanKeyword(cmdMatch[1]);

  // 2. 中文前缀模式: 搜、找、有没有、看、求
  const prefixMatch = clean.match(/^(?:搜|找|求|看|有没有|请问有|求片)[:：\s]+(.+)$/i);
  if (prefixMatch) return cleanKeyword(prefixMatch[1]);

  // 3. 常见“搜xxx”无空格情况
  const tightMatch = clean.match(/^(?:搜|找)(.+)$/i);
  if (tightMatch && tightMatch[1].length >= 2) return cleanKeyword(tightMatch[1]);

  // 4. 私聊场景：任何非以 / 开头的普通文本均默认为片名
  if (isPrivate && !clean.startsWith('/')) {
    return cleanKeyword(clean);
  }

  return null;
}

function cleanKeyword(kw) {
  if (!kw) return '';
  return kw.replace(/[《》""''\[\]【】]/g, '').trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 直连 Supabase 模糊检索影视资源
 */
async function searchMoviesFromSupabase(keyword) {
  const enc = encodeURIComponent(keyword);
  const url = `${SUPABASE_URL}/rest/v1/resources?has_metadata=eq.true&or=(title.ilike.*${enc}*,original_title.ilike.*${enc}*,actors.ilike.*${enc}*)&order=year.desc,score.desc&limit=5`;

  try {
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

/**
 * 根据 ID 查询单部影视
 */
async function getMovieById(id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resources?id=eq.${id}&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data[0] ? data[0] : null;
  } catch (_) {
    return null;
  }
}

/**
 * 发送单部精美图文海报卡片 (带专属 PID 转存与免播按钮)
 */
async function sendSingleMovieCard(token, chatId, replyToId, movie) {
  const title = movie.title || '精选热播影视';
  const year = movie.year || '2024';
  const score = movie.score ? `★ ${Number(movie.score).toFixed(1)}` : '★ 8.0+ 推荐';
  const category = movie.category || '电影';
  const actors = movie.actors ? movie.actors.slice(0, 80) : '全明星阵容';
  const intro = movie.intro ? movie.intro.slice(0, 110) + '...' : '高清原盘无损转存，免广告在线极速秒播。';
  const detailUrl = `https://xkykmovie.com/movie/${movie.id}`;

  const caption = `🎬 <b>【星光影库·搜片结果】</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🍿 <b>片名</b>：<b>${escapeHtml(title)}</b> (${year})\n` +
    `⭐ <b>评分</b>：<b>${score}</b> | <b>分类</b>：${category}\n` +
    `👥 <b>主演</b>：${escapeHtml(actors)}\n\n` +
    `📖 <b>剧情</b>：${escapeHtml(intro)}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `⚡ <b>资源直达通道</b>：\n` +
    (movie.online_play_url ? `▶️ <a href="${detailUrl}#onlinePlayerSection">在线免广告极速看</a>\n` : '') +
    (movie.share_link_uc ? `📥 <a href="${movie.share_link_uc}">UC网盘专属原盘秒存</a>\n` : '') +
    (movie.share_link ? `💾 <a href="${movie.share_link}">夸克网盘无损极速存</a>\n` : '') +
    `🌐 <a href="${detailUrl}">在星光影库官网查看完整剧集与画廊</a>`;

  // 构造内联操作按钮
  const inlineButtons = [];
  const actionRow = [];

  if (movie.online_play_url) {
    actionRow.push({ text: '▶️ 在线免播', url: `${detailUrl}#onlinePlayerSection` });
  }
  if (movie.share_link_uc) {
    actionRow.push({ text: '⚡ UC秒存', url: movie.share_link_uc });
  }
  if (movie.share_link) {
    actionRow.push({ text: '💾 夸克转存', url: movie.share_link });
  }

  if (actionRow.length > 0) inlineButtons.push(actionRow);
  inlineButtons.push([
    { text: '🌐 打开官网详情页', url: detailUrl },
    { text: '🔍 检索更多片源', url: 'https://xkykmovie.com/explore' }
  ]);

  const poster = movie.poster_url || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=600';

  // 优先发送海报图文
  const res = await callTgApi(token, 'sendPhoto', {
    chat_id: chatId,
    reply_to_message_id: replyToId,
    photo: poster,
    caption: caption,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: inlineButtons }
  });

  // 若图片发送失败则降级为文本发送
  if (!res.ok) {
    await callTgApi(token, 'sendMessage', {
      chat_id: chatId,
      reply_to_message_id: replyToId,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineButtons }
    });
  }
}

/**
 * 匹配到多部候选时：直接推荐最佳匹配，并附带其余候选按钮
 */
async function sendMultiMovieChoice(token, chatId, replyToId, query, movies) {
  // 先发第一部
  await sendSingleMovieCard(token, chatId, replyToId, movies[0]);

  // 若还有其他候选条目，发送一条简洁的选择列表
  const otherMovies = movies.slice(1, 5);
  if (otherMovies.length > 0) {
    const keyboard = otherMovies.map(m => [
      { text: `🎬 《${m.title}》 (${m.year || '热播'})`, callback_data: `movie:${m.id}` }
    ]);

    await callTgApi(token, 'sendMessage', {
      chat_id: chatId,
      text: `💡 为您检索到关键词<b>《${escapeHtml(query)}》</b>的其他相关片源：`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

/**
 * 处理用户点击候选影片回调或快捷指令
 */
async function handleCallbackQuery(token, query) {
  const queryId = query.id;
  const data = query.data || '';
  const chatId = query.message?.chat?.id;

  if (data === 'cmd:hot' && chatId) {
    await callTgApi(token, 'answerCallbackQuery', { callback_query_id: queryId, text: '正在加载热门爆款榜单...' });
    await sendHotMoviesMessage(token, chatId, null);
    return;
  }

  if (data.startsWith('movie:')) {
    const movieId = data.replace('movie:', '');
    const movie = await getMovieById(movieId);
    if (movie && chatId) {
      await callTgApi(token, 'answerCallbackQuery', { callback_query_id: queryId, text: `正在为您加载《${movie.title}》...` });
      await sendSingleMovieCard(token, chatId, null, movie);
      return;
    }
  }

  await callTgApi(token, 'answerCallbackQuery', { callback_query_id: queryId, text: '已收到指令' });
}

/**
 * 发送今日热门爆款榜单
 */
async function sendHotMoviesMessage(token, chatId, replyToId = null) {
  const hotMovies = await getHotMoviesFromSupabase();
  if (hotMovies.length === 0) {
    await callTgApi(token, 'sendMessage', {
      chat_id: chatId,
      reply_to_message_id: replyToId,
      text: '暂无热门榜单数据，请直接在群内发送【搜 片名】检索！'
    });
    return;
  }

  const keyboard = hotMovies.map(m => [
    { text: `🔥 《${m.title}》 (${m.year || '热播'}) ★ ${m.score || '8.5'}`, callback_data: `movie:${m.id}` }
  ]);

  await callTgApi(token, 'sendMessage', {
    chat_id: chatId,
    reply_to_message_id: replyToId,
    text: `🔥 <b>【星光影库·今日热门爆款推荐】</b>\n\n点击下方任意片名，机器人将立即发送专属 4K 海报与转存通道：`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        ...keyboard,
        [{ text: '🎬 打开完整片库 (小程序)', web_app: { url: 'https://xkykmovie.com/explore' } }]
      ]
    }
  });
}

/**
 * 通用 Telegram Bot API 调用封装
 */
async function callTgApi(token, method, payload) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

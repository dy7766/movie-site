/**
 * Telegram 官方频道 / 影迷交流群 每日自动推片机器人服务
 */

const DEFAULT_BOT_TOKEN = '9105332535:AAEyAFqc0TFyWQysqF_TfVQpMMDkPT8tT58';

export function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
}

/**
 * 自动从机器人近期 Updates 中侦测目标群组的 chat_id
 */
export async function detectChatId(botToken = getBotToken()) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
    const data = await res.json();
    if (!data.ok || !data.result || data.result.length === 0) {
      return null;
    }
    // 优先寻找 group 或 supergroup 或 channel 类型的 chat
    for (let i = data.result.length - 1; i >= 0; i--) {
      const update = data.result[i];
      const chat = update.message?.chat || update.channel_post?.chat || update.my_chat_member?.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
        return {
          id: chat.id,
          title: chat.title,
          username: chat.username || null,
          type: chat.type
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('⚠️ 获取 TG ChatId 异常:', err.message);
    return null;
  }
}

/**
 * 向 Telegram 群组发送单条文本消息 (支持 Markdown / HTML)
 */
export async function sendTelegramMessage(text, { chatId = null, parseMode = 'HTML' } = {}) {
  const token = getBotToken();
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) {
    console.warn('⚠️ 未配置 TELEGRAM_CHAT_ID，跳过 TG 发送');
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: text,
        parse_mode: parseMode,
        disable_web_page_preview: false
      })
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.error('❌ 发送 TG 消息失败:', err.message);
    return false;
  }
}

/**
 * 每日新片自动推片图文海报卡片 (带在线播放与专属转存按钮)
 */
export async function sendMovieCardToTelegram(movie, { chatId = null } = {}) {
  const token = getBotToken();
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) return false;

  const title = movie.title || '最新热播佳作';
  const year = movie.year || '2024';
  const score = movie.score ? `★ ${Number(movie.score).toFixed(1)} 分` : '★ 8.5+ 推荐';
  const intro = movie.intro ? movie.intro.slice(0, 120) + '...' : '高清原盘无损转存，免广告在线极速秒播。';
  const siteUrl = `https://movie-site-8r4.pages.dev/movie/${movie.id}`;

  const caption = `🎬 <b>【每日热映·4K高清推荐】</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🍿 <b>片名</b>：<b>${title}</b> (${year})\n` +
    `⭐ <b>评分</b>：${score} | <b>类别</b>：${movie.category || '电影'}\n` +
    `👥 <b>主演</b>：${movie.actors || '精选全明星阵容'}\n\n` +
    `📖 <b>简介</b>：${intro}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `⚡ <b>获取与观看通道</b>：\n` +
    (movie.online_play_url ? `▶️ <a href="${siteUrl}#onlinePlayerSection">在线极速播放</a>\n` : '') +
    (movie.share_link_uc ? `📥 <a href="${movie.share_link_uc}">UC网盘专属转存</a>\n` : '') +
    (movie.share_link ? `💾 <a href="${movie.share_link}">夸克网盘无损秒传</a>\n` : '') +
    `🌐 <a href="${siteUrl}">进入网站详情页完整浏览</a>`;

  // 快捷内联按钮 (Inline Keyboard)
  const inlineButtons = [];
  const row1 = [];
  if (movie.online_play_url) {
    row1.push({ text: '▶️ 立即在线看', url: `${siteUrl}#onlinePlayerSection` });
  }
  if (movie.share_link_uc) {
    row1.push({ text: '⚡ UC秒存', url: movie.share_link_uc });
  } else if (movie.share_link) {
    row1.push({ text: '💾 夸克转存', url: movie.share_link });
  }
  if (row1.length > 0) inlineButtons.push(row1);
  inlineButtons.push([{ text: '🌐 打开星光影库官网', url: 'https://movie-site-8r4.pages.dev/' }]);

  try {
    const posterUrl = movie.poster_url || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=600';
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        photo: posterUrl,
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: inlineButtons
        }
      })
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.warn(`⚠️ 发送电影《${title}》海报至 TG 异常:`, err.message);
    // 降级为纯文本
    return sendTelegramMessage(caption, { chatId: targetChatId });
  }
}

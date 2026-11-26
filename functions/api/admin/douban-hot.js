// Cloudflare Pages Function: /api/admin/douban-hot
// 优先读取定时流水线同步到 Supabase system_settings 的豆瓣（热门 + 最新）四分组 Top 50 快照，无快照时实时兜底

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

const DOUBAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://movie.douban.com/explore',
  'Accept': 'application/json, text/plain, */*',
  'Cookie': 'bid=xkyk9f8a2b1'
};

async function fetchDoubanList(type, tag = '热门', sort = 'recommend', limit = 50) {
  const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=${sort}&page_limit=${limit}&page_start=0`;
  const res = await fetch(url, { headers: DOUBAN_HEADERS });
  if (!res.ok) {
    throw new Error(`Douban ${type}/${tag}/${sort} HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.subjects || []).slice(0, limit).map((item, idx) => ({
    rank: idx + 1,
    id: item.id || '',
    title: item.title || '',
    rate: item.rate || '',
    url: item.url || '',
    cover: item.cover || '',
    is_new: Boolean(item.is_new)
  }));
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;

    // 1. 优先从 Supabase 读取定时更新保存的完整快照（含 hot 与 latest）
    const snapRes = await fetch(`${SUPABASE_URL}/rest/v1/system_settings?key=eq.douban_hot_snapshot&select=value,updated_at`, {
      headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` }
    });
    if (snapRes.ok) {
      const rows = await snapRes.json();
      const snap = rows?.[0]?.value;
      if (snap && snap.hot?.movie?.length && snap.latest?.movie?.length) {
        return new Response(JSON.stringify({
          success: true,
          source: 'scheduled_snapshot',
          fetchedAt: snap.fetchedAt || rows[0].updated_at,
          hot: snap.hot,
          latest: snap.latest
        }), { status: 200, headers: CORS_HEADERS });
      }
    }

    // 2. 冷启动兜底：并发抓取热门 + 最新共 8 组 Top 50
    const [hotMovie, hotTv, hotVariety, hotAnime, latestMovie, latestTv, latestVariety, latestAnime] = await Promise.all([
      fetchDoubanList('movie', '热门', 'recommend', 50),
      fetchDoubanList('tv', '热门', 'recommend', 50),
      fetchDoubanList('tv', '综艺', 'recommend', 50),
      fetchDoubanList('tv', '日本动画', 'recommend', 50),
      fetchDoubanList('movie', '最新', 'recommend', 50),
      fetchDoubanList('tv', '热门', 'time', 50),
      fetchDoubanList('tv', '综艺', 'time', 50),
      fetchDoubanList('tv', '日本动画', 'time', 50)
    ]);

    return new Response(JSON.stringify({
      success: true,
      source: 'live_fallback',
      fetchedAt: new Date().toISOString(),
      hot: { movie: hotMovie, tv: hotTv, variety: hotVariety, anime: hotAnime },
      latest: { movie: latestMovie, tv: latestTv, variety: latestVariety, anime: latestAnime }
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      hot: { movie: [], tv: [], variety: [], anime: [] },
      latest: { movie: [], tv: [], variety: [], anime: [] }
    }), { status: 500, headers: CORS_HEADERS });
  }
}

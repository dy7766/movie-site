// Cloudflare Pages Function: /api/admin/douban-hot
// 优先读取定时流水线同步到 Supabase system_settings 的豆瓣热门 Top 50 四分组快照，无快照时实时兜底抓取

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

async function fetchDoubanList(type, tag = '热门', limit = 50) {
  const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${limit}&page_start=0`;
  const res = await fetch(url, { headers: DOUBAN_HEADERS });
  if (!res.ok) {
    throw new Error(`Douban ${type}/${tag} HTTP ${res.status}`);
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

    // 1. 优先从 Supabase 读取定时更新保存的四分组快照（须包含综艺与动漫数组）
    const snapRes = await fetch(`${SUPABASE_URL}/rest/v1/system_settings?key=eq.douban_hot_snapshot&select=value,updated_at`, {
      headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` }
    });
    if (snapRes.ok) {
      const rows = await snapRes.json();
      const snap = rows?.[0]?.value;
      if (snap && snap.movies?.length && snap.tvs?.length && snap.varieties?.length && snap.animes?.length) {
        return new Response(JSON.stringify({
          success: true,
          source: 'scheduled_snapshot',
          fetchedAt: snap.fetchedAt || rows[0].updated_at,
          movies: snap.movies,
          tvs: snap.tvs,
          varieties: snap.varieties,
          animes: snap.animes
        }), { status: 200, headers: CORS_HEADERS });
      }
    }

    // 2. 冷启动兜底：尚无完整四分组快照时实时并发抓取一次
    const [movies, tvs, varieties, animes] = await Promise.all([
      fetchDoubanList('movie', '热门', 50),
      fetchDoubanList('tv', '热门', 50),
      fetchDoubanList('tv', '综艺', 50),
      fetchDoubanList('tv', '日本动画', 50)
    ]);

    return new Response(JSON.stringify({
      success: true,
      source: 'live_fallback',
      fetchedAt: new Date().toISOString(),
      movies,
      tvs,
      varieties,
      animes
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      movies: [],
      tvs: [],
      varieties: [],
      animes: []
    }), { status: 500, headers: CORS_HEADERS });
  }
}

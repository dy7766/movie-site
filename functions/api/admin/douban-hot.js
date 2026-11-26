// Cloudflare Pages Function: /api/admin/douban-hot
// 代理抓取豆瓣实时热门电影 Top 50 与热门电视剧 Top 50，供 hub-8f92 大盘做库内资源覆盖率对照

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=300'
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
    throw new Error(`Douban ${type} HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.subjects || []).slice(0, limit).map((item, idx) => ({
    rank: idx + 1,
    id: item.id,
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

export async function onRequestGet() {
  try {
    const [movies, tvs] = await Promise.all([
      fetchDoubanList('movie', '热门', 50),
      fetchDoubanList('tv', '热门', 50)
    ]);

    return new Response(JSON.stringify({
      success: true,
      fetchedAt: new Date().toISOString(),
      movies,
      tvs
    }), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      movies: [],
      tvs: []
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

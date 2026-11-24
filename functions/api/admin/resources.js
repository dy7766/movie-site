// Cloudflare Pages Function: /api/admin/resources
// 星光影库 · 实时全量影视资产与检索接口
// 运行在 Cloudflare 全球边缘网络，毫秒级直连 Supabase REST API，提供 100% 实时无缓存数据

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const url = new URL(context.request.url);
    const limit = url.searchParams.get('limit') || '3000';

    // 字段投影：获取大盘与全属性检索所需的全部字段
    const selectFields = [
      'id', 'title', 'original_title', 'poster_url', 'category', 'tags',
      'year', 'score', 'actors', 'intro', 'drive_type', 'share_link',
      'views', 'saves', 'created_at', 'country', 'stills',
      'online_play_url', 'play_sources', 'share_link_uc', 'is_finished',
      'current_episode', 'total_episodes', 'has_metadata', 'status',
      'is_released', 'release_date', 'clicks_quark', 'clicks_uc', 'clicks_play',
      'source_pwd_id', 'uc_fid', 'last_episode_updated_at'
    ].join(',');

    const apiUrl = `${SUPABASE_URL}/rest/v1/resources?select=${selectFields}&order=is_released.asc.nullslast,year.desc.nullslast,score.desc.nullslast,created_at.desc&limit=${limit}`;

    const res = await fetch(apiUrl, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Range-Unit': 'items'
      }
    });

    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return new Response(JSON.stringify({
      success: true,
      total: data.length,
      timestamp: new Date().toISOString(),
      resources: data
    }), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      resources: []
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

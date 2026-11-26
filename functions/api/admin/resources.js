// Cloudflare Pages Function: /api/admin/resources
// 星光影库 · 实时影视资产服务端检索、分页与轻量 KPI 聚合接口
// 按需查询 Supabase REST API，不再全量返回大字段

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

const FULL_SELECT_FIELDS = [
  'id', 'title', 'original_title', 'poster_url', 'category', 'tags',
  'year', 'score', 'actors', 'intro', 'drive_type', 'share_link',
  'views', 'saves', 'created_at', 'country', 'stills',
  'online_play_url', 'play_sources', 'share_link_uc', 'is_finished',
  'current_episode', 'total_episodes', 'has_metadata', 'status',
  'is_released', 'release_date', 'clicks_quark', 'clicks_uc', 'clicks_play',
  'source_pwd_id', 'uc_fid', 'last_episode_updated_at'
].join(',');

// 仅用于顶部 KPI 计数和豆瓣对照的轻量字段（不包含 intro/stills/play_sources/actors 等大字段）
const KPI_SELECT_FIELDS = [
  'id', 'title', 'category', 'has_metadata', 'is_finished',
  'share_link', 'share_link_uc', 'online_play_url'
].join(',');

const SORT_MAP = {
  saves_desc: 'clicks_quark.desc.nullslast,clicks_uc.desc.nullslast,year.desc.nullslast',
  views_desc: 'views.desc.nullslast,year.desc.nullslast',
  created_desc: 'created_at.desc.nullslast',
  created_asc: 'created_at.asc.nullslast',
  updated_desc: 'last_episode_updated_at.desc.nullslast,created_at.desc',
  score_desc: 'score.desc.nullslast,year.desc.nullslast',
  year_desc: 'year.desc.nullslast,score.desc.nullslast',
  episodes_desc: 'current_episode.desc.nullslast,year.desc.nullslast',
  year_score_created: 'is_released.asc.nullslast,year.desc.nullslast,score.desc.nullslast,created_at.desc'
};

async function fetchAllLightRows(apiKey) {
  const pageSize = 1000;
  const allRows = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=${KPI_SELECT_FIELDS}&order=created_at.desc`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Range-Unit': 'items',
        'Range': `${offset}-${offset + pageSize - 1}`
      }
    });
    if (!res.ok) throw new Error(`Supabase KPI query failed: ${res.status}`);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    allRows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += chunk.length;
  }
  return allRows;
}

function buildPostgrestQuery(params) {
  const filters = [];

  const category = params.get('category');
  if (category && category !== '全部') {
    filters.push(`category=eq.${encodeURIComponent(category)}`);
  }

  const quickStatus = params.get('quickStatus');
  if (quickStatus === 'ready') filters.push('has_metadata=eq.true');
  else if (quickStatus === 'pending') filters.push('has_metadata=is.false');
  else if (quickStatus === 'has_play') filters.push('online_play_url=not.is.null');
  else if (quickStatus === 'has_uc') filters.push('share_link_uc=not.is.null');
  else if (quickStatus === 'has_quark') filters.push('share_link=not.is.null');
  else if (quickStatus === 'ongoing') {
    filters.push(`category=in.(${encodeURIComponent('电视剧')},${encodeURIComponent('综艺')},${encodeURIComponent('动漫')})`);
    filters.push('is_finished=eq.false');
  } else if (quickStatus === 'finished') {
    filters.push('is_finished=eq.true');
  } else if (quickStatus === 'missing_res') {
    filters.push('share_link_uc=is.null');
    filters.push('share_link=is.null');
    filters.push('online_play_url=is.null');
  }

  const meta = params.get('meta');
  if (meta === 'ready') filters.push('has_metadata=eq.true');
  else if (meta === 'pending') filters.push('has_metadata=is.false');

  const released = params.get('released');
  if (released === 'released') filters.push('is_released=neq.false');
  else if (released === 'unreleased') filters.push('is_released=eq.false');

  const finished = params.get('finished');
  if (finished === 'ongoing') filters.push('is_finished=eq.false');
  else if (finished === 'finished') filters.push('is_finished=eq.true');

  const quark = params.get('quark');
  if (quark === 'has') filters.push('share_link=not.is.null');
  else if (quark === 'none') filters.push('share_link=is.null');

  const uc = params.get('uc');
  if (uc === 'has') filters.push('share_link_uc=not.is.null');
  else if (uc === 'none') filters.push('share_link_uc=is.null');

  const play = params.get('play');
  if (play === 'has') filters.push('online_play_url=not.is.null');
  else if (play === 'none') filters.push('online_play_url=is.null');

  const source = params.get('source');
  if (source === 'has') filters.push('source_pwd_id=not.is.null');
  else if (source === 'none') filters.push('source_pwd_id=is.null');

  const score = params.get('score');
  if (score === '9') filters.push('score=gte.9');
  else if (score === '8') { filters.push('score=gte.8'); filters.push('score=lt.9'); }
  else if (score === '7') { filters.push('score=gte.7'); filters.push('score=lt.8'); }
  else if (score === '6') { filters.push('score=gte.6'); filters.push('score=lt.7'); }
  else if (score === 'under6') { filters.push('score=gt.0'); filters.push('score=lt.6'); }
  else if (score === 'none') filters.push('or=(score.is.null,score.eq.0)');

  const qRaw = (params.get('q') || '').trim();
  if (qRaw) {
    // 兼容驼峰无空格搜索 (如 RunningMan -> *Running*Man*)
    const fuzzyCamel = qRaw.replace(/([a-z])([A-Z])/g, '$1*$2').replace(/\s+/g, '*');
    const pattern = `*${fuzzyCamel}*`;
    const orParts = [
      `title.ilike.${pattern}`,
      `original_title.ilike.${pattern}`,
      `actors.ilike.${pattern}`,
      `intro.ilike.${pattern}`,
      `country.ilike.${pattern}`,
      `share_link.ilike.${pattern}`,
      `share_link_uc.ilike.${pattern}`,
      `source_pwd_id.ilike.${pattern}`,
      `uc_fid.ilike.${pattern}`,
      `online_play_url.ilike.${pattern}`
    ];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qRaw)) {
      orParts.push(`id.eq.${qRaw}`);
    }
    if (/^\d{4}$/.test(qRaw)) {
      orParts.push(`year.eq.${qRaw}`);
    }
    filters.push(`or=(${orParts.map(p => encodeURIComponent(p)).join(',')})`);
  }

  const sortBy = params.get('sortBy') || 'year_score_created';
  const order = SORT_MAP[sortBy] || SORT_MAP.year_score_created;
  filters.push(`order=${order}`);

  return filters.join('&');
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const url = new URL(context.request.url);
    const mode = url.searchParams.get('mode') || 'page';

    // 模式 B: 轻量 KPI 聚合 + 豆瓣对照索引
    if (mode === 'kpi') {
      const rows = await fetchAllLightRows(apiKey);
      const cats = ['电影', '电视剧', '综艺', '动漫', '纪录片'];
      const categories = { '全部': rows.length };
      for (const c of cats) {
        categories[c] = rows.filter(m => m.category === c).length;
      }
      const kpi = {
        total: rows.length,
        ready: rows.filter(m => m.has_metadata === true).length,
        pending: rows.filter(m => !m.has_metadata).length,
        uc: rows.filter(m => !!m.share_link_uc).length,
        quark: rows.filter(m => !!m.share_link).length,
        play: rows.filter(m => !!m.online_play_url).length,
        ongoing: rows.filter(m => (m.category === '电视剧' || m.category === '综艺' || m.category === '动漫') && m.is_finished === false).length,
        categories
      };
      return new Response(JSON.stringify({
        success: true,
        kpi,
        indexRows: rows,
        timestamp: new Date().toISOString()
      }), { status: 200, headers: CORS_HEADERS });
    }

    // 模式 A: 服务端按条件实时查询并分页返回
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const offset = (page - 1) * pageSize;

    const queryStr = buildPostgrestQuery(url.searchParams);
    const apiUrl = `${SUPABASE_URL}/rest/v1/resources?select=${FULL_SELECT_FIELDS}&${queryStr}`;

    const res = await fetch(apiUrl, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': `${offset}-${offset + pageSize - 1}`
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase query failed: ${res.status} ${errText}`);
    }

    const contentRange = res.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const data = await res.json();
    const total = totalMatch ? parseInt(totalMatch[1], 10) : data.length;

    return new Response(JSON.stringify({
      success: true,
      page,
      pageSize,
      total,
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
      total: 0,
      resources: []
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

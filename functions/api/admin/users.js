// Cloudflare Pages Function: /api/admin/users
// 星光影库 · 访客用户列表聚合与单用户埋点流水查询接口

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

async function fetchEventsRange(apiKey, queryPath, maxRows = 10000) {
  const pageSize = 1000;
  const rows = [];
  let offset = 0;

  while (rows.length < maxRows) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${queryPath}`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Range-Unit': 'items',
        'Range': `${offset}-${offset + pageSize - 1}`
      }
    });
    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status}`);
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += chunk.length;
  }
  return rows;
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const url = new URL(context.request.url);
    const uid = (url.searchParams.get('uid') || '').trim();

    // 1. 查询指定用户的埋点流水
    if (uid) {
      const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
      let filterExpr = '';
      if (uid === 'anonymous') {
        filterExpr = 'visitor_id=is.null&ip=is.null';
      } else if (uid.startsWith('ip_')) {
        const ipVal = uid.slice(3);
        filterExpr = `or=(visitor_id.eq.${encodeURIComponent(uid)},ip.eq.${encodeURIComponent(ipVal)})`;
      } else {
        filterExpr = `visitor_id=eq.${encodeURIComponent(uid)}`;
      }

      const selectCols = 'id,event_type,resource_id,resource_title,device,page_url,referrer,ip,location,created_at,visitor_id';
      const res = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=${selectCols}&${filterExpr}&order=created_at.desc`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Prefer': 'count=exact',
          'Range-Unit': 'items',
          'Range': `0-${limit - 1}`
        }
      });

      if (!res.ok) {
        throw new Error(`Supabase user events query failed: ${res.status}`);
      }

      const contentRange = res.headers.get('content-range') || '';
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const events = await res.json();
      const totalEvents = totalMatch ? parseInt(totalMatch[1], 10) : events.length;

      return new Response(JSON.stringify({
        success: true,
        uid,
        totalEvents,
        events
      }), { status: 200, headers: CORS_HEADERS });
    }

    // 2. 聚合用户列表
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));

    let timeFilter = '';
    if (!Number.isNaN(days) && days > 0) {
      const sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString();
      timeFilter = `&created_at=gte.${encodeURIComponent(sinceIso)}`;
    }

    const rawEvents = await fetchEventsRange(
      apiKey,
      `analytics_events?select=visitor_id,ip,location,device,event_type,created_at&order=created_at.desc${timeFilter}`,
      15000
    );

    const userMap = new Map();
    for (const row of rawEvents) {
      const key = row.visitor_id || (row.ip ? `ip_${row.ip}` : 'anonymous');
      let u = userMap.get(key);
      if (!u) {
        u = {
          uid: key,
          visitorId: row.visitor_id || '',
          ip: row.ip || '',
          location: row.location || '',
          device: row.device || 'mobile',
          totalEvents: 0,
          pvCount: 0,
          quarkCount: 0,
          ucCount: 0,
          playCount: 0,
          lastSeen: row.created_at,
          firstSeen: row.created_at
        };
        userMap.set(key, u);
      }

      u.totalEvents++;
      if (row.event_type === 'page_view') u.pvCount++;
      else if (row.event_type === 'click_quark') u.quarkCount++;
      else if (row.event_type === 'click_uc') u.ucCount++;
      else if (row.event_type === 'click_play') u.playCount++;

      if (!u.ip && row.ip) u.ip = row.ip;
      if (!u.location && row.location) u.location = row.location;
      if (row.created_at > u.lastSeen) u.lastSeen = row.created_at;
      if (row.created_at < u.firstSeen) u.firstSeen = row.created_at;
    }

    let users = Array.from(userMap.values());
    if (q) {
      users = users.filter(u =>
        u.uid.toLowerCase().includes(q) ||
        u.ip.toLowerCase().includes(q) ||
        u.location.toLowerCase().includes(q)
      );
    }

    users.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    const totalUsers = users.length;
    const start = (page - 1) * pageSize;
    const pagedUsers = users.slice(start, start + pageSize);

    return new Response(JSON.stringify({
      success: true,
      totalUsers,
      page,
      pageSize,
      users: pagedUsers
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      users: [],
      events: []
    }), { status: 500, headers: CORS_HEADERS });
  }
}

// Cloudflare Pages Function: /api/track
// 纯标准 Web Fetch 实现，零 Node 依赖，毫秒级边缘入库至 Supabase

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      const text = await context.request.text();
      body = JSON.parse(text || '{}');
    } catch (_) {
      body = {};
    }

    const {
      event_type = 'click_unknown',
      resource_id = null,
      resource_title = '',
      device = 'mobile',
      page_url = '',
      referrer = ''
    } = body;

    // 从 Cloudflare 请求头和 CF 上下文中毫秒级提取访问者真实 IP 与城市地区
    const clientIp = context.request.headers.get('cf-connecting-ip') || 
                     context.request.headers.get('x-real-ip') || 
                     (context.request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 
                     '';
    
    const cf = context.request.cf || {};
    const city = cf.city || '';
    const region = cf.region || '';
    const country = cf.country || '';
    const location = [city, region, country].filter(Boolean).join(', ') || '';

    // 写入 Supabase 实时埋点事件流水表
    const res = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        'apikey': context.env.SUPABASE_ANON_KEY || SUPABASE_KEY,
        'Authorization': `Bearer ${context.env.SUPABASE_ANON_KEY || SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type,
        resource_id: resource_id ? String(resource_id).trim() : null,
        resource_title: resource_title || '',
        device,
        page_url,
        referrer,
        ip: clientIp,
        location: location
      })
    });

    return new Response(JSON.stringify({ success: res.ok }), {
      status: res.ok ? 200 : 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

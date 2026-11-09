// Cloudflare Pages Function: /api/track
// 负责接收客户端无感埋点上报，并将访问与转存事件实时写入 Supabase

import pg from 'pg';
const { Client } = pg;

const CONNECTION_STRING = 'postgres://postgres.oncktqesgpjsilngtcok:1314521qaz+1s+supabase@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=no-verify';

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch (e) {
      const text = await context.request.text();
      body = JSON.parse(text || '{}');
    }

    const {
      event_type = 'click_unknown',
      resource_id = null,
      resource_title = '',
      device = 'mobile',
      page_url = '',
      referrer = ''
    } = body;

    const client = new Client({
      connectionString: context.env.DATABASE_URL || CONNECTION_STRING,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();

    try {
      // 1. 记录明细事件流水
      await client.query(`
        INSERT INTO analytics_events (event_type, resource_id, resource_title, device, page_url, referrer)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [event_type, resource_id, resource_title, device, page_url, referrer]);

      // 2. 统计到特定电影条目计数器（仅当为合法 UUID 时更新主表）
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(resource_id || ''));
      if (resource_id && isUuid) {
        if (event_type === 'click_quark') {
          await client.query('UPDATE resources SET clicks_quark = COALESCE(clicks_quark, 0) + 1 WHERE id = $1', [resource_id]);
        } else if (event_type === 'click_uc') {
          await client.query('UPDATE resources SET clicks_uc = COALESCE(clicks_uc, 0) + 1 WHERE id = $1', [resource_id]);
        } else if (event_type === 'click_play') {
          await client.query('UPDATE resources SET clicks_play = COALESCE(clicks_play, 0) + 1 WHERE id = $1', [resource_id]);
        } else if (event_type === 'page_view') {
          await client.query('UPDATE resources SET views = COALESCE(views, 0) + 1 WHERE id = $1', [resource_id]);
        }
      }
    } finally {
      await client.end();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    console.error('Tracking error:', err);
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

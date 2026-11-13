// Cloudflare Pages Function: /api/transfer-settings
// 星光影库 · 自动化网盘转存控制中枢 API (UC 与 夸克 独立控制)
// 运行在 Cloudflare 全球边缘网络，秒级读取与持久化至 Supabase

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

// GET: 获取当前网盘转存开关状态
export async function onRequestGet(context) {
  try {
    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/system_settings?key=eq.transfer_settings&select=value,updated_at`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].value) {
        const val = data[0].value;
        return new Response(JSON.stringify({
          success: true,
          settings: {
            uc: val.uc !== false,
            quark: val.quark !== false,
            updated_at: data[0].updated_at || val.updated_at || null
          }
        }), { status: 200, headers: CORS_HEADERS });
      }
    }

    // 默认开启保底
    return new Response(JSON.stringify({
      success: true,
      settings: { uc: true, quark: true, updated_at: null }
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      settings: { uc: true, quark: true }
    }), { status: 200, headers: CORS_HEADERS });
  }
}

// POST: 修改网盘转存开关状态
export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      const text = await context.request.text();
      body = JSON.parse(text || '{}');
    } catch (_) {
      body = {};
    }

    const { uc, quark } = body;

    // 参数严格校验：必须至少传入一个布尔控制项
    if (typeof uc === 'undefined' && typeof quark === 'undefined') {
      return new Response(JSON.stringify({ success: false, error: '缺少有效的转存控制参数 (uc / quark)' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;

    // 先查询当前已存的设置，以便局部更新
    let current = { uc: true, quark: true };
    try {
      const curRes = await fetch(`${SUPABASE_URL}/rest/v1/system_settings?key=eq.transfer_settings&select=value`, {
        headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` }
      });
      if (curRes.ok) {
        const curData = await curRes.json();
        if (curData?.[0]?.value) {
          current = {
            uc: curData[0].value.uc !== false,
            quark: curData[0].value.quark !== false
          };
        }
      }
    } catch (_) {}

    const newUc = typeof uc === 'boolean' ? uc : current.uc;
    const newQuark = typeof quark === 'boolean' ? quark : current.quark;
    const updatedAt = new Date().toISOString();

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/system_settings?key=eq.transfer_settings`, {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        value: {
          uc: newUc,
          quark: newQuark,
          updated_at: updatedAt,
          updated_by: 'admin_dashboard'
        },
        updated_at: updatedAt
      })
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return new Response(JSON.stringify({ success: false, error: '持久化至数据库失败: ' + errText }), {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    return new Response(JSON.stringify({
      success: true,
      settings: {
        uc: newUc,
        quark: newQuark,
        updated_at: updatedAt
      }
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

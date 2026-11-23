// Cloudflare Pages Function: /api/maccms
// 兼容标准 MacCMS (苹果CMS) v10 XML/JSON 接口与 TVBox 原生 T1 站点规范
// 毫秒级全球边缘直连 Supabase，无缝兼容各类全网第三方大源（饭太硬、摸鱼、肥猫等）聚合抓取

const SUPABASE_URL = 'https://oncktqesgpjsilngtcok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Cache-Control': 'public, max-age=180, s-maxage=300'
};

const CATEGORIES = [
  { type_id: 1, type_name: '电影' },
  { type_id: 2, type_name: '电视剧' },
  { type_id: 3, type_name: '动漫' },
  { type_id: 4, type_name: '综艺' },
  { type_id: 5, type_name: '纪录片' }
];

const CATEGORY_MAP = {
  1: '电影',
  2: '电视剧',
  3: '动漫',
  4: '综艺',
  5: '纪录片'
};

const CATEGORY_REVERSE_MAP = {
  '电影': 1,
  '电视剧': 2,
  '动漫': 3,
  '综艺': 4,
  '纪录片': 5
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(context.request.url);
    const searchParams = url.searchParams;

    const ac = searchParams.get('ac') || '';
    const t = searchParams.get('t') || '';
    const pg = Math.max(1, parseInt(searchParams.get('pg') || '1') || 1);
    const wd = (searchParams.get('wd') || '').trim();
    const ids = (searchParams.get('ids') || '').trim();
    const h = parseInt(searchParams.get('h') || '0') || 0;

    // 当有具体搜索词或详情 ID 时，强制走 detail 模式
    const isDetail = ac === 'detail' || !!wd || !!ids;
    const limit = 20;
    const offset = (pg - 1) * limit;

    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;

    // 基础查询字段
    let queryUrl = `${SUPABASE_URL}/rest/v1/resources?select=id,title,category,poster_url,year,score,actors,intro,country,is_finished,current_episode,total_episodes,share_link,share_link_uc,online_play_url,play_sources,created_at&has_metadata=eq.true`;

    if (ids) {
      const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
      if (idList.length === 1) {
        queryUrl += `&id=eq.${idList[0]}`;
      } else if (idList.length > 1) {
        queryUrl += `&id=in.(${idList.join(',')})`;
      }
    } else if (wd) {
      queryUrl += `&or=(title.ilike.*${encodeURIComponent(wd)}*,actors.ilike.*${encodeURIComponent(wd)}*)`;
    } else if (t && CATEGORY_MAP[t]) {
      queryUrl += `&category=eq.${encodeURIComponent(CATEGORY_MAP[t])}`;
    }

    // 过滤有可用播放/转存链接的资源
    if (!ids && !wd) {
      queryUrl += `&or=(share_link.not.is.null,share_link_uc.not.is.null,online_play_url.not.is.null)`;
    }

    // 小时筛选（增量采集）
    if (h > 0) {
      const pastTime = new Date(Date.now() - h * 3600 * 1000).toISOString();
      queryUrl += `&created_at=gte.${pastTime}`;
    }

    queryUrl += `&order=year.desc,score.desc,created_at.desc&limit=${limit}&offset=${offset}`;

    const resp = await fetch(queryUrl, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'count=exact'
      }
    });

    if (!resp.ok) {
      throw new Error(`Supabase error: ${resp.status} ${resp.statusText}`);
    }

    const range = resp.headers.get('content-range') || '';
    let total = 0;
    if (range) {
      const parts = range.split('/');
      if (parts[1]) total = parseInt(parts[1]) || 0;
    }

    const rows = await resp.json();
    const pagecount = Math.ceil(total / limit) || 1;

    // 转换为 MacCMS v10 规范数据结构
    const list = rows.map(item => {
      const typeId = CATEGORY_REVERSE_MAP[item.category] || 1;
      const typeName = item.category || '电影';

      // 组装连载与画质说明
      let remarks = '4K超清原画';
      if (item.category === '电视剧' || item.category === '动漫') {
        if (item.is_finished) {
          remarks = item.total_episodes ? `全${item.total_episodes}集` : '已完结';
        } else {
          remarks = item.current_episode ? `更新至${item.current_episode}集` : '热播中';
        }
      } else if (item.year) {
        remarks = `${item.year} / 4K超清`;
      }

      const formattedTime = item.created_at
        ? new Date(item.created_at).toISOString().replace('T', ' ').slice(0, 19)
        : '';

      // 核心播放源与多线路构造
      const fromList = [];
      const urlList = [];

      // 1. 夸克网盘转存专线（TVBox 原生唤醒 push_agent 扫码弹窗与自动转存）
      if (item.share_link) {
        fromList.push('夸克网盘');
        urlList.push(`4K原画·点击扫码转存$push://${item.share_link}`);
      }

      // 2. UC网盘转存专线（TVBox 原生唤醒 push_agent 扫码弹窗与自动转存）
      if (item.share_link_uc) {
        fromList.push('UC网盘');
        urlList.push(`4K极速·点击扫码转存$push://${item.share_link_uc}`);
      }

      // 3. 直链秒播专线 (M3U8) - 兜底普通播放器无网盘账号用户
      let sources = item.play_sources;
      if (typeof sources === 'string') {
        try { sources = JSON.parse(sources); } catch (_) { sources = []; }
      }

      if (Array.isArray(sources) && sources.length > 0) {
        for (const s of sources) {
          if (s.episodes && s.episodes.length > 0) {
            const sName = s.source || (s.type === 'm3u8' ? '极速秒播' : '备用播放');
            const epStr = s.episodes.map(e => `${e.name || '正片'}$${e.url}`).join('#');
            fromList.push(sName);
            urlList.push(epStr);
          }
        }
      } else if (item.online_play_url) {
        fromList.push('极速秒播');
        urlList.push(`正片$${item.online_play_url}`);
      }

      const vodItem = {
        vod_id: item.id,
        vod_name: item.title,
        type_id: typeId,
        type_name: typeName,
        vod_en: '',
        vod_time: formattedTime,
        vod_remarks: remarks,
        vod_play_from: fromList.join('$$$')
      };

      // 详情模式补充全量属性
      if (isDetail) {
        vodItem.vod_pic = item.poster_url || '';
        vodItem.vod_actor = item.actors || '';
        vodItem.vod_director = '';
        vodItem.vod_content = item.intro || '';
        vodItem.vod_play_url = urlList.join('$$$');
        vodItem.vod_year = item.year ? String(item.year) : '';
        vodItem.vod_area = item.country || '华语';
        vodItem.vod_lang = '国语/原声';
        vodItem.vod_score = item.score ? String(item.score) : '0.0';
      }

      return vodItem;
    });

    const result = {
      code: 1,
      msg: '数据列表',
      page: pg,
      pagecount: pagecount,
      limit: String(limit),
      total: total,
      list: list,
      class: CATEGORIES
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: CORS_HEADERS
    });

  } catch (err) {
    return new Response(JSON.stringify({
      code: 0,
      msg: `接口请求异常: ${err.message}`,
      list: [],
      class: CATEGORIES
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

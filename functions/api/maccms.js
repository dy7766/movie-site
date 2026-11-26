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
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

const CATEGORIES = [
  { type_id: 1, type_pid: 0, type_name: '电影' },
  { type_id: 2, type_pid: 0, type_name: '电视剧' },
  { type_id: 3, type_pid: 0, type_name: '动漫' },
  { type_id: 4, type_pid: 0, type_name: '综艺' },
  { type_id: 5, type_pid: 0, type_name: '纪录片' }
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

let CACHED_ID_MAP = null;
let CACHED_UUID_MAP = null;
let LAST_MAP_FETCH = 0;

async function getOrInitIdMaps(apiKey) {
  const now = Date.now();
  if (CACHED_ID_MAP && CACHED_UUID_MAP && (now - LAST_MAP_FETCH < 3600000)) {
    return { idToUuid: CACHED_ID_MAP, uuidToId: CACHED_UUID_MAP };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resources?select=id&has_metadata=eq.true&or=(share_link.not.is.null,share_link_uc.not.is.null,online_play_url.not.is.null)&order=created_at.asc&limit=2000`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (res.ok) {
      const rows = await res.json();
      const idToUuid = {};
      const uuidToId = {};
      rows.forEach((r, idx) => {
        const numId = idx + 1;
        idToUuid[numId] = r.id;
        uuidToId[r.id] = numId;
      });
      CACHED_ID_MAP = idToUuid;
      CACHED_UUID_MAP = uuidToId;
      LAST_MAP_FETCH = now;
      return { idToUuid, uuidToId };
    }
  } catch (_) {}

  return { idToUuid: CACHED_ID_MAP || {}, uuidToId: CACHED_UUID_MAP || {} };
}

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

    // 当有具体搜索词或详情 ID 时，强制走 detail 模式
    const isDetail = ac === 'detail' || !!wd || !!ids;
    const limit = 20;
    const offset = (pg - 1) * limit;

    const apiKey = context.env?.SUPABASE_ANON_KEY || SUPABASE_KEY;
    const { idToUuid, uuidToId } = await getOrInitIdMaps(apiKey);

    // 基础查询字段
    let queryUrl = `${SUPABASE_URL}/rest/v1/resources?select=id,title,category,poster_url,year,score,actors,intro,country,is_finished,current_episode,total_episodes,share_link,share_link_uc,online_play_url,play_sources,created_at&has_metadata=eq.true`;

    if (ids) {
      const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
      const uuidList = idList.map(item => {
        if (/^\d+$/.test(item)) {
          return idToUuid[parseInt(item, 10)] || null;
        }
        return item;
      }).filter(Boolean);

      if (uuidList.length === 1) {
        queryUrl += `&id=eq.${uuidList[0]}`;
      } else if (uuidList.length > 1) {
        queryUrl += `&id=in.(${uuidList.join(',')})`;
      }
    } else if (wd) {
      queryUrl += `&or=(title.ilike.*${encodeURIComponent(wd)}*,actors.ilike.*${encodeURIComponent(wd)}*)`;
    } else if (t) {
      const catName = CATEGORY_MAP[t] || (CATEGORY_REVERSE_MAP[t] ? t : null);
      if (catName) {
        queryUrl += `&category=eq.${encodeURIComponent(catName)}`;
      }
    }

    // 严格门禁：既无网盘（夸克/UC）也无 M3U8 在线流的空壳资源，绝不查出暴露给 TVBox
    if (!ids) {
      queryUrl += `&or=(share_link.not.is.null,share_link_uc.not.is.null,online_play_url.not.is.null)`;
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

      // 核心网盘专线构造：只要存在任意网盘资源，只输出夸克/UC专线（绝不混入M3U8破坏转存）
      const fromList = [];
      const urlList = [];

      // 1. 夸克网盘专线
      if (item.share_link) {
        fromList.push('夸克');
        urlList.push(`正片$push://${item.share_link}`);
      }

      // 2. UC网盘专线
      if (item.share_link_uc) {
        fromList.push('UC');
        urlList.push(`正片$push://${item.share_link_uc}`);
      }

      // 3. 兜底在线播放：仅当无任何网盘资源时，才挂载 M3U8 在线流
      if (fromList.length === 0) {
        let m3u8Episodes = [];
        if (Array.isArray(item.play_sources)) {
          const m3u8Source = item.play_sources.find(s => s && s.type === 'm3u8' && Array.isArray(s.episodes) && s.episodes.length > 0);
          if (m3u8Source) {
            m3u8Episodes = m3u8Source.episodes.filter(ep => ep && ep.url && /\.m3u8/i.test(ep.url));
          }
        }
        if (m3u8Episodes.length === 0 && item.online_play_url && /\.m3u8/i.test(item.online_play_url)) {
          m3u8Episodes = [{ name: '正片', url: item.online_play_url }];
        }
        if (m3u8Episodes.length > 0) {
          fromList.push('极速秒播');
          urlList.push(m3u8Episodes.map(ep => `${(ep.name || '正片').replace(/[#\$]/g, '')}$${ep.url}`).join('#'));
        }
      }

      // 若最终没有任何可播/可转存线路，剔除此记录
      if (fromList.length === 0) return null;

      // 封面地址加速与白名单处理（解决大陆电视/手机直连TMDB图片被墙或加载极慢导致空白）
      let poster = item.poster_url || '';
      if (poster && poster.includes('image.tmdb.org')) {
        poster = `https://wsrv.nl/?url=${encodeURIComponent(poster)}`;
      }

      return {
        vod_id: uuidToId[item.id] || 1,
        vod_name: item.title,
        type_id: typeId,
        type_name: typeName,
        vod_en: '',
        vod_time: formattedTime,
        vod_remarks: remarks,
        vod_play_from: fromList.join('$$$'),
        vod_play_url: urlList.join('$$$'),
        vod_pic: poster,
        vod_actor: item.actors || '',
        vod_director: '',
        vod_content: item.intro || '',
        vod_year: item.year ? String(item.year) : '',
        vod_area: item.country || '华语',
        vod_lang: '国语/原声',
        vod_score: item.score ? String(item.score) : '0.0'
      };
    }).filter(Boolean);

    const result = {
      code: 1,
      msg: '数据列表',
      page: pg,
      pagecount: pagecount,
      limit: String(limit),
      total: total,
      list: list,
      class: CATEGORIES,
      filters: {}
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
      class: CATEGORIES,
      filters: {}
    }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

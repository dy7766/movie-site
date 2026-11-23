// Cloudflare Pages Function: /api/pan/resolve
// 夸克/UC 网盘智能递归解析与直链分发中枢
// 毫秒级提取分享文件夹内的真实 4K/蓝光视频分集与文件 fid

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=300, s-maxage=600'
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
    const shareUrl = url.searchParams.get('url') || '';
    const cookie = context.request.headers.get('x-pan-cookie') || url.searchParams.get('cookie') || '';

    if (!shareUrl) {
      return new Response(JSON.stringify({ code: -1, msg: '缺少 url 参数' }), { status: 400, headers: CORS_HEADERS });
    }

    // 匹配夸克 pwd_id
    const quarkMatch = shareUrl.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/);
    if (quarkMatch) {
      const pwdId = quarkMatch[1];
      const episodes = await resolveQuarkEpisodes(pwdId, cookie);
      return new Response(JSON.stringify({
        code: 1,
        type: 'quark',
        pwd_id: pwdId,
        count: episodes.length,
        list: episodes
      }), { status: 200, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ code: -1, msg: '暂不支持的网盘类型' }), { status: 400, headers: CORS_HEADERS });

  } catch (err) {
    return new Response(JSON.stringify({ code: 0, msg: `解析异常: ${err.message}` }), { status: 500, headers: CORS_HEADERS });
  }
}

// 递归解析夸克网盘所有分集
async function resolveQuarkEpisodes(pwdId, cookie = '') {
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Referer': `https://pan.quark.cn/s/${pwdId}`
  };
  if (cookie) {
    commonHeaders['Cookie'] = cookie;
  }

  // 1. 获取分享页游客 stoken
  const tokenRes = await fetch('https://pan.quark.cn/1/clouddrive/share/sharepage/token', {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ pwd_id: pwdId, pass_code: '' })
  });
  const tokenData = await tokenRes.json();
  if (tokenData.code !== 0 || !tokenData.data?.stoken) {
    throw new Error(tokenData.message || '获取夸克分享令牌失败');
  }

  const stoken = tokenData.data.stoken;
  const videoResults = [];

  // 2. 递归拉取目录与视频文件
  async function crawlFolder(pdirFid = '0', depth = 1) {
    if (depth > 3) return; // 最多下钻 3 层，避免死循环

    let fetchUrl = `https://pan.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}`;
    if (pdirFid && pdirFid !== '0') {
      fetchUrl += `&pdir_fid=${pdirFid}`;
    }

    const res = await fetch(fetchUrl, { headers: commonHeaders });
    const json = await res.json();
    const items = json.data?.list || [];

    for (const item of items) {
      const isVideo = item.format_type === 'video' || /\.(mp4|mkv|ts|mov|flv|webm|m4v)$/i.test(item.file_name);
      const isDir = item.format_type === 'dir' || item.size === 0;

      if (isVideo && item.size > 20 * 1024 * 1024) { // 过滤小于 20MB 的广告短片
        videoResults.push({
          fid: item.fid,
          name: cleanEpisodeName(item.file_name),
          raw_name: item.file_name,
          size_bytes: item.size,
          size_text: (item.size / 1024 / 1024 / 1024).toFixed(2) + 'GB',
          share_fid_token: item.share_fid_token || ''
        });
      } else if (isDir) {
        await crawlFolder(item.fid, depth + 1);
      }
    }
  }

  await crawlFolder('0', 1);

  // 按照集数名称自然升序排序
  videoResults.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return videoResults;
}

// 智能清洗分集名称（例如将 "Nocturne S01E01 - 第 1 集 - 2160p..." 清洗为 "第01集 (10.87GB)"）
function cleanEpisodeName(fileName) {
  let name = fileName.replace(/\.(mp4|mkv|ts|mov|flv)$/i, '').trim();

  // 提取 "第 X 集"
  const cnMatch = name.match(/第\s*(\d+)\s*集/);
  if (cnMatch) {
    return `第${cnMatch[1].padStart(2, '0')}集`;
  }

  // 提取 "S01EXX" 或 "EXX"
  const enMatch = name.match(/(?:S\d+)?E(\d+)/i);
  if (enMatch) {
    return `第${enMatch[1].padStart(2, '0')}集`;
  }

  // 提取裸数字 "01" / "02"
  const numMatch = name.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/);
  if (numMatch && parseInt(numMatch[1]) > 0 && parseInt(numMatch[1]) < 200) {
    return `第${numMatch[1].padStart(2, '0')}集`;
  }

  return name.slice(0, 30);
}

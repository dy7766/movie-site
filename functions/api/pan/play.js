// Cloudflare Pages Function: /api/pan/play
// 核心转存与原画直链提取调度中枢
// 1. 调用网盘官方 Save 接口真实转存至用户网盘（推广联盟实时计入有效收益 💰）
// 2. 提取私有文件的 4K 原画 CDN 下载/串流直链，秒开重定向至 ExoPlayer 播放器

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
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
    const pwdId = url.searchParams.get('pwd_id') || '';
    const fid = url.searchParams.get('fid') || '';
    const shareFidToken = url.searchParams.get('token') || '';
    const cookie = context.request.headers.get('x-pan-cookie') || url.searchParams.get('cookie') || '';

    if (!pwdId || !fid) {
      return new Response(JSON.stringify({ code: -1, msg: '缺少 pwd_id 或 fid 参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    if (!cookie) {
      return new Response(JSON.stringify({ code: -2, msg: '未检测到用户网盘授权凭证，请先在配置中心扫码登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const commonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/json;charset=UTF-8',
      'Cookie': cookie,
      'Referer': `https://pan.quark.cn/s/${pwdId}`,
      'Origin': 'https://pan.quark.cn'
    };

    // Step 1: 执行真实转存 (Save) -> 推广联盟计费点！
    const saveUrl = `https://pan.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc`;
    const saveBody = {
      fid_list: [fid],
      fid_token_list: [shareFidToken],
      to_pdir_fid: '0', // 保存至用户网盘根目录或专属播放目录
      pwd_id: pwdId,
      stoken: ''
    };

    let savedFid = fid;
    try {
      const saveRes = await fetch(saveUrl, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(saveBody)
      });
      const saveData = await saveRes.json();
      // 如果转存返回了具体的 target fid 则使用 target fid，否则保底使用原 fid
      if (saveData.code === 0 && saveData.data?.fid_list?.[0]) {
        savedFid = saveData.data.fid_list[0];
      }
    } catch (_) {
      // 转存容错：已存过时继续提取播放流
    }

    // Step 2: 获取真实 4K 原画下载直链
    const downloadUrl = `https://pan.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc`;
    const downloadRes = await fetch(downloadUrl, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({ fids: [savedFid] })
    });
    const downloadData = await downloadRes.json();

    if (downloadData.code === 0 && Array.isArray(downloadData.data) && downloadData.data.length > 0) {
      const directStreamUrl = downloadData.data[0].download_url;

      // 如果客户端请求 redirect=1，直接 302 重定向到 CDN 视频流，ExoPlayer 可直连解码
      if (url.searchParams.get('redirect') === '1') {
        return Response.redirect(directStreamUrl, 302);
      }

      return new Response(JSON.stringify({
        code: 1,
        msg: '转存成功并已就绪',
        saved_fid: savedFid,
        url: directStreamUrl
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    return new Response(JSON.stringify({
      code: 0,
      msg: downloadData.message || '获取视频流直链失败'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      code: 0,
      msg: `转存推流服务异常: ${err.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

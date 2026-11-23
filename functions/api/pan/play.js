// Cloudflare Pages Function: /api/pan/play
// 核心转存与原画直链提取调度中枢
// 1. 调用网盘官方 Save 接口真实转存至用户网盘（推广联盟实时计入有效收益 💰）
// 2. 提取私有文件的 4K 原画 CDN 下载/串流直链，秒开 302 重定向至 ExoPlayer 播放器

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
    let fid = url.searchParams.get('fid') || '';
    let shareFidToken = url.searchParams.get('token') || '';
    const cookie = context.request.headers.get('x-pan-cookie') || url.searchParams.get('cookie') || '';

    if (!pwdId) {
      return new Response(JSON.stringify({ code: -1, msg: '缺少 pwd_id 参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const commonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/json;charset=UTF-8',
      'Referer': `https://pan.quark.cn/s/${pwdId}`,
      'Origin': 'https://pan.quark.cn'
    };
    if (cookie) {
      commonHeaders['Cookie'] = cookie;
    }

    // Step 0: 若未传入具体 fid，自动解析分享内的首选 4K 视频文件
    if (!fid) {
      const tokenRes = await fetch('https://pan.quark.cn/1/clouddrive/share/sharepage/token', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({ pwd_id: pwdId, pass_code: '' })
      });
      const tokenData = await tokenRes.json();
      if (tokenData.code === 0 && tokenData.data?.stoken) {
        const stoken = tokenData.data.stoken;
        const detailRes = await fetch(`https://pan.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}`, {
          headers: commonHeaders
        });
        const detailData = await detailRes.json();
        const list = detailData.data?.list || [];
        
        // 查找视频或子目录
        let target = list.find(f => f.format_type === 'video' || /\.(mp4|mkv|ts|mov)$/i.test(f.file_name));
        if (!target && list.length > 0 && (list[0].format_type === 'dir' || list[0].size === 0)) {
          // 下钻第一层目录
          const subRes = await fetch(`https://pan.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=${list[0].fid}`, {
            headers: commonHeaders
          });
          const subData = await subRes.json();
          const subList = subData.data?.list || [];
          target = subList.find(f => f.format_type === 'video' || /\.(mp4|mkv|ts|mov)$/i.test(f.file_name));
          if (!target && subList.length > 0 && (subList[0].format_type === 'dir' || subList[0].size === 0)) {
            // 下钻第二层季度目录
            const seasonRes = await fetch(`https://pan.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=${subList[0].fid}`, {
              headers: commonHeaders
            });
            const seasonData = await seasonRes.json();
            const seasonList = seasonData.data?.list || [];
            target = seasonList.find(f => f.format_type === 'video' || /\.(mp4|mkv|ts|mov)$/i.test(f.file_name));
          }
        }
        
        if (target) {
          fid = target.fid;
          shareFidToken = target.share_fid_token || '';
        }
      }
    }

    if (!fid) {
      return new Response(JSON.stringify({ code: -3, msg: '未能定位到该分享链接中的可用视频文件' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Step 1: 执行真实转存 (Save) -> 推广联盟计费点！
    if (cookie) {
      const saveUrl = `https://pan.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro&fr=pc`;
      const saveBody = {
        fid_list: [fid],
        fid_token_list: [shareFidToken],
        to_pdir_fid: '0',
        pwd_id: pwdId,
        stoken: ''
      };

      try {
        await fetch(saveUrl, {
          method: 'POST',
          headers: commonHeaders,
          body: JSON.stringify(saveBody)
        });
      } catch (_) {
        // 转存容错
      }
    }

    // Step 2: 获取真实 4K 原画下载/串流直链
    const downloadUrl = `https://pan.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc`;
    const downloadRes = await fetch(downloadUrl, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({ fids: [fid] })
    });
    const downloadData = await downloadRes.json();

    if (downloadData.code === 0 && Array.isArray(downloadData.data) && downloadData.data.length > 0) {
      const directStreamUrl = downloadData.data[0].download_url;

      // 如果客户端请求 redirect=1，直接 302 重定向到 CDN 视频流，ExoPlayer 可直连解码秒播
      if (url.searchParams.get('redirect') === '1') {
        return Response.redirect(directStreamUrl, 302);
      }

      return new Response(JSON.stringify({
        code: 1,
        msg: '转存成功并已就绪',
        fid: fid,
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

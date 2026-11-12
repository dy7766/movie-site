import fs from 'fs';
import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';
import { sendDingTalkCapacityAlert } from './dingtalk-service.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';
const TARGET_FOLDER_FID = '8c4fd9e810c643529d1e6fe59b17ea42'; // movie-site

function getUcCookie() {
  if (process.env.UC_COOKIE) return process.env.UC_COOKIE.trim();
  const localFile = 'C:/Users/dy776/.gemini/antigravity/brain/fe3e2fd5-ed4e-452e-b677-b0a95e97eddc/scratch/uc_cookie.txt';
  if (fs.existsSync(localFile)) return fs.readFileSync(localFile, 'utf-8').trim();
  return '';
}

function fetchJson(url) {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `curl.exe -s "${url}"` : `curl -s "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// 1. 搜源 (调用公共 UC/夸克 索引接口，多变体清洗搜索)
async function querySingleShareTitle(keyword) {
  const url = `https://gugeso.com/api/other/web_search?title=${encodeURIComponent(keyword)}&is_type=3`;
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin 
      ? `curl.exe -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://gugeso.com/" "${url}"`
      : `curl -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://gugeso.com/" "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 10000 });
    const items = [];
    for (const l of stdout.split('\n')) {
      if (l.startsWith('data:') && !l.includes('[DONE]')) {
        try {
          const it = JSON.parse(l.slice(5).trim());
          if (it.url && it.url.includes('uc.cn/s/')) {
            const pwdMatch = it.url.match(/uc\.cn\/s\/([a-zA-Z0-9]+)/);
            if (pwdMatch) {
              items.push({ title: it.title, url: it.url, pwd_id: pwdMatch[1] });
            }
          }
        } catch {}
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function searchPublicShares(title) {
  const rawTitle = (title || '').trim();
  const variants = [rawTitle];

  // 变体1: 去除括号及其中内容，如《蓝色星球 第二季 (Blue Planet II)》 -> 《蓝色星球 第二季》
  const cleanParen = rawTitle.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim();
  if (cleanParen && cleanParen !== rawTitle && !variants.includes(cleanParen)) {
    variants.push(cleanParen);
  }

  // 变体2: 阿拉伯数字续集转换，如《庆余年2》 -> 《庆余年 第二季》/《庆余年第二季》/《庆余年》
  const numMatch = cleanParen.match(/^(.*?)([\d]+)$/);
  if (numMatch) {
    const base = numMatch[1].trim();
    const num = parseInt(numMatch[2]);
    const cnNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const cnNum = cnNums[num] || num;
    const v1 = `${base} 第${cnNum}季`;
    const v2 = `${base}第${cnNum}季`;
    const v3 = `${base} 第${cnNum}部`;
    const v4 = `${base} ${num}`;
    const v5 = base; // 纯主标题保底
    [v1, v2, v3, v4, v5].forEach(v => {
      if (v && !variants.includes(v)) variants.push(v);
    });
  }

  // 变体3: 中文“第X季”转换与剥离，如《老友记 第十季》 -> 《老友记》
  const cleanSeason = cleanParen.replace(/[:：]/g, ' ').replace(/\s*第[一二三四五六七八九十\d]+[季期部]/g, '').trim();
  if (cleanSeason && !variants.includes(cleanSeason)) {
    variants.push(cleanSeason);
  }

  // 变体4: 去除副标题破折号或冒号，如《死神 千年血战篇 -祸进谭-》 -> 《死神 千年血战篇》
  const cleanDash = cleanParen.split(/[-——:：]/)[0].trim();
  if (cleanDash && cleanDash.length >= 2 && !variants.includes(cleanDash)) {
    variants.push(cleanDash);
  }

  for (const q of variants) {
    const list = await querySingleShareTitle(q);
    if (list.length > 0) {
      // 优先过滤短剧/纯文本/小说垃圾链接
      const filtered = list.filter(item => {
        const t = item.title || '';
        return !/(短剧|小说|电子书|网文|有声书|广播剧|合辑|总链)/i.test(t);
      });
      const resList = filtered.length > 0 ? filtered : list;
      if (q !== rawTitle) {
        console.log(`  💡 采用优化关键词《${q}》匹配到 ${resList.length} 个公开分享`);
      }
      return resList;
    }
  }
  return [];
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 统一的 UC API 网络请求器 (内置 IPv4 降级，彻底解决海外 Linux 节点 IPv6 丢包重置问题)
async function ucFetch(url, options = {}) {
  const method = options.method || 'GET';
  const headers = { 'User-Agent': BROWSER_UA, ...options.headers };
  const body = options.body;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    // 触发海外节点降级 curl -4 强制走 IPv4
  }

  try {
    const isWin = process.platform === 'win32';
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v.replace(/"/g, '\\"')}"`)
      .join(' ');
    let cmd = isWin ? `curl.exe -s -4 -m 12` : `curl -s -4 -m 12`;
    cmd += ` -X ${method} ${headerArgs}`;
    if (body) {
      const escapedBody = body.replace(/"/g, '\\"');
      cmd += ` -d "${escapedBody}"`;
    }
    cmd += ` "${url}"`;

    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(stdout),
      text: async () => stdout
    };
  } catch (err) {
    throw new Error(`UC 请求异常(IPv4降级亦未果): ${err.message}`);
  }
}

// 2. 深度质检 (统一 pr=UCBrowser&fr=pc，拦截压缩包与纯文本小说，放宽单次转存至 50)
export async function inspectAndFilterUcShare(pwd_id) {
  try {
    const tokenRes = await ucFetch('https://pc-api.uc.cn/1/clouddrive/share/sharepage/token?pr=UCBrowser&fr=pc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pwd_id })
    });
    const tData = await tokenRes.json();
    if (tData.code !== 0 || !tData.data?.stoken) return { pass: false, reason: `链接失效或无stoken (${tData.message || 'error'})` };
    const stoken = tData.data.stoken;

    const detailRes = await ucFetch(`https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pr=UCBrowser&fr=pc&pwd_id=${pwd_id}&stoken=${encodeURIComponent(stoken)}&pdir_fid=0&force=0&_page=1&_size=50`, {
      headers: { 'User-Agent': BROWSER_UA }
    });
    const dData = await detailRes.json();
    const list = dData.data?.list || [];
    if (list.length === 0) return { pass: false, reason: '分享列表为空' };

    // 必须包含有效视频文件或目录 (过滤纯文本/小说)
    const isDir = f => (f.dir === true || f.file_type === 0 || f.file_type === 'dir') && !/(txt|小说|电子书|网文)/i.test(f.file_name);
    const isVideoFile = f => /\.(mp4|mkv|ts|mov|avi|flv|wmv|m3u8|iso)$/i.test(f.file_name);
    const hasVideoOrDir = list.some(f => isDir(f) || isVideoFile(f));
    if (!hasVideoOrDir) return { pass: false, reason: '无有效视频或目录(过滤纯文本/空目录)' };

    // 若全部文件均为压缩包或可执行文件（且无任何视频或有效目录），才予以拦截
    const allZipOrExe = list.every(f => /\.(zip|rar|7z|tar|gz|exe|apk|txt|doc|pdf)$/i.test(f.file_name));
    if (allZipOrExe) return { pass: false, reason: '纯压缩包或程序安装包' };

    // 单次转存文件数上限防护
    if (list.length > 50) return { pass: false, reason: `项目数量过多(${list.length})，规避会员等级限制` };

    return {
      pass: true,
      stoken,
      title: tData.data.title,
      list
    };
  } catch (e) {
    return { pass: false, reason: e.message };
  }
}

// 2.5 检查 UC 网盘容量与安全水位
export async function checkUcCapacity() {
  const cookie = getUcCookie();
  if (!cookie) return { ok: false, error: '未配置 UC Cookie' };
  try {
    const res = await ucFetch('https://pc-api.uc.cn/1/clouddrive/member?pr=UCBrowser&fr=pc', {
      headers: {
        'cookie': cookie,
        'referer': 'https://drive.uc.cn/'
      }
    });
    const data = await res.json();
    if (data.code === 0 && data.data) {
      const total = Number(data.data.total_capacity) || 0;
      const used = Number(data.data.use_capacity) || 0;
      const free = Math.max(0, total - used);
      const freeGb = parseFloat((free / (1024 * 1024 * 1024)).toFixed(2));
      const totalTb = parseFloat((total / (1024 * 1024 * 1024 * 1024)).toFixed(2));
      const usedTb = parseFloat((used / (1024 * 1024 * 1024 * 1024)).toFixed(2));
      return {
        ok: true,
        total,
        used,
        free,
        freeGb,
        totalTb,
        usedTb,
        isFull: free < 15 * 1024 * 1024 * 1024 // 剩余空间少于 15GB 判定为不足触发熔断
      };
    }
    return { ok: false, error: data.message || '获取容量失败' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 3. 转存入个人盘、重命名并生成带 PID 专属分享链接 (返回完整详情)
export async function saveAndShareUcDetail(targetTitle, year, category, pwd_id, stoken, list) {
  const cookie = getUcCookie();
  if (!cookie) {
    console.error('未配置 UC Cookie，无法执行个人盘秒存');
    return null;
  }

  // 容量前置预检与熔断
  const cap = await checkUcCapacity();
  if (cap.ok && cap.isFull) {
    console.warn(`  🚨 [UC网盘容量不足熔断] 剩余空间仅 ${cap.freeGb} GB (< 15GB)，已暂停转存以防假绑定死链`);
    await sendDingTalkCapacityAlert({
      usedTb: cap.usedTb,
      totalTb: cap.totalTb,
      freeGb: cap.freeGb,
      provider: 'UC'
    });
    return null;
  }

  const HEADERS = {
    'cookie': cookie,
    'content-type': 'application/json',
    'origin': 'https://drive.uc.cn',
    'referer': 'https://drive.uc.cn/',
    'user-agent': BROWSER_UA
  };

  // 优先选取目录或视频文件作为转存目标项
  const sortedList = [...list].sort((a, b) => {
    const aScore = (a.dir || a.file_type === 0 || a.file_type === 'dir') ? 2 : (/\.(mp4|mkv|ts|mov|avi)$/i.test(a.file_name) ? 1 : 0);
    const bScore = (b.dir || b.file_type === 0 || b.file_type === 'dir') ? 2 : (/\.(mp4|mkv|ts|mov|avi)$/i.test(b.file_name) ? 1 : 0);
    return bScore - aScore;
  });
  const rootItem = sortedList[0] || list[0];
  const saveRes = await ucFetch('https://pc-api.uc.cn/1/clouddrive/share/sharepage/save?pr=UCBrowser&fr=pc', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      pwd_id,
      stoken,
      fid_list: [rootItem.fid],
      fid_token_list: [rootItem.share_fid_token],
      to_pdir_fid: TARGET_FOLDER_FID
    })
  });
  const sData = await saveRes.json();
  if (sData.code !== 0) {
    console.log(`  ✗ 转存被拒绝: ${sData.message}`);
    return null;
  }

  await new Promise(r => setTimeout(r, 2000));

  // 定位新存入的项（精确匹配文件名，严禁盲目回退到 list[0]）
  const folderRes = await ucFetch(`https://pc-api.uc.cn/1/clouddrive/file/sort?pr=UCBrowser&fr=pc&pdir_fid=${TARGET_FOLDER_FID}&_page=1&_size=15&_sort=file_type:asc,updated_at:desc`, {
    headers: HEADERS
  });
  const fData = await folderRes.json();
  const savedItem = fData.data?.list?.find(f => f.file_name === rootItem.file_name);
  if (!savedItem) {
    console.log(`  ✗ 未能在目标目录定位到新转存的项: ${rootItem.file_name} (转存可能因空间不足或接口异常失败)`);
    return null;
  }

  // 深度质检：严禁转存空文件夹
  if (savedItem.dir && (savedItem.include_items === 0 || savedItem.include_items === undefined)) {
    await new Promise(r => setTimeout(r, 1500));
    const checkRes = await ucFetch(`https://pc-api.uc.cn/1/clouddrive/file/sort?pr=UCBrowser&fr=pc&pdir_fid=${savedItem.fid}&_page=1&_size=5`, { headers: HEADERS });
    const checkData = await checkRes.json();
    if (!checkData.data?.list || checkData.data.list.length === 0) {
      console.log(`  ✗ 转存项为空目录 (0 文件)，判定为失败`);
      return null;
    }
  }

  // 规范重命名
  const standardName = `${targetTitle}.${year}.4K.高码率.原盘`;
  await ucFetch('https://pc-api.uc.cn/1/clouddrive/file/rename?pr=UCBrowser&fr=pc', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fid: savedItem.fid, file_name: standardName })
  });

  // 创建专属永久分享
  await ucFetch('https://pc-api.uc.cn/1/clouddrive/share?pr=UCBrowser&fr=pc', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      fid_list: [savedItem.fid],
      title: standardName,
      url_type: 1,
      expired_type: 1,
      passcode: ''
    })
  });

  await new Promise(r => setTimeout(r, 1200));

  // 提取带用户 UID 的专属链接（精确匹配 first_fid 或 title）
  const myRes = await ucFetch('https://pc-api.uc.cn/1/clouddrive/share/mypage/detail?pr=UCBrowser&fr=pc&_page=1&_size=8', {
    headers: HEADERS
  });
  const myData = await myRes.json();
  const share = myData.data?.list?.find(s => s.first_fid === savedItem.fid || s.title === standardName);
  if (!share || !share.share_url) {
    console.log(`  ✗ 未能获取到新生成的专属分享链接`);
    return null;
  }
  return {
    shareUrl: share.share_url,
    fid: savedItem.fid,
    pwdId: share.share_id,
    title: standardName
  };
}

export async function saveAndShareUc(targetTitle, year, category, pwd_id, stoken, list) {
  const detail = await saveAndShareUcDetail(targetTitle, year, category, pwd_id, stoken, list);
  return detail ? detail.shareUrl : null;
}

// 增量追更：获取我方网盘目录下的文件列表
export async function getUcFolderFiles(pdir_fid) {
  const cookie = getUcCookie();
  if (!cookie) return [];
  const HEADERS = {
    'cookie': cookie,
    'referer': 'https://drive.uc.cn/',
    'user-agent': BROWSER_UA
  };
  try {
    const res = await ucFetch(`https://pc-api.uc.cn/1/clouddrive/file/sort?pr=UCBrowser&fr=pc&pdir_fid=${pdir_fid}&_page=1&_size=100`, { headers: HEADERS });
    const data = await res.json();
    return data.data?.list || [];
  } catch {
    return [];
  }
}

// 增量追更：将新单集直接存入已有目录
export async function saveFilesToExistingUcFolder(pdir_fid, pwd_id, stoken, fileItems) {
  const cookie = getUcCookie();
  if (!cookie || !fileItems || fileItems.length === 0) return { ok: false, count: 0 };
  const HEADERS = {
    'cookie': cookie,
    'content-type': 'application/json',
    'origin': 'https://drive.uc.cn',
    'referer': 'https://drive.uc.cn/',
    'user-agent': BROWSER_UA
  };
  try {
    const saveRes = await ucFetch('https://pc-api.uc.cn/1/clouddrive/share/sharepage/save?pr=UCBrowser&fr=pc', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        pwd_id,
        stoken,
        fid_list: fileItems.map(f => f.fid),
        fid_token_list: fileItems.map(f => f.share_fid_token),
        to_pdir_fid: pdir_fid
      })
    });
    const sData = await saveRes.json();
    return { ok: sData.code === 0, count: sData.code === 0 ? fileItems.length : 0, message: sData.message };
  } catch (err) {
    return { ok: false, count: 0, error: err.message };
  }
}

// 物理删除指定 UC 文件/文件夹
export async function deleteUcFiles(filelist) {
  const cookie = getUcCookie();
  if (!cookie || !filelist || filelist.length === 0) return false;
  const HEADERS = {
    'cookie': cookie,
    'content-type': 'application/json',
    'origin': 'https://drive.uc.cn',
    'referer': 'https://drive.uc.cn/',
    'user-agent': BROWSER_UA
  };
  try {
    const res = await ucFetch('https://pc-api.uc.cn/1/clouddrive/file/delete?pr=UCBrowser&fr=pc', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ filelist })
    });
    const data = await res.json();
    return data.code === 0;
  } catch {
    return false;
  }
}

// 4. TMDB 抓取并同步 Supabase 数据库
export async function syncMovieToDatabase(pool, title, year, category, ucLink) {
  const existRes = await pool.query(
    'SELECT id, title, share_link_uc FROM resources WHERE title ILIKE $1 LIMIT 1',
    [`%${title}%`]
  );
  if (existRes.rows.length > 0) {
    const row = existRes.rows[0];
    await pool.query('UPDATE resources SET share_link_uc = $1 WHERE id = $2', [ucLink, row.id]);
    return row;
  }

  const sUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
  const sData = fetchJson(sUrl);
  const hit = sData?.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv') || sData?.results?.[0];
  if (!hit) return null;

  const isMovie = hit.media_type !== 'tv';
  const dUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${hit.id}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits,images`;
  const d = fetchJson(dUrl);
  if (!d) return null;

  const realTitle = d.title || d.name || title;
  const original_title = d.original_title || d.original_name || realTitle;
  const realYear = parseInt((d.release_date || d.first_air_date || String(year)).slice(0, 4)) || year;
  const score = d.vote_average ? parseFloat(d.vote_average.toFixed(1)) : 8.0;
  const genres = d.genres?.map(g => g.name) || ['剧情', '热门'];
  const poster_url = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '';
  const backdrop_url = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : '';
  const intro = d.overview || '暂无剧情简介';
  const actors = (d.credits?.cast || []).slice(0, 5).map(c => c.name).join(' / ');
  const country = d.production_countries?.[0]?.name || '中国大陆';
  const stills = (d.images?.backdrops || []).slice(0, 6).map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`);
  const reviews = [
    {
      id: '1',
      author: '热映影评',
      avatar: '评',
      rating: score >= 8 ? 5 : 4,
      date: '2024-06-01',
      votes: 1200,
      content: `院线大热之作，剧作扎实，4K原盘画质细腻无损！`
    }
  ];

  const insertSql = `
    INSERT INTO resources (
      title, original_title, poster_url, category, tags, year, score, actors, 
      intro, drive_type, share_link_uc, country, stills, reviews
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id, title, category, year, share_link_uc;
  `;
  const insRes = await pool.query(insertSql, [
    realTitle, original_title, poster_url, category, genres, realYear, score,
    actors, intro, 'uc', ucLink, country, JSON.stringify(stills), JSON.stringify(reviews)
  ]);
  return insRes.rows[0];
}

// 调度主流程：按 10:1 电影优先策略自动转存
export async function harvestBatchMovies(candidateList) {
  const pool = getDbPool();
  const successItems = [];

  for (const m of candidateList) {
    console.log(`\n🔍 正在检索电影《${m.title}》(${m.year})...`);
    const candidates = await searchPublicShares(m.title);
    for (const c of candidates) {
      const inspect = await inspectAndFilterUcShare(c.pwd_id);
      if (!inspect.pass) continue;

      const ucLink = await saveAndShareUc(m.title, m.year, '电影', c.pwd_id, inspect.stoken, inspect.list);
      if (ucLink) {
        const synced = await syncMovieToDatabase(pool, m.title, m.year, '电影', ucLink);
        if (synced) {
          successItems.push({
            title: m.title,
            year: m.year,
            quality: '4K 高码率原盘',
            share_link_uc: ucLink
          });
          break;
        }
      }
    }
    await new Promise(r => setTimeout(r, 1200));
  }

  return successItems;
}

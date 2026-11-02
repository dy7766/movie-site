import fs from 'fs';
import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';

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

// 1. 搜源 (调用公共 UC/夸克 索引接口，使用 curl 避免 Node fetch 代理连接重置)
export async function searchPublicShares(title) {
  const url = `https://gugeso.com/api/other/web_search?title=${encodeURIComponent(title)}&is_type=3`;
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

// 2. 深度质检 (统一 pr=UCBrowser&fr=pc，拦截压缩包与 >30 文件的非会员限制)
export async function inspectAndFilterUcShare(pwd_id) {
  try {
    const tokenRes = await fetch('https://pc-api.uc.cn/1/clouddrive/share/sharepage/token?pr=UCBrowser&fr=pc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pwd_id })
    });
    const tData = await tokenRes.json();
    if (tData.code !== 0 || !tData.data?.stoken) return { pass: false, reason: '链接失效或不存在' };
    const stoken = tData.data.stoken;

    const detailRes = await fetch(`https://pc-api.uc.cn/1/clouddrive/share/sharepage/detail?pr=UCBrowser&fr=pc&pwd_id=${pwd_id}&stoken=${encodeURIComponent(stoken)}&pdir_fid=0&force=0&_page=1&_size=50`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const dData = await detailRes.json();
    const list = dData.data?.list || [];
    if (list.length === 0) return { pass: false, reason: '分享列表为空' };

    // 拦截压缩包与可执行文件
    const hasZip = list.some(f => /\.(zip|rar|7z|tar|gz|exe|apk)$/i.test(f.file_name));
    if (hasZip) return { pass: false, reason: '包含压缩包/程序包' };

    // 单次转存文件数上限防护
    if (list.length > 30) return { pass: false, reason: `项目数量过多(${list.length})，规避会员等级限制` };

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

// 3. 转存入个人盘、重命名并生成带 PID 专属分享链接
export async function saveAndShareUc(targetTitle, year, category, pwd_id, stoken, list) {
  const cookie = getUcCookie();
  if (!cookie) {
    console.error('未配置 UC Cookie，无法执行个人盘秒存');
    return null;
  }

  const HEADERS = {
    'cookie': cookie,
    'content-type': 'application/json',
    'origin': 'https://drive.uc.cn',
    'referer': 'https://drive.uc.cn/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const rootItem = list[0];
  const saveRes = await fetch('https://pc-api.uc.cn/1/clouddrive/share/sharepage/save?pr=UCBrowser&fr=pc', {
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

  // 定位新存入的项
  const folderRes = await fetch(`https://pc-api.uc.cn/1/clouddrive/file/sort?pr=UCBrowser&fr=pc&pdir_fid=${TARGET_FOLDER_FID}&_page=1&_size=10&_sort=file_type:asc,updated_at:desc`, {
    headers: HEADERS
  });
  const fData = await folderRes.json();
  const savedItem = fData.data?.list?.find(f => f.file_name === rootItem.file_name);
  if (!savedItem) return null;

  // 规范重命名
  const standardName = `${targetTitle}.${year}.4K.高码率.原盘`;
  await fetch('https://pc-api.uc.cn/1/clouddrive/file/rename?pr=UCBrowser&fr=pc', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ fid: savedItem.fid, file_name: standardName })
  });

  // 创建专属永久分享
  await fetch('https://pc-api.uc.cn/1/clouddrive/share?pr=UCBrowser&fr=pc', {
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

  // 提取带用户 UID 的专属链接
  const myRes = await fetch('https://pc-api.uc.cn/1/clouddrive/share/mypage/detail?pr=UCBrowser&fr=pc&_page=1&_size=8', {
    headers: HEADERS
  });
  const myData = await myRes.json();
  const share = myData.data?.list?.find(s => s.first_fid === savedItem.fid || s.title === standardName);
  return share?.share_url || null;
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

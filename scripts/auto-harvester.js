import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';
import {
  BROWSER_UA,
  getDriveCookie,
  searchDriveShares,
  inspectDriveShare,
  checkDriveCapacity,
  saveAndShareDrive,
  getDriveFolderFiles,
  saveFilesToExistingDriveFolder,
  deleteDriveFiles,
  deleteDriveShares,
  countDriveVideosDetailed
} from './drive-client.js';

export { BROWSER_UA };

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

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

// ===============================================================
// UC 网盘兼容导出（委托给公共驱动 drive-client.js）
// ===============================================================
export async function searchPublicShares(title) {
  return searchDriveShares('uc', title);
}

export async function inspectAndFilterUcShare(pwd_id) {
  return inspectDriveShare('uc', pwd_id);
}

export async function checkUcCapacity() {
  return checkDriveCapacity('uc');
}

export async function saveAndShareUcDetail(targetTitle, year, category, pwd_id, stoken, list) {
  return saveAndShareDrive('uc', { title: targetTitle, year, category, pwdId: pwd_id, stoken, list });
}

export async function saveAndShareUc(targetTitle, year, category, pwd_id, stoken, list) {
  const detail = await saveAndShareUcDetail(targetTitle, year, category, pwd_id, stoken, list);
  return detail ? detail.shareUrl : null;
}

export async function getUcFolderFiles(pdir_fid) {
  return getDriveFolderFiles('uc', pdir_fid, 100);
}

export async function saveFilesToExistingUcFolder(pdir_fid, pwd_id, stoken, fileItems) {
  return saveFilesToExistingDriveFolder('uc', pdir_fid, pwd_id, stoken, fileItems);
}

export async function deleteUcFiles(filelist) {
  const res = await deleteDriveFiles('uc', filelist);
  return res.ok;
}

// ===============================================================
// 夸克网盘兼容导出（委托给公共驱动 drive-client.js）
// ===============================================================
export function getQuarkCookie() {
  return getDriveCookie('quark');
}

export async function searchQuarkShares(title) {
  return searchDriveShares('quark', title);
}

export async function inspectAndFilterQuarkShare(pwd_id) {
  return inspectDriveShare('quark', pwd_id);
}

export async function checkQuarkCapacity() {
  return checkDriveCapacity('quark');
}

export async function saveAndShareQuarkDetail(title, year, pwd_id, stoken, list) {
  return saveAndShareDrive('quark', { title, year, pwdId: pwd_id, stoken, list });
}

export async function saveAndShareQuark(title, pwd_id, stoken, list, year = '') {
  const detail = await saveAndShareQuarkDetail(title, year, pwd_id, stoken, list);
  return detail ? detail.shareUrl : null;
}

export async function countQuarkVideosDetailed(pwdId) {
  return countDriveVideosDetailed('quark', pwdId);
}

export async function deleteQuarkFiles(fids = []) {
  return deleteDriveFiles('quark', fids);
}

export async function deleteQuarkShares(shareIds = []) {
  return deleteDriveShares('quark', shareIds);
}

// ===============================================================
// TMDB 抓取并同步 Supabase 数据库
// ===============================================================
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

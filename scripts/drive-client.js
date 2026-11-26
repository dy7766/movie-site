import fs from 'fs';
import { execSync } from 'child_process';
import { getTransferSettings } from '../src/lib/db.js';
import { sendDingTalkCapacityAlert } from './dingtalk-service.js';

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const DRIVE_CONFIGS = {
  uc: {
    key: 'uc',
    label: 'UC网盘',
    alertProvider: 'UC',
    baseUrl: 'https://pc-api.uc.cn/1/clouddrive',
    pr: 'UCBrowser',
    origin: 'https://drive.uc.cn',
    referer: 'https://drive.uc.cn/',
    targetFolderFid: '8c4fd9e810c643529d1e6fe59b17ea42', // movie-site
    gugesoType: 3,
    shareHostMatch: 'uc.cn/s/',
    shareRegex: /uc\.cn\/s\/([a-zA-Z0-9]+)/,
    envCookieKey: 'UC_COOKIE',
    localCookieFile: 'C:/Users/dy776/.gemini/antigravity/brain/fe3e2fd5-ed4e-452e-b677-b0a95e97eddc/scratch/uc_cookie.txt',
    needsDecrypt: false
  },
  quark: {
    key: 'quark',
    label: '夸克网盘',
    alertProvider: '夸克',
    baseUrl: 'https://drive-pc.quark.cn/1/clouddrive',
    pr: 'ucpro',
    origin: 'https://pan.quark.cn',
    referer: 'https://pan.quark.cn/',
    targetFolderFid: 'b1a2edeeac1c48718c0dab99843cb97c', // movie-site
    gugesoType: 0,
    shareHostMatch: 'quark.cn/s/',
    shareRegex: /quark\.cn\/s\/([a-zA-Z0-9]+)/,
    envCookieKey: 'QUARK_COOKIE',
    localCookieFile: 'C:/Users/dy776/.gemini/antigravity/brain/fe3e2fd5-ed4e-452e-b677-b0a95e97eddc/scratch/quark_cookie.txt',
    needsDecrypt: true
  }
};

function getDriveConfig(driveType) {
  const cfg = DRIVE_CONFIGS[driveType];
  if (!cfg) throw new Error(`不支持的网盘类型: ${driveType}`);
  return cfg;
}

export function getDriveCookie(driveType) {
  const cfg = getDriveConfig(driveType);
  if (process.env[cfg.envCookieKey]) return process.env[cfg.envCookieKey].trim();
  if (fs.existsSync(cfg.localCookieFile)) return fs.readFileSync(cfg.localCookieFile, 'utf-8').trim();
  return '';
}

function getDriveHeaders(driveType, withCookie = true) {
  const cfg = getDriveConfig(driveType);
  const headers = {
    'content-type': 'application/json',
    'origin': cfg.origin,
    'referer': cfg.referer,
    'user-agent': BROWSER_UA
  };
  if (withCookie) {
    const cookie = getDriveCookie(driveType);
    if (cookie) headers['cookie'] = cookie;
  }
  return headers;
}

/**
 * 统一网盘 API 请求器（支持超时与 curl -4 IPv4 降级）
 */
export async function driveFetch(driveType, pathWithQuery, options = {}) {
  const cfg = getDriveConfig(driveType);
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  const url = `${cfg.baseUrl}${pathWithQuery}${sep}pr=${cfg.pr}&fr=pc`;
  const method = options.method || 'GET';
  const headers = {
    ...getDriveHeaders(driveType, options.withCookie !== false),
    ...options.headers
  };
  const body = options.body;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { ...options, method, headers, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    // 海外节点 IPv6 异常时降级 curl -4
  }

  try {
    const isWin = process.platform === 'win32';
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${String(v).replace(/"/g, '\\"')}"`)
      .join(' ');
    let cmd = isWin ? 'curl.exe -s -4 -m 12' : 'curl -s -4 -m 12';
    cmd += ` -X ${method} ${headerArgs}`;
    if (body) {
      const escapedBody = String(body).replace(/"/g, '\\"');
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
    throw new Error(`${cfg.label} 请求异常(IPv4降级亦未果): ${err.message}`);
  }
}

function buildSearchVariants(title) {
  const rawTitle = (title || '').trim();
  const variants = [rawTitle];

  // 去除括号及其中内容
  const cleanParen = rawTitle.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim();
  if (cleanParen && cleanParen !== rawTitle && !variants.includes(cleanParen)) {
    variants.push(cleanParen);
  }

  // 阿拉伯数字续集转换
  const numMatch = cleanParen.match(/^(.*?)([\d]+)$/);
  if (numMatch) {
    const base = numMatch[1].trim();
    const num = parseInt(numMatch[2], 10);
    const cnNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const cnNum = cnNums[num] || num;
    [
      `${base} 第${cnNum}季`,
      `${base}第${cnNum}季`,
      `${base} 第${num}季`,
      `${base} 第${cnNum}部`,
      `${base} ${num}`,
      base
    ].forEach(v => {
      if (v && !variants.includes(v)) variants.push(v);
    });
  }

  // 剥离“第X季/期/部”
  const cleanSeason = cleanParen.replace(/[:：]/g, ' ').replace(/\s*第[一二三四五六七八九十\d]+[季期部]/g, '').trim();
  if (cleanSeason && !variants.includes(cleanSeason)) {
    variants.push(cleanSeason);
  }

  // 去除副标题
  const cleanDash = cleanParen.split(/[-——:：]/)[0].trim();
  if (cleanDash && cleanDash.length >= 2 && !variants.includes(cleanDash)) {
    variants.push(cleanDash);
  }

  // 追更常用词补充
  if (cleanParen) {
    [`${cleanParen} S01`, `${cleanParen} 第一季`, `${cleanParen} 全集`].forEach(v => {
      if (!variants.includes(v)) variants.push(v);
    });
  }

  return variants;
}

/**
 * 1. 统一公共搜源（支持 UC 与 夸克）
 */
export async function searchDriveShares(driveType, title) {
  const cfg = getDriveConfig(driveType);
  const rawTitle = (title || '').trim();
  const variants = buildSearchVariants(rawTitle);

  for (const q of variants) {
    try {
      const url = `https://gugeso.com/api/other/web_search?title=${encodeURIComponent(q)}&is_type=${cfg.gugesoType}`;
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? `curl.exe -s -H "User-Agent: ${BROWSER_UA}" -H "Accept: application/json, text/plain, */*" -H "Referer: https://gugeso.com/" "${url}"`
        : `curl -s -H "User-Agent: ${BROWSER_UA}" -H "Accept: application/json, text/plain, */*" -H "Referer: https://gugeso.com/" "${url}"`;
      const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 10000 });

      const rawItems = [];
      for (const line of stdout.split('\n')) {
        if (line.startsWith('data:') && !line.includes('[DONE]')) {
          try {
            const item = JSON.parse(line.slice(5).trim());
            if (item.url) rawItems.push(item);
          } catch {}
        }
      }
      if (rawItems.length === 0) continue;

      let decryptedMap = {};
      if (cfg.needsDecrypt) {
        const encUrls = rawItems.filter(i => !i.url.startsWith('http')).map(i => i.url);
        if (encUrls.length > 0) {
          try {
            const decRes = await fetch('https://gugeso.com/api/other/decrypt_urls', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Referer': 'https://gugeso.com/',
                'User-Agent': BROWSER_UA
              },
              body: JSON.stringify({ urls: encUrls })
            });
            const decJson = await decRes.json();
            if (decJson.data?.urls) {
              encUrls.forEach((enc, idx) => {
                decryptedMap[enc] = decJson.data.urls[idx];
              });
            }
          } catch {}
        }
      }

      const list = [];
      for (const item of rawItems) {
        const finalUrl = item.url.startsWith('http') ? item.url : decryptedMap[item.url];
        if (finalUrl && finalUrl.includes(cfg.shareHostMatch)) {
          const m = finalUrl.match(cfg.shareRegex);
          if (m) {
            list.push({ title: item.title, url: finalUrl, pwd_id: m[1] });
          }
        }
      }

      if (list.length > 0) {
        const filtered = list.filter(item => !/(短剧|小说|电子书|网文|有声书|广播剧|合辑|总链)/i.test(item.title || ''));
        const resList = filtered.length > 0 ? filtered : list;
        if (q !== rawTitle) {
          console.log(`  💡 [${cfg.label}] 采用优化关键词《${q}》匹配到 ${resList.length} 个公开分享`);
        }
        return resList;
      }
    } catch {}
  }
  return [];
}

const isDirEntry = f => f.dir === true || f.file_type === 0 || f.file_type === 'dir';
const isVideoEntry = f => !isDirEntry(f) && /\.(mp4|mkv|ts|mov|avi|flv|wmv|m3u8|iso)$/i.test(f.file_name || '');

/**
 * 2. 统一分享质检
 */
export async function inspectDriveShare(driveType, pwdId) {
  const cfg = getDriveConfig(driveType);
  try {
    const tokenRes = await driveFetch(driveType, '/share/sharepage/token', {
      method: 'POST',
      withCookie: driveType === 'quark',
      body: JSON.stringify({ pwd_id: pwdId, passcode: '' })
    });
    const tData = await tokenRes.json();
    if (tData.code !== 0 || !tData.data?.stoken) {
      return { pass: false, reason: `链接失效或无stoken (${tData.message || 'error'})` };
    }
    const stoken = tData.data.stoken;

    const detailRes = await driveFetch(
      driveType,
      `/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=0&force=0&_page=1&_size=50`,
      { withCookie: driveType === 'quark' }
    );
    const dData = await detailRes.json();
    const list = dData.data?.list || [];
    if (list.length === 0) return { pass: false, reason: '分享列表为空' };

    const validDir = f => isDirEntry(f) && !/(txt|小说|电子书|网文)/i.test(f.file_name || '');
    const hasVideoOrDir = list.some(f => validDir(f) || isVideoEntry(f));
    if (!hasVideoOrDir) return { pass: false, reason: '无有效视频或目录(过滤纯文本/空目录)' };

    const allZipOrExe = list.every(f => /\.(zip|rar|7z|tar|gz|exe|apk|txt|doc|pdf)$/i.test(f.file_name || ''));
    if (allZipOrExe) return { pass: false, reason: '纯压缩包或程序安装包' };

    if (list.length > 50) return { pass: false, reason: `项目数量过多(${list.length})，规避会员等级限制` };

    return {
      pass: true,
      stoken,
      title: tData.data.title,
      list,
      provider: cfg.label
    };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}

/**
 * 2.5 统一容量检测与安全水位
 */
export async function checkDriveCapacity(driveType) {
  const cfg = getDriveConfig(driveType);
  const cookie = getDriveCookie(driveType);
  if (!cookie) return { ok: false, error: `未配置 ${cfg.label} Cookie` };

  try {
    const res = await driveFetch(driveType, '/member');
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
        isFull: free < 15 * 1024 * 1024 * 1024
      };
    }
    return { ok: false, error: data.message || '获取容量失败' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const alertedCapacityProviders = new Set();

export function buildStandardFolderName(title, year) {
  const cleanTitle = (title || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanYear = year ? String(year).trim() : '';
  return cleanYear ? `${cleanTitle}.${cleanYear}.4K.高码率.原盘` : `${cleanTitle}.4K.高码率.原盘`;
}

async function pollDriveTask(driveType, taskId, maxAttempts = 20, intervalMs = 600) {
  if (!taskId) return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const taskRes = await driveFetch(driveType, `/task?task_id=${encodeURIComponent(taskId)}`);
    const taskData = await taskRes.json().catch(() => null);
    if (taskData?.data?.status === 2) return taskData.data;
    if (taskData?.data?.status === 3) {
      throw new Error(taskData.data.message || '网盘异步任务执行失败');
    }
  }
  return null;
}

async function createDriveFolder(driveType, pdirFid, folderName) {
  const res = await driveFetch(driveType, '/file', {
    method: 'POST',
    body: JSON.stringify({
      pdir_fid: pdirFid,
      file_name: folderName,
      dir_path: '',
      dir_init_lock: false
    })
  });
  const data = await res.json();
  if (data.code !== 0 && data.status !== 200) {
    throw new Error(`创建目录失败: ${data.message || ''}`);
  }
  let fid = data.data?.fid;
  if (!fid) {
    await new Promise(r => setTimeout(r, 800));
    const list = await getDriveFolderFiles(driveType, pdirFid);
    const created = list.find(f => isDirEntry(f) && f.file_name === folderName);
    fid = created?.fid;
  }
  if (!fid) throw new Error(`未能定位新建目录: ${folderName}`);
  return fid;
}

async function renameDriveItem(driveType, fid, newName) {
  const res = await driveFetch(driveType, '/file/rename', {
    method: 'POST',
    body: JSON.stringify({ fid, file_name: newName })
  });
  const data = await res.json().catch(() => null);
  if (data && data.code !== 0 && data.status !== 200) {
    console.warn(`  ⚠️ 重命名提示: ${data.message || data.code}`);
  }
}

/**
 * 3. 统一转存 -> 改名或包裹成规范文件夹 -> 创建永久分享
 *    - 仅面向各网盘的 movie-site 目录 (cfg.targetFolderFid)
 *    - 若分享根下是单个文件夹：直接转存至 movie-site 并重命名为 `${title}.${year}.4K.高码率.原盘`
 *    - 若分享根下是单文件或多文件平铺：先在 movie-site 下新建规范文件夹，再把分享内容转存进该文件夹
 */
export async function saveAndShareDrive(driveType, { title, year = '', pwdId, stoken, list }) {
  const cfg = getDriveConfig(driveType);

  const transferSettings = await getTransferSettings().catch(() => null);
  if (transferSettings && transferSettings[driveType] === false) {
    console.log(`  ℹ️ [后台控制跳过] 管理员已在后台关闭【${cfg.label}转存】，跳过《${title}》的转存与容量检查`);
    return null;
  }

  const cookie = getDriveCookie(driveType);
  if (!cookie) {
    console.error(`未配置 ${cfg.label} Cookie，无法执行转存`);
    return null;
  }

  const cap = await checkDriveCapacity(driveType);
  if (cap.ok && cap.isFull) {
    console.warn(`  🚨 [${cfg.label}容量不足熔断] 剩余空间仅 ${cap.freeGb} GB (< 15GB)，已暂停转存以防假绑定死链`);
    if (!alertedCapacityProviders.has(driveType)) {
      alertedCapacityProviders.add(driveType);
      await sendDingTalkCapacityAlert({
        usedTb: cap.usedTb,
        totalTb: cap.totalTb,
        freeGb: cap.freeGb,
        provider: cfg.alertProvider
      });
    }
    return null;
  }

  const standardName = buildStandardFolderName(title, year);
  const singleRootDir = list.length === 1 && isDirEntry(list[0]);

  let targetFid = null;

  if (singleRootDir) {
    // 情况 A：原分享是单个文件夹 -> 转存进 movie-site 后直接改名
    const rootItem = list[0];
    const saveRes = await driveFetch(driveType, '/share/sharepage/save', {
      method: 'POST',
      body: JSON.stringify({
        pwd_id: pwdId,
        stoken,
        fid_list: [rootItem.fid],
        fid_token_list: [rootItem.share_fid_token || ''],
        to_pdir_fid: cfg.targetFolderFid
      })
    });
    const sData = await saveRes.json();
    if (sData.code !== 0 && sData.status !== 200) {
      console.log(`  ✗ [${cfg.label}] 转存被拒绝: ${sData.message}`);
      return null;
    }

    let topFids = sData.data?.task_resp?.data?.save_as?.save_as_top_fids || [];
    if (sData.data?.task_id) {
      const taskData = await pollDriveTask(driveType, sData.data.task_id);
      if (taskData) {
        topFids = taskData.save_as?.save_as_top_fids || taskData.save_as?.save_as_select_top_fids || topFids;
      }
    }

    targetFid = topFids?.[0] || null;
    if (!targetFid) {
      await new Promise(r => setTimeout(r, 2000));
      const folderFiles = await getDriveFolderFiles(driveType, cfg.targetFolderFid, 20);
      const savedItem = folderFiles.find(f => f.file_name === rootItem.file_name);
      targetFid = savedItem?.fid || null;
    }

    if (!targetFid) {
      console.log(`  ✗ [${cfg.label}] 未能在 movie-site 目录定位到新转存的目录: ${rootItem.file_name}`);
      return null;
    }

    // 校验非空目录，防止转存空壳文件夹
    await new Promise(r => setTimeout(r, 1000));
    const innerFiles = await getDriveFolderFiles(driveType, targetFid, 5);
    if (innerFiles.length === 0) {
      console.log(`  ✗ [${cfg.label}] 转存项为空目录 (0 文件)，清理空壳并判定失败`);
      await deleteDriveFiles(driveType, [targetFid]);
      return null;
    }

    await renameDriveItem(driveType, targetFid, standardName);
  } else {
    // 情况 B：单文件或平铺多个文件/目录 -> 先在 movie-site 下新建规范目录包裹，再转存进去
    const wrapperFid = await createDriveFolder(driveType, cfg.targetFolderFid, standardName);
    const saveRes = await driveFetch(driveType, '/share/sharepage/save', {
      method: 'POST',
      body: JSON.stringify({
        pwd_id: pwdId,
        stoken,
        fid_list: list.map(f => f.fid),
        fid_token_list: list.map(f => f.share_fid_token || ''),
        to_pdir_fid: wrapperFid
      })
    });
    const sData = await saveRes.json();
    if (sData.code !== 0 && sData.status !== 200) {
      console.log(`  ✗ [${cfg.label}] 转存被拒绝: ${sData.message}`);
      await deleteDriveFiles(driveType, [wrapperFid]);
      return null;
    }

    if (sData.data?.task_id) {
      await pollDriveTask(driveType, sData.data.task_id);
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }

    const innerFiles = await getDriveFolderFiles(driveType, wrapperFid, 5);
    if (innerFiles.length === 0) {
      console.log(`  ✗ [${cfg.label}] 包裹目录内无文件，清理空目录并判定失败`);
      await deleteDriveFiles(driveType, [wrapperFid]);
      return null;
    }

    targetFid = wrapperFid;
  }

  // 创建永久无密码分享
  const shareRes = await driveFetch(driveType, '/share', {
    method: 'POST',
    body: JSON.stringify({
      fid_list: [targetFid],
      title: standardName,
      url_type: 1,
      expired_type: 1,
      passcode: ''
    })
  });
  const shareData = await shareRes.json();
  if (shareData.code !== 0 && shareData.status !== 200) {
    console.log(`  ✗ [${cfg.label}] 创建分享被拒: ${shareData.message}`);
    return null;
  }

  if (shareData.data?.task_id) {
    await pollDriveTask(driveType, shareData.data.task_id, 15, 500);
  } else {
    await new Promise(r => setTimeout(r, 1200));
  }

  const myRes = await driveFetch(driveType, '/share/mypage/detail?_page=1&_size=10');
  const myData = await myRes.json();
  const share = (myData.data?.list || []).find(
    s => s.first_fid === targetFid || s.first_file?.fid === targetFid || s.title === standardName
  );
  if (!share || !share.share_url) {
    console.log(`  ✗ [${cfg.label}] 未能获取到新生成的专属分享链接`);
    return null;
  }

  return {
    shareUrl: share.share_url,
    fid: targetFid,
    pwdId: share.share_id,
    title: standardName
  };
}

/**
 * 获取指定目录下的文件列表（按更新时间倒序）
 */
export async function getDriveFolderFiles(driveType, pdirFid, size = 100, page = 1) {
  const cookie = getDriveCookie(driveType);
  if (!cookie) return [];
  try {
    const res = await driveFetch(
      driveType,
      `/file/sort?pdir_fid=${pdirFid}&_page=${page}&_size=${size}&_sort=file_type:asc,updated_at:desc`
    );
    const data = await res.json();
    return data.data?.list || [];
  } catch {
    return [];
  }
}

/**
 * 只读取各网盘 movie-site 文件夹下的全部资源项（自动翻页）
 */
export async function listDriveMovieSiteFiles(driveType) {
  const cfg = getDriveConfig(driveType);
  const all = [];
  let page = 1;
  while (true) {
    const batch = await getDriveFolderFiles(driveType, cfg.targetFolderFid, 100, page);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

/**
 * 增量追更：将新单集直接存入已有目录
 */
export async function saveFilesToExistingDriveFolder(driveType, pdirFid, pwdId, stoken, fileItems) {
  const cookie = getDriveCookie(driveType);
  if (!cookie || !fileItems || fileItems.length === 0) return { ok: false, count: 0 };
  try {
    const saveRes = await driveFetch(driveType, '/share/sharepage/save', {
      method: 'POST',
      body: JSON.stringify({
        pwd_id: pwdId,
        stoken,
        fid_list: fileItems.map(f => f.fid),
        fid_token_list: fileItems.map(f => f.share_fid_token || ''),
        to_pdir_fid: pdirFid
      })
    });
    const sData = await saveRes.json();
    if (sData.data?.task_id) {
      await pollDriveTask(driveType, sData.data.task_id);
    }
    const ok = sData.code === 0 || sData.status === 200;
    return { ok, count: ok ? fileItems.length : 0, message: sData.message };
  } catch (err) {
    return { ok: false, count: 0, error: err.message };
  }
}

/**
 * 物理删除网盘文件/文件夹
 */
export async function deleteDriveFiles(driveType, filelist = []) {
  const cookie = getDriveCookie(driveType);
  if (!cookie || !filelist || filelist.length === 0) return { ok: true };
  try {
    const body = driveType === 'quark' ? { filelist, action_type: 2 } : { filelist };
    const res = await driveFetch(driveType, '/file/delete', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: data.code === 0 || data.status === 200, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 取消/删除网盘个人分享
 */
export async function deleteDriveShares(driveType, shareIds = []) {
  const cookie = getDriveCookie(driveType);
  if (!cookie || !shareIds || shareIds.length === 0) return { ok: true };
  try {
    const res = await driveFetch(driveType, '/share/delete', {
      method: 'POST',
      body: JSON.stringify({ share_id_list: shareIds })
    });
    const data = await res.json();
    return { ok: data.code === 0 || data.status === 200, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 深度统计分享中的视频集数（支持最多 2 层嵌套子目录）
 */
export async function countDriveVideosDetailed(driveType, pwdId) {
  try {
    const inspect = await inspectDriveShare(driveType, pwdId);
    if (!inspect.pass || !inspect.stoken) {
      return { ok: false, count: 0, reason: inspect.reason };
    }

    let totalVideos = 0;
    for (const it of inspect.list || []) {
      if (isVideoEntry(it)) {
        totalVideos++;
      } else if (isDirEntry(it)) {
        const res1 = await driveFetch(
          driveType,
          `/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(inspect.stoken)}&pdir_fid=${it.fid}&force=0&_page=1&_size=100`,
          { withCookie: driveType === 'quark' }
        );
        const d1 = await res1.json();
        const l1 = d1.data?.list || [];

        for (const sub of l1) {
          if (isVideoEntry(sub)) {
            totalVideos++;
          } else if (isDirEntry(sub)) {
            const res2 = await driveFetch(
              driveType,
              `/share/sharepage/detail?pwd_id=${pwdId}&stoken=${encodeURIComponent(inspect.stoken)}&pdir_fid=${sub.fid}&force=0&_page=1&_size=100`,
              { withCookie: driveType === 'quark' }
            );
            const d2 = await res2.json();
            for (const sub2 of d2.data?.list || []) {
              if (isVideoEntry(sub2)) totalVideos++;
            }
          }
        }
      }
    }
    return { ok: true, count: totalVideos, inspect };
  } catch (err) {
    return { ok: false, count: 0, error: err.message };
  }
}

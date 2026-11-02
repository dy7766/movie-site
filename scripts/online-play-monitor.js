import { getDbPool } from '../src/lib/db.js';

const CMS_APIS = [
  'https://api.ffzyapi.com/api.php/provide/vod/?ac=detail&wd=',    // 非凡
  'https://api.guangsuapi.com/api.php/provide/vod/?ac=detail&wd=', // 光速
  'https://api.lzzyapi.com/api.php/provide/vod/?ac=detail&wd='     // 量子
];

// 1. 快速探活 M3U8 链接 (超时 4 秒)
export async function isStreamAlive(url) {
  if (!url || !url.startsWith('http')) return false;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': 'bytes=0-1024'
      },
      signal: AbortSignal.timeout(4000)
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

// 2. 解析 CMS 接口返回数据
function parseVodSources(item) {
  if (!item || !item.vod_play_from || !item.vod_play_url) return null;
  const froms = item.vod_play_from.split('$$$');
  const urlGroups = item.vod_play_url.split('$$$');

  const sources = [];
  for (let i = 0; i < froms.length; i++) {
    const fromName = froms[i];
    const groupText = urlGroups[i] || '';
    const epPairs = groupText.split('#').map(p => {
      const parts = p.split('$');
      return {
        name: parts[0]?.trim() || '播放',
        url: parts[1]?.trim() || parts[0]?.trim()
      };
    }).filter(ep => ep.url && ep.url.startsWith('http'));

    if (epPairs.length > 0) {
      const isM3u8 = fromName.toLowerCase().includes('m3u8') || epPairs[0].url.includes('.m3u8');
      sources.push({
        source: isM3u8 ? '极速秒播 (M3U8)' : '备用播放',
        type: isM3u8 ? 'm3u8' : 'embed',
        episodes: epPairs
      });
    }
  }

  const preferred = sources.find(s => s.type === 'm3u8') || sources[0];
  if (!preferred || preferred.episodes.length === 0) return null;

  return {
    primaryUrl: preferred.episodes[0].url,
    sources
  };
}

// 3. 从多个 CMS 检索优质播放源
export async function searchCmsStream(title, year = null) {
  const cleanTitle = title.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').trim();

  for (const api of CMS_APIS) {
    try {
      const res = await fetch(api + encodeURIComponent(cleanTitle), {
        signal: AbortSignal.timeout(4000)
      });
      const data = await res.json();
      const list = data.list || [];
      if (list.length === 0) continue;

      const matched = list.find(it => {
        const nameMatch = it.vod_name.trim() === cleanTitle || it.vod_name.includes(cleanTitle);
        if (!nameMatch) return false;
        if (year && it.vod_year) {
          return Math.abs(parseInt(it.vod_year) - year) <= 1;
        }
        return true;
      }) || list[0];

      const parsed = parseVodSources(matched);
      if (parsed && parsed.primaryUrl) {
        const alive = await isStreamAlive(parsed.primaryUrl);
        if (alive) {
          return parsed;
        }
      }
    } catch {}
  }
  return null;
}

// 4. 定时执行：探活巡检与老片自动补齐
export async function runOnlineStreamAudit() {
  const p = getDbPool();
  console.log('\n--- 📺 开始执行在线播放源巡检与自愈流水线 ---');

  const stats = {
    checked: 0,
    healed: 0,
    deadCleared: 0,
    backfilled: 0
  };

  // 任务 A: 巡检现有已挂载在线看的影片
  const existingRes = await p.query(`
    SELECT id, title, year, online_play_url 
    FROM resources 
    WHERE online_play_url IS NOT NULL 
    ORDER BY RANDOM() LIMIT 20
  `);
  console.log(`[巡检] 抽取 ${existingRes.rows.length} 部已有在线看的影视进行切片流连通性测试...`);

  for (const m of existingRes.rows) {
    stats.checked++;
    const alive = await isStreamAlive(m.online_play_url);
    if (!alive) {
      console.log(`⚠️ 发现失效死链: 《${m.title}》 -> 尝试从备用资源站自愈检索...`);
      const newStream = await searchCmsStream(m.title, m.year);
      if (newStream) {
        await p.query('UPDATE resources SET online_play_url = $1, play_sources = $2 WHERE id = $3', [
          newStream.primaryUrl, JSON.stringify(newStream.sources), m.id
        ]);
        stats.healed++;
        console.log(`  ✓ 自愈成功！已为《${m.title}》替换最新可用切片流`);
      } else {
        stats.deadCleared++;
        console.log(`  ✗ 各资源站暂无新源，临时挂起该死链`);
      }
    }
  }

  // 任务 B: 对在库/上映超过半年的影视（或 pre-2026），若缺少在线播放源，自动补齐
  const backfillRes = await p.query(`
    SELECT id, title, year, category 
    FROM resources 
    WHERE online_play_url IS NULL 
      AND (year < 2026 OR created_at < NOW() - INTERVAL '180 days')
      AND title NOT IN ('十间敢死队', '夜王', '空枪')
    ORDER BY year DESC LIMIT 10
  `);
  console.log(`\n[补齐] 发现 ${backfillRes.rows.length} 部半年以上老片暂无在线播放，自动尝试补充...`);

  for (const m of backfillRes.rows) {
    const stream = await searchCmsStream(m.title, m.year);
    if (stream) {
      await p.query('UPDATE resources SET online_play_url = $1, play_sources = $2 WHERE id = $3', [
        stream.primaryUrl, JSON.stringify(stream.sources), m.id
      ]);
      stats.backfilled++;
      console.log(`  ✓ 成功补齐！《${m.title}》已上线极速免广告在线播放源`);
    } else {
      console.log(`  - 暂未在资源站找到《${m.title}》的高清切片源`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n--- 📺 在线播放源运营大盘总结 ---`);
  console.log(`探活抽检: ${stats.checked} 部 | 自愈修复: ${stats.healed} 部 | 沉淀老片新补齐: ${stats.backfilled} 部`);
  console.log('------------------------------------\n');

  return stats;
}

if (process.argv[1]?.endsWith('online-play-monitor.js')) {
  runOnlineStreamAudit().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

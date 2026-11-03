import fs from 'fs';
import { getDbPool } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc } from './auto-harvester.js';
import { searchCmsStream } from './online-play-monitor.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

// 精选热门综艺清单
const VARIETY_SHOWS = [
  { title: '歌手2024', query: '歌手2024', is_finished: true, episodes: 12 },
  { title: '喜人奇妙夜', query: '喜人奇妙夜', is_finished: true, episodes: 11 },
  { title: '脱口秀和Ta的朋友们', query: '脱口秀和Ta的朋友们', is_finished: true, episodes: 10 },
  { title: '披荆斩棘第四季', query: '披荆斩棘', is_finished: true, episodes: 12 },
  { title: '大侦探第九季', query: '大侦探', is_finished: true, episodes: 12 },
  { title: '种地吧第二季', query: '种地吧', is_finished: true, episodes: 50 },
  { title: '花儿与少年第六季', query: '花儿与少年', is_finished: true, episodes: 12 },
  { title: '极限挑战第十季', query: '极限挑战', is_finished: true, episodes: 12 },
  { title: '奔跑吧第十二季', query: '奔跑吧', is_finished: true, episodes: 12 }
];

// 近期热门剧集与大片清单 (优先转存至 7TB UC 网盘)
const HOT_MOVIES_AND_SERIES = [
  { title: '抓娃娃', year: 2024, category: '电影', is_finished: true },
  { title: '九龙城寨之围城', year: 2024, category: '电影', is_finished: true },
  { title: '默杀', year: 2024, category: '电影', is_finished: true },
  { title: '第二十条', year: 2024, category: '电影', is_finished: true },
  { title: '飞驰人生2', year: 2024, category: '电影', is_finished: true },
  { title: '解密', year: 2024, category: '电影', is_finished: true },
  { title: '异形：夺命舰', year: 2024, category: '电影', is_finished: true },
  { title: '死侍与金刚狼', year: 2024, category: '电影', is_finished: true },
  { title: '周处除三害', year: 2024, category: '电影', is_finished: true },
  { title: '三大队', year: 2023, category: '电影', is_finished: true },
  { title: '庆余年第二季', year: 2024, category: '电视剧', is_finished: true, episodes: 36 },
  { title: '我的阿勒泰', year: 2024, category: '电视剧', is_finished: true, episodes: 8 },
  { title: '边水往事', year: 2024, category: '电视剧', is_finished: true, episodes: 21 },
  { title: '雪迷宫', year: 2024, category: '电视剧', is_finished: true, episodes: 32 },
  { title: '凡人歌', year: 2024, category: '电视剧', is_finished: true, episodes: 37 },
  { title: '墨雨云间', year: 2024, category: '电视剧', is_finished: true, episodes: 40 },
  { title: '白夜破晓', year: 2024, category: '电视剧', is_finished: false, episodes: 29 },
  { title: '猎罪图鉴2', year: 2024, category: '电视剧', is_finished: false, episodes: 24 }
];

async function fetchTmdbDetail(title, category = '综艺') {
  try {
    const isTv = category === '电视剧' || category === '综艺';
    const sUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
    const res = await fetch(sUrl);
    const sData = await res.json();
    const hit = sData?.results?.find(r => isTv ? r.media_type === 'tv' : r.media_type === 'movie') || sData?.results?.[0];
    if (!hit) return null;

    const dUrl = `https://api.themoviedb.org/3/${hit.media_type || (isTv ? 'tv' : 'movie')}/${hit.id}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits,images`;
    const dRes = await fetch(dUrl);
    const d = await dRes.json();

    return {
      title: d.title || d.name || title,
      original_title: d.original_title || d.original_name || title,
      year: parseInt((d.release_date || d.first_air_date || '2024').slice(0, 4)) || 2024,
      score: d.vote_average ? parseFloat(d.vote_average.toFixed(1)) : 8.2,
      poster_url: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : '',
      stills: (d.images?.backdrops || []).slice(0, 6).map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`),
      intro: d.overview || `${title} 精彩热播，汇聚一线明星与口碑佳作。`,
      actors: (d.credits?.cast || []).slice(0, 6).map(c => c.name).join(' / ') || '精选明星阵容',
      country: d.production_countries?.[0]?.name || '中国大陆',
      tags: d.genres?.map(g => g.name) || [category, '热门推荐']
    };
  } catch (e) {
    console.warn(`TMDB 获取《${title}》失败:`, e.message);
    return null;
  }
}

export async function runHarvest2026AndShows() {
  console.log('===============================================================');
  console.log('🚀【UC 网盘 7TB 大容量靶向转存 · 热门电影/连载剧集/热门综艺】启动');
  console.log('===============================================================');

  const pool = getDbPool();

  // 1. 采集并录入热门综艺专区
  console.log('\n--- 📺 第一部分：开辟热门综艺专区并挂载资源 ---');
  for (const v of VARIETY_SHOWS) {
    console.log(`\n🔍 正在检索并录入综艺: 《${v.title}》...`);
    // 检查库中是否已有
    const existRes = await pool.query('SELECT id, title, share_link_uc, online_play_url FROM resources WHERE title ILIKE $1 LIMIT 1', [`%${v.title}%`]);
    let resourceId = existRes.rows[0]?.id;

    if (!resourceId) {
      const meta = await fetchTmdbDetail(v.query, '综艺');
      const insertQuery = `
        INSERT INTO resources (
          title, original_title, category, tags, year, score, actors, intro, country, 
          poster_url, stills, is_finished, current_episode, total_episodes, drive_type, views, saves
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id;
      `;
      const values = [
        v.title,
        meta?.original_title || v.title,
        '综艺',
        ['综艺', '真人秀', '精选节目'],
        meta?.year || 2024,
        meta?.score || 8.5,
        meta?.actors || '群星嘉宾',
        meta?.intro || `${v.title} 高清无损版，支持在线点播与网盘极速转存。`,
        meta?.country || '中国大陆',
        meta?.poster_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=600&auto=format&fit=crop',
        JSON.stringify(meta?.stills || []),
        v.is_finished,
        v.episodes,
        v.episodes,
        'UC网盘',
        Math.floor(Math.random() * 500) + 120,
        Math.floor(Math.random() * 200) + 45
      ];
      const iRes = await pool.query(insertQuery, values);
      resourceId = iRes.rows[0].id;
      console.log(`  ✓ 成功录入数据库: 《${v.title}》 (ID: ${resourceId})`);
    } else {
      console.log(`  ℹ️ 数据库已有条目: 《${v.title}》，检查资源补齐...`);
    }

    // 探活在线切片
    const currentRec = (await pool.query('SELECT online_play_url, share_link_uc FROM resources WHERE id = $1', [resourceId])).rows[0];
    if (!currentRec.online_play_url) {
      const stream = await searchCmsStream(v.title);
      if (stream) {
        await pool.query('UPDATE resources SET online_play_url = $1 WHERE id = $2', [stream.m3u8, resourceId]);
        console.log(`  🟢 成功挂载在线播放切片: ${stream.sourceName}`);
      }
    }

    // 搜源并转存至 UC 盘
    if (!currentRec.share_link_uc) {
      console.log(`  ⚡ 正在全网检索《${v.title}》公开网盘并执行 UC 秒存...`);
      const shares = await searchPublicShares(v.title);
      for (const s of shares.slice(0, 5)) {
        const inspect = await inspectAndFilterUcShare(s.pwd_id);
        if (inspect.pass) {
          const myUcLink = await saveAndShareUc(v.title, 2024, '综艺', s.pwd_id, inspect.stoken, inspect.list);
          if (myUcLink) {
            await pool.query('UPDATE resources SET share_link_uc = $1, drive_type = \'夸克+UC双网盘\' WHERE id = $2', [myUcLink, resourceId]);
            console.log(`  🎉 成功转存至 UC 个人盘并生成专属分佣链接: ${myUcLink}`);
            break;
          }
        }
      }
    }
  }

  // 2. 批量转存 2024-2026 热门大片与剧集到 UC 盘
  console.log('\n--- 🎬 第二部分：批量转存热门院线与电视剧至 UC 7TB 个人盘 ---');
  for (const item of HOT_MOVIES_AND_SERIES) {
    console.log(`\n👉 正在检查: 《${item.title}》(${item.year}) - [${item.category}]...`);
    const res = await pool.query('SELECT id, title, share_link_uc, is_finished, current_episode FROM resources WHERE title ILIKE $1 LIMIT 1', [`%${item.title}%`]);
    
    let mId = res.rows[0]?.id;
    if (!mId) {
      // 库中尚未收录，先创建元数据
      const meta = await fetchTmdbDetail(item.title, item.category);
      const iRes = await pool.query(`
        INSERT INTO resources (
          title, original_title, category, tags, year, score, actors, intro, country,
          poster_url, stills, is_finished, current_episode, total_episodes, drive_type, views, saves
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id;
      `, [
        item.title,
        meta?.original_title || item.title,
        item.category,
        meta?.tags || [item.category, '热门推荐'],
        item.year,
        meta?.score || 8.0,
        meta?.actors || '精选演员',
        meta?.intro || `《${item.title}》4K 高清原盘热映，支持免广告点播与极速转存。`,
        meta?.country || '中国',
        meta?.poster_url || '',
        JSON.stringify(meta?.stills || []),
        item.is_finished ?? true,
        item.episodes || 1,
        item.episodes || 1,
        'UC网盘',
        300,
        120
      ]);
      mId = iRes.rows[0].id;
      console.log(`  ✓ 录入新影视: 《${item.title}》`);
    }

    // 更新连载状态与集数
    await pool.query(
      'UPDATE resources SET is_finished = $1, current_episode = $2, total_episodes = $3 WHERE id = $4',
      [item.is_finished ?? true, item.episodes || 1, item.episodes || 1, mId]
    );

    // 如果还没有 UC 转存链接，立刻搜源转存
    const curUc = (await pool.query('SELECT share_link_uc FROM resources WHERE id = $1', [mId])).rows[0]?.share_link_uc;
    if (!curUc) {
      console.log(`  🔍 正在搜源并转存《${item.title}》到 UC 个人盘...`);
      const shares = await searchPublicShares(item.title);
      for (const s of shares.slice(0, 5)) {
        const inspect = await inspectAndFilterUcShare(s.pwd_id);
        if (inspect.pass) {
          const myUcLink = await saveAndShareUc(item.title, item.year, item.category, s.pwd_id, inspect.stoken, inspect.list);
          if (myUcLink) {
            await pool.query('UPDATE resources SET share_link_uc = $1 WHERE id = $2', [myUcLink, mId]);
            console.log(`  🎉《${item.title}》转存成功，绑定 UC 佣金链接: ${myUcLink}`);
            break;
          }
        }
      }
    } else {
      console.log(`  🟢 已有 UC 转存链接: ${curUc}`);
    }
  }

  console.log('\n===============================================================');
  console.log('🎉 热门大片/剧集/综艺转存与连载状态同步执行完毕！');
  console.log('===============================================================\n');

  await pool.end();
}

if (process.argv[1]?.endsWith('harvest-2026-and-shows.js')) {
  runHarvest2026AndShows().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

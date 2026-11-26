import { getDbPool } from '../src/lib/db.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 获取并持久化抓取状态至 Supabase system_settings
async function getCrawlState(pool) {
  try {
    const res = await pool.query("SELECT value FROM system_settings WHERE key = 'douban_crawl_state'");
    if (res.rows.length > 0 && res.rows[0].value) {
      return res.rows[0].value;
    }
  } catch (err) {
    console.warn('⚠️ 读取抓取状态异常:', err.message);
  }
  return { consecutive_zero_yield: 0, deep_offset: 20 };
}

async function saveCrawlState(pool, state) {
  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('douban_crawl_state', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(state)]
    );
  } catch (err) {
    console.warn('⚠️ 保存抓取状态异常:', err.message);
  }
}

/**
 * 模块一：豆瓣热门种子采集器（只专注获取本地库里没有的优质影视种子）
 * 涵盖：豆瓣实时热门电影、热门国产剧、热门美剧/韩剧、热门综艺
 * 智能探取逻辑：
 * 1. 始终优先抓取实时【最新/热门】第 0 页，保证第一时间捕获全网最新影视动态；
 * 2. 若连续 2 次及以上无法获取到新种子（库中已饱和），则自动触发【深度下探模式】，拓展分页偏移量与经典高分题材，探取更早年份的优质影视资源。
 */
export async function fetchDoubanHotSeeds({ movieLimit = 30, tvLimit = 30 } = {}) {
  console.log('===============================================================');
  console.log('🎬【模块一 · 豆瓣热门电影与热播剧集种子采集启动】');
  console.log('===============================================================');

  const pool = getDbPool();
  const candidates = [];
  const snapshotMaps = {
    hot: { movie: new Map(), tv: new Map(), variety: new Map(), anime: new Map() },
    latest: { movie: new Map(), tv: new Map(), variety: new Map(), anime: new Map() }
  };

  const state = await getCrawlState(pool);
  const zeroYieldStreak = state.consecutive_zero_yield || 0;
  const deepOffset = state.deep_offset || 20;

  console.log(`📊 历史抓取追踪: 连续零新增次数=${zeroYieldStreak} | 下探基准深度=${deepOffset}`);

  // 1. 基准保障：抓取前多页最新/热门数据，确保第一时间捕捉全网最新上映/开播的影视
  const targets = [
    { type: 'movie', tag: '最新', sort: 'recommend', category: '电影', limit: 25, page_start: 0, snap: ['latest', 'movie'] },
    { type: 'movie', tag: '最新', sort: 'recommend', category: '电影', limit: 25, page_start: 25, snap: ['latest', 'movie'] },
    { type: 'movie', tag: '热门', sort: 'recommend', category: '电影', limit: movieLimit, page_start: 0, snap: ['hot', 'movie'] },
    { type: 'movie', tag: '热门', sort: 'recommend', category: '电影', limit: movieLimit, page_start: 25, snap: ['hot', 'movie'] },
    { type: 'tv', tag: '热门', sort: 'recommend', category: '电视剧', limit: tvLimit, page_start: 0, snap: ['hot', 'tv'] },
    { type: 'tv', tag: '热门', sort: 'recommend', category: '电视剧', limit: tvLimit, page_start: 25, snap: ['hot', 'tv'] },
    { type: 'tv', tag: '热门', sort: 'time', category: '电视剧', limit: 25, page_start: 0, snap: ['latest', 'tv'] },
    { type: 'tv', tag: '热门', sort: 'time', category: '电视剧', limit: 25, page_start: 25, snap: ['latest', 'tv'] },
    { type: 'tv', tag: '国产剧', category: '电视剧', limit: 25, page_start: 0 },
    { type: 'tv', tag: '国产剧', category: '电视剧', limit: 25, page_start: 25 },
    { type: 'tv', tag: '国产剧', category: '电视剧', limit: 25, page_start: 50 },
    { type: 'tv', tag: '综艺', sort: 'recommend', category: '综艺', limit: 25, page_start: 0, snap: ['hot', 'variety'] },
    { type: 'tv', tag: '综艺', sort: 'recommend', category: '综艺', limit: 25, page_start: 25, snap: ['hot', 'variety'] },
    { type: 'tv', tag: '综艺', sort: 'time', category: '综艺', limit: 25, page_start: 0, snap: ['latest', 'variety'] },
    { type: 'tv', tag: '综艺', sort: 'time', category: '综艺', limit: 25, page_start: 25, snap: ['latest', 'variety'] },
    { type: 'tv', tag: '日本动画', sort: 'recommend', category: '动漫', limit: 25, page_start: 0, snap: ['hot', 'anime'] },
    { type: 'tv', tag: '日本动画', sort: 'recommend', category: '动漫', limit: 25, page_start: 25, snap: ['hot', 'anime'] },
    { type: 'tv', tag: '日本动画', sort: 'time', category: '动漫', limit: 25, page_start: 0, snap: ['latest', 'anime'] },
    { type: 'tv', tag: '日本动画', sort: 'time', category: '动漫', limit: 25, page_start: 25, snap: ['latest', 'anime'] }
  ];

  // 2. 连续 2 次以上未抓取到新内容 -> 触发深度下探模式 (获取更早年份、经典佳作与长尾内容)
  const isDeepCrawl = zeroYieldStreak >= 2;
  if (isDeepCrawl) {
    console.log(`🌊【触发深度下探模式】已连续 ${zeroYieldStreak} 次无新种子，正在往下探取更早与经典高分影视 (分页偏移量: ${deepOffset})...`);
    targets.push(
      // 下探热门与国产剧更早的分页偏移
      { type: 'movie', tag: '热门', category: '电影', limit: 25, page_start: deepOffset },
      { type: 'tv', tag: '热门', category: '电视剧', limit: 25, page_start: deepOffset },
      { type: 'tv', tag: '国产剧', category: '电视剧', limit: 20, page_start: deepOffset },
      // 探取更早年份的经典口碑佳作与海外剧集
      { type: 'movie', tag: '经典', category: '电影', limit: 20, page_start: Math.max(0, deepOffset - 20) },
      { type: 'movie', tag: '冷门佳片', category: '电影', limit: 20, page_start: Math.max(0, deepOffset - 20) },
      { type: 'tv', tag: '经典', category: '电视剧', limit: 20, page_start: 0 },
      { type: 'tv', tag: '美剧', category: '电视剧', limit: 20, page_start: 0 },
      { type: 'tv', tag: '日本动画', category: '动漫', limit: 20, page_start: 0 }
    );
  }

  for (const t of targets) {
    const pageStart = t.page_start || 0;
    const pageLabel = pageStart > 0 ? ` [第 ${pageStart / (t.limit || 20) + 1} 页/偏移 ${pageStart}]` : '';
    console.log(`🔍 正在拉取豆瓣 [${t.category} · ${t.tag}]${pageLabel} 榜单...`);
    try {
      const sortParam = t.sort ? `&sort=${t.sort}` : '';
      const url = `https://movie.douban.com/j/search_subjects?type=${t.type}&tag=${encodeURIComponent(t.tag)}${sortParam}&page_limit=${t.limit}&page_start=${pageStart}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://movie.douban.com/explore'
        },
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        const subjects = data.subjects || [];
        console.log(`  ✓ 成功获取 ${subjects.length} 条 [${t.category} · ${t.tag}] 数据`);
        for (const s of subjects) {
          const title = (s.title || '').trim();
          if (!title) continue;
          // 收集四组热门/最新榜单（电影/剧集/综艺/动漫）前 50 快照供 hub-8f92 大盘对照
          if (t.snap) {
            const snapshotMap = snapshotMaps[t.snap[0]]?.[t.snap[1]];
            const snapKey = s.id || title;
            if (snapshotMap && snapshotMap.size < 50 && !snapshotMap.has(snapKey)) {
              snapshotMap.set(snapKey, {
                rank: snapshotMap.size + 1,
                id: s.id || '',
                title,
                rate: s.rate || '',
                url: s.url || '',
                cover: s.cover || '',
                is_new: Boolean(s.is_new)
              });
            }
          }
          const score = s.rate ? parseFloat(s.rate) : 8.0;
          candidates.push({
            title,
            category: t.category,
            score,
            douban_id: s.id || null,
            year: new Date().getFullYear() // 默认近期，后续由 TMDB 精准校正
          });
        }
      } else {
        console.warn(`  ⚠️ 豆瓣接口响应状态码: ${res.status}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 豆瓣接口请求受限或网络波动 (${err.message})`);
    }
  }

  // 2.2 持久化“热门 + 最新（电影/剧集/综艺/动漫 Top 50）”快照至 system_settings，供管理大盘直接对照
  if (snapshotMaps.hot.movie.size > 0 || snapshotMaps.latest.movie.size > 0) {
    try {
      const snapshotPayload = {
        fetchedAt: new Date().toISOString(),
        hot: {
          movie: Array.from(snapshotMaps.hot.movie.values()),
          tv: Array.from(snapshotMaps.hot.tv.values()),
          variety: Array.from(snapshotMaps.hot.variety.values()),
          anime: Array.from(snapshotMaps.hot.anime.values())
        },
        latest: {
          movie: Array.from(snapshotMaps.latest.movie.values()),
          tv: Array.from(snapshotMaps.latest.tv.values()),
          variety: Array.from(snapshotMaps.latest.variety.values()),
          anime: Array.from(snapshotMaps.latest.anime.values())
        }
      };
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('douban_hot_snapshot', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(snapshotPayload)]
      );
      console.log(`📸 已更新大盘豆瓣热门/最新 Top 50 快照 (热门电影 ${snapshotPayload.hot.movie.length} / 最新电影 ${snapshotPayload.latest.movie.length})`);
    } catch (snapErr) {
      console.warn('⚠️ 保存豆瓣热门 Top 50 快照异常:', snapErr.message);
    }
  }

  // 2.5 官方在播剧集与最新热播种子补充 (TMDB On-The-Air & Trending)
  try {
    const tmdbKey = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';
    const tmdbUrls = [
      `https://api.themoviedb.org/3/tv/on_the_air?api_key=${tmdbKey}&language=zh-CN&page=1`,
      `https://api.themoviedb.org/3/trending/tv/day?api_key=${tmdbKey}&language=zh-CN`,
      `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbKey}&language=zh-CN&sort_by=popularity.desc&with_origin_country=CN&air_date.gte=2025-01-01`
    ];
    for (const url of tmdbUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const data = await res.json();
          const items = data.results || [];
          for (const item of items) {
            const title = (item.name || item.title || '').trim();
            if (!title) continue;
            const year = item.first_air_date ? parseInt(item.first_air_date.slice(0, 4)) : new Date().getFullYear();
            const score = item.vote_average ? parseFloat(item.vote_average.toFixed(1)) : 8.0;
            candidates.push({
              title,
              category: '电视剧',
              score,
              douban_id: null,
              year
            });
          }
          console.log(`  ✓ 从 TMDB 在播/热门成功补齐 ${items.length} 部剧集种子`);
        }
      } catch {}
    }
  } catch (tmdbErr) {
    console.warn('  ⚠️ TMDB 在播种子补充异常:', tmdbErr.message);
  }

  // 3. 备用兜底源：WMDB 豆瓣高分与实时口碑榜
  const wmdbSkip = isDeepCrawl ? deepOffset : 0;
  if (candidates.length < 15 || isDeepCrawl) {
    console.log(`🔄 启用备用源 (WMDB 优质榜单) 补充优质种子 (偏移量 skip: ${wmdbSkip})...`);
    try {
      const wmdbRes = await fetch(`https://api.wmdb.tv/api/v1/top?type=Douban&skip=${wmdbSkip}&limit=50`, {
        signal: AbortSignal.timeout(8000)
      });
      if (wmdbRes.ok) {
        const wmdbData = await wmdbRes.json();
        if (Array.isArray(wmdbData)) {
          for (const item of wmdbData) {
            const cnData = item.data?.find(d => d.lang === 'Cn') || item.data?.[0] || {};
            const title = (cnData.name || item.originalName || '').trim();
            if (!title) continue;
            const category = item.type === 'Tv' ? '电视剧' : '电影';
            const year = parseInt(item.year) || 2024;
            const score = item.doubanRating ? parseFloat(item.doubanRating) : 8.5;
            candidates.push({
              title,
              category,
              score,
              douban_id: item.doubanId || null,
              year
            });
          }
          console.log(`  ✓ 从备用源成功汇聚 ${wmdbData.length} 部优质种子`);
        }
      }
    } catch (wmdbErr) {
      console.warn('  ⚠️ 备用榜单拉取异常:', wmdbErr.message);
    }
  }

  // 4. 去重与入库：严格只向数据库写入“本地库中不存在”的条目
  console.log(`\n📊 种子池汇总完毕，共获取 ${candidates.length} 条候选条目，正在比对本地数据库进行去重...`);
  let insertedCount = 0;
  let skippedCount = 0;

  for (const c of candidates) {
    try {
      // 检查库中是否已存在同名影视（精准去重 + 智能前缀/去空格比对，防止字词微小差异导致重复入库）
      const cleanTitle = c.title.replace(/\s+/g, '');
      const altTitle = c.title.startsWith('七') ? c.title.slice(1) : ('七' + c.title);
      const existRes = await pool.query(
        'SELECT id FROM resources WHERE title = $1 OR title = $2 OR REPLACE(title, \' \', \'\') = $3 LIMIT 1',
        [c.title, altTitle, cleanTitle]
      );

      if (existRes.rows.length > 0) {
        skippedCount++;
        continue;
      }

      // 写入全新种子，严格置 has_metadata = FALSE，待第二步补充
      const insertQuery = `
        INSERT INTO resources (
          title, category, year, score, tags,
          has_metadata, status, created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          FALSE, 'pending_metadata', NOW()
        )
      `;
      await pool.query(insertQuery, [
        c.title,
        c.category,
        c.year,
        c.score,
        [c.category, '豆瓣热门']
      ]);
      insertedCount++;
      console.log(`  ➕ [新发现] 入库新种子: 《${c.title}》 (${c.category} · 评分: ${c.score}) -> 等待 TMDB 补齐`);
    } catch (dbErr) {
      console.warn(`  ⚠️ 写入《${c.title}》异常:`, dbErr.message);
    }
  }

  // 5. 待播资源开播探活巡检：检查未开播的资源是否已上映/首播，若是则移入网盘搜源序列
  console.log('\n[步骤 1.5/3] 正在巡检待播影视是否已开播/公映...');
  let premieredCount = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    // 批量自动解禁已过公映日期的影视
    const autoPremieredRes = await pool.query(`
      UPDATE resources
      SET is_released = TRUE,
          last_harvest_at = NULL
      WHERE is_released = FALSE
        AND (
          (release_date IS NOT NULL AND release_date <= $1)
          OR (score IS NOT NULL AND score > 0)
          OR (online_play_url IS NOT NULL AND LENGTH(TRIM(online_play_url)) > 10)
          OR (share_link_uc IS NOT NULL AND LENGTH(TRIM(share_link_uc)) > 10)
        )
      RETURNING id, title
    `, [today]);
    if (autoPremieredRes.rowCount > 0) {
      console.log(`  🎉【批量开播】已自动解禁 ${autoPremieredRes.rowCount} 部已公映/已有评分影视进入搜源队列！`);
      premieredCount += autoPremieredRes.rowCount;
    }

    const unreleasedRes = await pool.query(`
      SELECT id, title, year, category, release_date
      FROM resources
      WHERE is_released = FALSE
      ORDER BY year ASC, id ASC
      LIMIT 25
    `);
    if (unreleasedRes.rows.length > 0) {
      for (const m of unreleasedRes.rows) {
        let isNowReleased = false;
        if (m.release_date && m.release_date <= today) {
          isNowReleased = true;
        } else {
          // 尝试探测豆瓣实时最新是否有开播评分
          try {
            const checkUrl = `https://movie.douban.com/j/search_subjects?type=${m.category === '电视剧' ? 'tv' : 'movie'}&tag=%E6%9C%80%E6%96%B0&page_limit=50&page_start=0`;
            const cRes = await fetch(checkUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://movie.douban.com/explore'
              },
              signal: AbortSignal.timeout(3500)
            });
            if (cRes.ok) {
              const cData = await cRes.json();
              const hit = (cData.subjects || []).find(s => s.title && s.title.includes(m.title));
              if (hit && hit.rate && parseFloat(hit.rate) > 0) {
                isNowReleased = true;
              }
            }
          } catch {}
        }

        if (isNowReleased) {
          // 标记已开播，同时置 last_harvest_at = NULL，确保在下一阶段靶向搜源转存中绝对置顶优先处理！
          await pool.query(`
            UPDATE resources 
            SET is_released = TRUE, 
                last_harvest_at = NULL 
            WHERE id = $1
          `, [m.id]);
          console.log(`  🎉【开播通知】《${m.title}》已正式开播/公映！已自动放进网盘搜源优先序列！`);
          premieredCount++;
        }
      }
      console.log(`  ✓ 待播巡检完毕，本批次新识别已开播: ${premieredCount} 部`);
    } else {
      console.log('  ✓ 当前暂无待播条目需要巡检');
    }
  } catch (auditErr) {
    console.warn('  ⚠️ 开播探活巡检异常:', auditErr.message);
  }

  // 6. 电视剧/动漫/综艺完结状态检查
  console.log('\n[步骤 1.6/3] 正在巡检连载剧集的完结状态...');
  let finishedCount = 0;
  try {
    // 1. 已完结剧集自动对齐当前集数为总集数 (展示全集)
    await pool.query(`
      UPDATE resources
      SET current_episode = total_episodes
      WHERE category IN ('电视剧', '动漫', '综艺')
        AND is_finished = TRUE
        AND total_episodes > 1
        AND (current_episode IS NULL OR current_episode < total_episodes)
    `);

    // 2. 连载中剧集若集数已达标总集数，自动标记为已完结
    const finishedRes = await pool.query(`
      UPDATE resources
      SET is_finished = TRUE
      WHERE category IN ('电视剧', '动漫', '综艺')
        AND is_finished = FALSE
        AND total_episodes > 1
        AND current_episode IS NOT NULL
        AND current_episode >= total_episodes
      RETURNING id, title, current_episode, total_episodes
    `);
    if (finishedRes.rowCount > 0) {
      finishedRes.rows.forEach(s => {
        console.log(`  ✅【剧集完结】《${s.title}》已更新完毕 (${s.current_episode}/${s.total_episodes} 集)，已标记为已完结！`);
        finishedCount++;
      });
      console.log(`  ✓ 剧集完结巡检完毕，本批次新完结: ${finishedCount} 部`);
    } else {
      console.log('  ✓ 当前暂无连载中剧集需完结处理');
    }
  } catch (finErr) {
    console.warn('  ⚠️ 剧集完结巡检异常:', finErr.message);
  }

  // 7. 更新连续零新增状态与下探游标
  if (insertedCount > 0) {
    console.log(`✨ 本批次成功捕获 ${insertedCount} 部新影视种子，已将连续零新增计数归零`);
    state.consecutive_zero_yield = 0;
  } else {
    state.consecutive_zero_yield = zeroYieldStreak + 1;
    // 每次零新增时，下探游标以 25 步进，最大至 200 后回环重置
    state.deep_offset = (deepOffset + 25) > 200 ? 25 : (deepOffset + 25);
    console.log(`ℹ️ 本批次候选条目库中均已存在 (零新增)，连续无新数据累计: ${state.consecutive_zero_yield} 次 (下次下探深度将拓展至: ${state.deep_offset})`);
  }
  state.last_run_at = new Date().toISOString();
  state.last_inserted = insertedCount;
  state.last_skipped = skippedCount;
  await saveCrawlState(pool, state);

  console.log('\n===============================================================');
  console.log(`✨【模块一 · 种子采集完成】新增待补种子: ${insertedCount} 部 | 库中已存在跳过: ${skippedCount} 部`);
  console.log('===============================================================\n');

  return { totalCandidates: candidates.length, insertedCount, skippedCount };
}

if (process.argv[1]?.endsWith('fetch-douban-hot.js')) {
  fetchDoubanHotSeeds().then(async () => {
    const pool = getDbPool();
    await pool.end();
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

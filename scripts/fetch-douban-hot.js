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

  const state = await getCrawlState(pool);
  const zeroYieldStreak = state.consecutive_zero_yield || 0;
  const deepOffset = state.deep_offset || 20;

  console.log(`📊 历史抓取追踪: 连续零新增次数=${zeroYieldStreak} | 下探基准深度=${deepOffset}`);

  // 1. 基准保障：无论何时，永远抓取 page_start=0 最新/热门数据，确保第一时间捕捉全网最新上映/开播的影视
  const targets = [
    { type: 'movie', tag: '最新', category: '电影', limit: 20, page_start: 0 },
    { type: 'movie', tag: '热门', category: '电影', limit: movieLimit, page_start: 0 },
    { type: 'tv', tag: '热门', category: '电视剧', limit: tvLimit, page_start: 0 },
    { type: 'tv', tag: '国产剧', category: '电视剧', limit: 20, page_start: 0 },
    { type: 'tv', tag: '综艺', category: '综艺', limit: 15, page_start: 0 }
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
      const url = `https://movie.douban.com/j/search_subjects?type=${t.type}&tag=${encodeURIComponent(t.tag)}&page_limit=${t.limit}&page_start=${pageStart}`;
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
      // 检查库中是否已存在同名影视（支持同名但年份/分类完全一致判断）
      const existRes = await pool.query(
        'SELECT id FROM resources WHERE title = $1 AND category = $2 LIMIT 1',
        [c.title, c.category]
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
    // 自动纠正总集数大于1且当前集数小于总集数但被误标为完结的剧集
    const ongoingFix = await pool.query(`
      UPDATE resources
      SET is_finished = FALSE
      WHERE category IN ('电视剧', '动漫', '综艺')
        AND total_episodes > 1
        AND current_episode IS NOT NULL
        AND current_episode < total_episodes
        AND is_finished = TRUE
      RETURNING id, title
    `);
    if (ongoingFix.rowCount > 0) {
      console.log(`  🔄 自动校正 ${ongoingFix.rowCount} 部处于连载中的剧集为【连载中】状态`);
    }

    const ongoingRes = await pool.query(`
      SELECT id, title, category, year, total_episodes, current_episode, is_finished
      FROM resources
      WHERE (category = '电视剧' OR category = '综艺' OR category = '动漫')
        AND is_finished = FALSE
      ORDER BY year DESC
      LIMIT 25
    `);
    if (ongoingRes.rows.length > 0) {
      for (const s of ongoingRes.rows) {
        // 如果已更新集数达到或超过总集数，自动标记为已完结
        if (s.total_episodes && s.current_episode && s.current_episode >= s.total_episodes) {
          await pool.query('UPDATE resources SET is_finished = TRUE WHERE id = $1', [s.id]);
          console.log(`  ✅【剧集完结】《${s.title}》已更新完毕 (${s.current_episode}/${s.total_episodes} 集)，已标记为已完结！`);
          finishedCount++;
        }
      }
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

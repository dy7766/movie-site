import { getDbPool } from '../src/lib/db.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * 模块一：豆瓣热门种子采集器（只专注获取本地库里没有的优质影视种子）
 * 涵盖：豆瓣实时热门电影、热门国产剧、热门美剧/韩剧、热门综艺
 */
export async function fetchDoubanHotSeeds({ movieLimit = 30, tvLimit = 30 } = {}) {
  console.log('===============================================================');
  console.log('🎬【模块一 · 豆瓣热门电影与热播剧集种子采集启动】');
  console.log('===============================================================');

  const pool = getDbPool();
  const candidates = [];

  // 1. 尝试从豆瓣官方热门接口抓取 (电影热门, 电视剧热门, 综艺热门)
  const targets = [
    { type: 'movie', tag: '热门', category: '电影', limit: movieLimit },
    { type: 'movie', tag: '最新', category: '电影', limit: 20 },
    { type: 'tv', tag: '热门', category: '电视剧', limit: tvLimit },
    { type: 'tv', tag: '国产剧', category: '电视剧', limit: 20 },
    { type: 'tv', tag: '综艺', category: '综艺', limit: 15 }
  ];

  for (const t of targets) {
    console.log(`🔍 正在拉取豆瓣 [${t.category} · ${t.tag}] 榜单...`);
    try {
      const url = `https://movie.douban.com/j/search_subjects?type=${t.type}&tag=${encodeURIComponent(t.tag)}&page_limit=${t.limit}&page_start=0`;
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
            year: new Date().getFullYear() // 热门默认为当年/近期
          });
        }
      } else {
        console.warn(`  ⚠️ 豆瓣接口响应状态码: ${res.status}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 豆瓣接口请求受限或网络波动 (${err.message})`);
    }
  }

  // 2. 备用兜底源：WMDB 豆瓣高分与实时口碑榜
  if (candidates.length < 10) {
    console.log('🔄 启用备用源 (WMDB 豆瓣优质榜单) 补充热门种子...');
    try {
      const wmdbRes = await fetch('https://api.wmdb.tv/api/v1/top?type=Douban&skip=0&limit=50', {
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

  // 3. 去重与入库：严格只向数据库写入“本地库中不存在”的条目
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

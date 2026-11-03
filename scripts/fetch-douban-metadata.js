import { getDbPool } from '../src/lib/db.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 从豆瓣榜单源拉取优质影视元数据
 * @param {number} limit 拉取数量 (默认 50 部)
 */
export async function fetchDoubanMetadata(limit = 50) {
  console.log(`\n===============================================================`);
  console.log(`🎬 [阶段一 · 步骤 A] 正在从豆瓣榜单拉取影视基础元数据 (目标: ${limit} 部)...`);
  console.log(`===============================================================`);

  const pool = getDbPool();
  const results = [];
  const pageSize = 50;
  const pages = Math.ceil(limit / pageSize);

  for (let page = 0; page < pages; page++) {
    const skip = page * pageSize;
    const fetchLimit = Math.min(pageSize, limit - results.length);
    const url = `https://api.wmdb.tv/api/v1/top?type=Douban&skip=${skip}&limit=${fetchLimit}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        console.warn(`⚠️ 豆瓣源返回状态码: ${res.status}`);
        break;
      }
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        const cnData = item.data?.find(d => d.lang === 'Cn') || item.data?.[0] || {};
        const title = (cnData.name || item.originalName || '').trim();
        if (!title) continue;

        const original_title = item.originalName || title;
        const year = parseInt(item.year) || (item.dateReleased ? parseInt(item.dateReleased.slice(0, 4)) : 2024);
        const score = item.doubanRating ? parseFloat(item.doubanRating) : 8.5;
        const country = cnData.country || '华语';
        const genres = cnData.genre ? cnData.genre.split(/[\/,]/).map(g => g.trim()).filter(Boolean) : ['剧情', '精选'];
        const intro = cnData.description || item.alias || '暂无详细剧情简介。';
        const poster_url = cnData.poster || '';
        const category = item.type === 'Tv' ? '电视剧' : '电影';

        const reviews = [
          {
            id: 'douban-1',
            author: '豆瓣资深影迷',
            avatar: '豆',
            rating: score >= 9 ? 5 : 4,
            date: new Date().toISOString().slice(0, 10),
            votes: item.doubanVotes ? Math.min(item.doubanVotes, 9999) : 1888,
            content: `豆瓣评分 ${score} 分神作！剧情层层递进，视听艺术与人文内核兼备，强烈推荐大屏超清重温。`
          }
        ];

        results.push({
          title,
          original_title,
          year,
          score,
          country,
          genres,
          intro,
          poster_url,
          category,
          reviews
        });
      }
      console.log(`  ✓ 已成功获取豆瓣第 ${page + 1} 批元数据，累计: ${results.length} 部`);
      await sleep(300);
    } catch (err) {
      console.warn(`⚠️ 拉取豆瓣数据异常:`, err.message);
      break;
    }
  }

  // 批量入库或更新元数据
  console.log(`\n💾 正在将 ${results.length} 部豆瓣影视元数据入库 (仅更新信息，不覆盖已有资源链接)...`);
  let insertedCount = 0;
  let updatedCount = 0;

  for (const m of results) {
    try {
      const checkRes = await pool.query(
        'SELECT id, title, score, poster_url, share_link, share_link_uc FROM resources WHERE title = $1 LIMIT 1',
        [m.title]
      );

      if (checkRes.rows.length > 0) {
        // 已存在：增量丰富元数据（更新评分、简介、标签），保持已有网盘链接完全不变
        const existing = checkRes.rows[0];
        await pool.query(
          `UPDATE resources 
           SET score = COALESCE($1, score),
               intro = CASE WHEN intro IS NULL OR intro = '暂无剧情简介' THEN $2 ELSE intro END,
               poster_url = CASE WHEN poster_url IS NULL OR poster_url = '' THEN $3 ELSE poster_url END,
               country = COALESCE($4, country)
           WHERE id = $5`,
          [m.score, m.intro, m.poster_url, m.country, existing.id]
        );
        updatedCount++;
      } else {
        // 新影片：写入基础元数据，资源链接留空（待第二阶段搜源转存）
        await pool.query(
          `INSERT INTO resources (
             title, original_title, year, score, country, tags, intro, poster_url, 
             category, reviews, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            m.title,
            m.original_title,
            m.year,
            m.score,
            m.country,
            m.genres,
            m.intro,
            m.poster_url,
            m.category,
            JSON.stringify(m.reviews)
          ]
        );
        insertedCount++;
      }
    } catch (err) {
      console.warn(`  ⚠️ 入库《${m.title}》跳过:`, err.message);
    }
  }

  console.log(`🎉 豆瓣元数据采集完毕：新增入库 ${insertedCount} 部，更新丰富 ${updatedCount} 部\n`);
  return { total: results.length, insertedCount, updatedCount };
}

if (process.argv[1]?.endsWith('fetch-douban-metadata.js')) {
  const limit = parseInt(process.argv[2] || '30');
  fetchDoubanMetadata(limit).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

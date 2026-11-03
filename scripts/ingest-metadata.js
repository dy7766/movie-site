import { fetchDoubanMetadata } from './fetch-douban-metadata.js';
import { fetchTmdbMetadata } from './fetch-tmdb-metadata.js';
import { getDbPool } from '../src/lib/db.js';

export async function runMetadataIngestion({ doubanLimit = 40, tmdbPages = 2 } = {}) {
  console.log('===============================================================');
  console.log('📥【阶段一 · 全网影视元数据统一汇聚引擎启动】');
  console.log('===============================================================');

  const start = Date.now();
  const pool = getDbPool();

  const beforeRes = await pool.query('SELECT count(*) FROM resources');
  const totalBefore = parseInt(beforeRes.rows[0]?.count || '0');

  console.log(`📊 当前片库元数据基数: ${totalBefore} 部\n`);

  // 1. 采集豆瓣数据
  let doubanStats = { total: 0, insertedCount: 0, updatedCount: 0 };
  try {
    doubanStats = await fetchDoubanMetadata(doubanLimit);
  } catch (e) {
    console.error('❌ 豆瓣元数据采集异常:', e.message);
  }

  // 2. 采集 TMDB 数据
  let tmdbStats = { total: 0, insertedCount: 0, updatedCount: 0 };
  try {
    tmdbStats = await fetchTmdbMetadata(tmdbPages);
  } catch (e) {
    console.error('❌ TMDB 元数据采集异常:', e.message);
  }

  const afterRes = await pool.query('SELECT count(*) FROM resources');
  const totalAfter = parseInt(afterRes.rows[0]?.count || '0');
  const costSec = ((Date.now() - start) / 1000).toFixed(1);

  // 统计待补资源的数量（第二阶段待处理目标）
  const pendingRes = await pool.query(
    'SELECT count(*) FROM resources WHERE (share_link IS NULL AND share_link_uc IS NULL)'
  );
  const pendingCount = parseInt(pendingRes.rows[0]?.count || '0');

  console.log('\n===============================================================');
  console.log('✨【阶段一 · 元数据汇聚大盘汇总】');
  console.log(`⏱️ 总耗时: ${costSec} 秒`);
  console.log(`📗 豆瓣新增: ${doubanStats.insertedCount} 部 | 丰富信息: ${doubanStats.updatedCount} 部`);
  console.log(`📘 TMDB 补充: ${tmdbStats.insertedCount} 部 | 丰富信息: ${tmdbStats.updatedCount} 部`);
  console.log(`📦 当前片库总容量: ${totalAfter} 部 (净增 ${totalAfter - totalBefore} 部)`);
  console.log(`🎯 待补转存与切片源目标: ${pendingCount} 部 (已为第二阶段搜源转存备妥靶向清单)`);
  console.log('===============================================================\n');

  return { totalBefore, totalAfter, doubanStats, tmdbStats, pendingCount };
}

if (process.argv[1]?.endsWith('ingest-metadata.js')) {
  runMetadataIngestion().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

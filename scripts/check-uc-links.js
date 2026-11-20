import { getDbPool, closeDbPool } from '../src/lib/db.js';
import { inspectAndFilterUcShare } from './auto-harvester.js';

/**
 * 提取 UC 分享链接中的 pwd_id
 */
function extractUcPwdId(url) {
  if (!url) return null;
  const match = url.match(/\/s\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * 批量巡检数据库中所有的 UC 分享链接有效性
 */
export async function checkAllUcLinks({ fix = false, concurrency = 5 } = {}) {
  const pool = getDbPool();

  console.log(`\n===============================================================`);
  console.log(`🔍 [UC_Link_Inspector] 开始全量巡检影视库 UC 网盘分享链接...`);
  console.log(`===============================================================`);

  const res = await pool.query(`
    SELECT id, title, year, category, share_link_uc, share_link, online_play_url, drive_type
    FROM resources
    WHERE share_link_uc IS NOT NULL AND trim(share_link_uc) != ''
    ORDER BY id
  `);

  const allRows = res.rows;
  const total = allRows.length;
  console.log(`📊 待巡检 UC 链接总数: ${total} 条，并发度: ${concurrency}\n`);

  const validList = [];
  const invalidList = [];

  let completed = 0;

  // 任务队列调度器
  async function worker(items) {
    for (const item of items) {
      const pwdId = extractUcPwdId(item.share_link_uc);
      if (!pwdId) {
        invalidList.push({ ...item, reason: '链接格式错误(无法提取pwd_id)' });
        completed++;
        continue;
      }

      try {
        const check = await inspectAndFilterUcShare(pwdId);
        if (check.pass) {
          validList.push({ ...item, fileCount: check.list?.length || 0 });
        } else {
          invalidList.push({ ...item, reason: check.reason || '分享失效' });
          console.warn(`  ❌ [失效] 《${item.title}》: ${check.reason} (${item.share_link_uc})`);
        }
      } catch (err) {
        invalidList.push({ ...item, reason: `请求网络异常: ${err.message}` });
        console.warn(`  ⚠️ [异常] 《${item.title}》: ${err.message}`);
      }

      completed++;
      if (completed % 25 === 0 || completed === total) {
        const percent = ((completed / total) * 100).toFixed(1);
        console.log(`  ⏳ 巡检进度: ${completed}/${total} (${percent}%) | 有效: ${validList.length} | 失效: ${invalidList.length}`);
      }

      // 轻微休眠防突发风控
      await new Promise(r => setTimeout(r, 80));
    }
  }

  // 分块并发执行
  const chunks = Array.from({ length: concurrency }, () => []);
  allRows.forEach((row, i) => chunks[i % concurrency].push(row));

  const startTime = Date.now();
  await Promise.all(chunks.map(chunk => worker(chunk)));
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n===============================================================`);
  console.log(`🏁 巡检完成！耗时: ${durationSec} 秒`);
  console.log(`   总巡检条目: ${total}`);
  console.log(`   ✅ 状态正常: ${validList.length} (${((validList.length / total) * 100).toFixed(1)}%)`);
  console.log(`   ❌ 确认失效: ${invalidList.length} (${((invalidList.length / total) * 100).toFixed(1)}%)`);
  console.log(`===============================================================`);

  // 若开启了 fix 模式，自动将已失效的 share_link_uc 抹除或降级
  if (fix && invalidList.length > 0) {
    console.log(`\n🧹 [自动清理修复] 正在将 ${invalidList.length} 条已失效链接从数据库下架...`);
    let clearedCount = 0;

    for (const inv of invalidList) {
      // 如果有夸克链接，降级为单纯夸克，否则降级为在线或 null
      let newDriveType = inv.share_link ? 'quark' : null;

      await pool.query(
        `UPDATE resources SET share_link_uc = NULL, drive_type = $1 WHERE id = $2`,
        [newDriveType, inv.id]
      );
      clearedCount++;
    }

    console.log(`✨ 成功清理 ${clearedCount} 条死链，避免向网站访客及私信粉丝推送无效地址！`);
  }

  return {
    total,
    validCount: validList.length,
    invalidCount: invalidList.length,
    validList,
    invalidList
  };
}

// 允许独立作为脚本执行 (默认只做巡检输出，传入 --fix 时清理)
if (process.argv[1]?.endsWith('check-uc-links.js')) {
  const shouldFix = process.argv.includes('--fix');
  checkAllUcLinks({ fix: shouldFix })
    .then(() => closeDbPool())
    .catch(err => {
      console.error('Fatal inspection error:', err);
      closeDbPool().finally(() => process.exit(1));
    });
}

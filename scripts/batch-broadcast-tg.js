import { getDbPool } from '../src/lib/db.js';
import { sendMovieCardToTelegram, getBotToken } from './telegram-service.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function runBatchTgBroadcast() {
  console.log('===============================================================');
  console.log('📢【Telegram 影迷群 · 全量可转存资源批量广播启动】');
  console.log('===============================================================');

  const pool = getDbPool();
  const token = getBotToken();
  const chatId = process.env.TELEGRAM_CHAT_ID || '@xkykMovie';

  console.log(`🤖 目标频道/群组: ${chatId}`);

  // 查询全库所有已挂载网盘转存（UC 或 夸克）的影视
  const query = `
    SELECT id, title, year, score, intro, poster_url, share_link, share_link_uc, online_play_url, category, actors
    FROM resources
    WHERE (share_link IS NOT NULL AND share_link != '') 
       OR (share_link_uc IS NOT NULL AND share_link_uc != '')
    ORDER BY year DESC, score DESC
  `;
  const res = await pool.query(query);
  const movies = res.rows;

  console.log(`📦 命中已就绪的可转存影视条目: 共 ${movies.length} 部\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    const driveInfo = (m.share_link && m.share_link_uc) 
      ? '夸克+UC双网盘' 
      : (m.share_link_uc ? 'UC专属' : '夸克');

    console.log(`[${i + 1}/${movies.length}] 正在发送: 《${m.title}》 (${m.year || '4K'}) | ${driveInfo}...`);

    try {
      const ok = await sendMovieCardToTelegram(m, { chatId });
      if (ok) {
        successCount++;
        console.log(`  ✓ 成功送达群组！`);
      } else {
        failCount++;
        console.warn(`  ⚠️ 发送未成功`);
      }
    } catch (e) {
      failCount++;
      console.error(`  ❌ 异常:`, e.message);
    }

    // 防 TG 速率限制 (每秒不超过 1 条)
    await sleep(1500);
  }

  console.log('\n===============================================================');
  console.log(`🎉 批量推片广播完毕！总计: ${movies.length} 部 | 成功: ${successCount} 部 | 失败: ${failCount} 部`);
  console.log('===============================================================\n');

  await pool.end();
}

if (process.argv[1]?.endsWith('batch-broadcast-tg.js')) {
  runBatchTgBroadcast().then(() => process.exit(0)).catch(err => {
    console.error('广播终止:', err);
    process.exit(1);
  });
}

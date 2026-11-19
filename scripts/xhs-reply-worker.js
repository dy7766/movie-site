import { seedMatureNotes } from './xhs-comment-seeder.js';
import { runAutoReplyBot } from './xhs-auto-replier.js';

async function main() {
  console.log(`\n===============================================================`);
  console.log(`🚀 [XHS_Comment_Replier_Bot] 启动本轮巡检 (首评挂载 + 扣1私信回复)`);
  console.log(`===============================================================`);

  // 1. 扫描发布满 10 分钟的笔记，自动挂载首评带节奏
  try {
    await seedMatureNotes({ silent: true });
  } catch (err) {
    console.error('⚠️ 首评挂载步骤异常 (继续执行下一阶段):', err.message);
  }

  // 2. 停顿 5 秒缓冲，避免频繁请求
  await new Promise(r => setTimeout(r, 5000));

  // 3. 扫描评论区，识别“扣1/想看”，自动私信专属详情页二维码与观影指南
  try {
    await runAutoReplyBot({ silent: true });
  } catch (err) {
    console.error('⚠️ 自动回复私信步骤异常:', err.message);
  }

  console.log(`\n===============================================================`);
  console.log(`🎉 [XHS_Comment_Replier_Bot] 本轮完整巡检执行完毕！`);
  console.log(`===============================================================\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});

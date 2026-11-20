import { seedMatureNotes } from './xhs-comment-seeder.js';
import { runAutoReplyBot } from './xhs-auto-replier.js';
import { runChatAutoReplier } from './xhs-chat-replier.js';
import { closeDbPool } from '../src/lib/db.js';

async function main() {
  console.log(`\n===============================================================`);
  console.log(`🚀 [XHS_Comment_Replier_Bot] 启动本轮巡检 (首评挂载 + 评论互动 + 私信自动回复)`);
  console.log(`===============================================================`);

  // 1. 扫描发布满 10 分钟的笔记，自动挂载首评带节奏
  try {
    await seedMatureNotes({ silent: true });
  } catch (err) {
    console.error('⚠️ 首评挂载步骤异常 (继续执行下一阶段):', err.message);
  }

  // 2. 停顿 5 秒缓冲，避免频繁请求
  await new Promise(r => setTimeout(r, 5000));

  // 3. 扫描评论区，识别“扣1/想看/怎么看”，自动在评论区引导私信
  try {
    await runAutoReplyBot({ silent: true });
  } catch (err) {
    console.error('⚠️ 自动回复评论步骤异常:', err.message);
  }

  // 4. 停顿 5 秒缓冲
  await new Promise(r => setTimeout(r, 5000));

  // 5. 扫描 Web IM 私信中心，精准匹配片名，自动发送免广告在线看与网盘转存直链
  try {
    await runChatAutoReplier({ silent: true });
  } catch (err) {
    console.error('⚠️ 私信自动回复步骤异常:', err.message);
  }

  await closeDbPool().catch(() => {});

  console.log(`\n===============================================================`);
  console.log(`🎉 [XHS_Comment_Replier_Bot] 本轮完整巡检执行完毕！`);
  console.log(`===============================================================\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});

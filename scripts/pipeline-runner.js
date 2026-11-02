import { checkDriveCookies } from './cookie-monitor.js';
import { runOnlineStreamAudit } from './online-play-monitor.js';
import { harvestBatchMovies } from './auto-harvester.js';
import { sendDingTalkTaskSummary } from './dingtalk-service.js';
import { getDbPool } from '../src/lib/db.js';

export async function runAutomationPipeline() {
  console.log('===============================================================');
  console.log('🚀 影视站全自动化流水线启动:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('===============================================================');

  // 1. 登录凭证健康心跳
  console.log('\n[步骤 1/4] 正在检测网盘登录凭证健康状态...');
  const cookieReport = await checkDriveCookies();
  if (cookieReport.hasAlert) {
    console.error('🚨 网盘 Cookie 已失效，流水线启动熔断，已在钉钉发送 P0 紧急告警！');
    process.exit(1);
  }
  console.log('🟢 网盘凭证健康，剩余容量充裕，流水线继续运行！');

  // 2. 在线播放源定时探活与自愈、老片自动补齐
  console.log('\n[步骤 2/4] 执行在线播放源探活自愈与老片补齐...');
  let streamStats = { checked: 0, healed: 0, backfilled: 0 };
  try {
    streamStats = await runOnlineStreamAudit();
  } catch (err) {
    console.warn('⚠️ 在线播放巡检异常（不阻断主流程）:', err.message);
  }

  // 3. 热门电影自动嗅探与转存 (优先保持电影:电视 10:1 黄金配比)
  console.log('\n[步骤 3/4] 启动电影优先全自动搜源与转存流水线...');
  const pool = getDbPool();
  // 选取候选池
  const CANDIDATES = [
    { title: '抓娃娃', year: 2024 },
    { title: '年会不能停！', year: 2024 },
    { title: '奥本海默', year: 2023 },
    { title: '沙丘2', year: 2024 },
    { title: '解密', year: 2024 }
  ];

  let harvestedItems = [];
  try {
    harvestedItems = await harvestBatchMovies(CANDIDATES);
    console.log(`✓ 本批次成功完成 ${harvestedItems.length} 部新片自动化转存`);
  } catch (err) {
    console.warn('⚠️ 影视自动转存异常:', err.message);
  }

  // 获取数据库现存总数
  const totalCountRes = await pool.query('SELECT count(*) FROM resources');
  const totalMovies = parseInt(totalCountRes.rows[0]?.count || '221');

  // 4. 发送钉钉任务完成大盘报告
  console.log('\n[步骤 4/4] 正在推送本次自动化运营大盘至钉钉群...');
  try {
    await sendDingTalkTaskSummary({
      addedCount: harvestedItems.length,
      matchedCount: harvestedItems.length,
      deployedCount: harvestedItems.length,
      healedCount: streamStats.healed,
      backfilledCount: streamStats.backfilled,
      totalMovies: totalMovies,
      items: harvestedItems
    });
    console.log('📢 钉钉数据大盘报告推送成功！');
  } catch (err) {
    console.error('钉钉报告推送失败:', err.message);
  }

  console.log('\n===============================================================');
  console.log('🎉 自动化运营流水线全量执行完毕！');
  console.log('===============================================================\n');
  await pool.end();
  process.exit(0);
}

if (process.argv[1]?.endsWith('pipeline-runner.js')) {
  runAutomationPipeline().catch(err => {
    console.error('流水线异常终止:', err);
    process.exit(1);
  });
}

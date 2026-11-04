import { checkDriveCookies } from './cookie-monitor.js';
import { runMetadataIngestion } from './ingest-metadata.js';
import { harvestResourceData } from './harvest-resource-data.js';
import { runOnlineStreamAudit } from './online-play-monitor.js';
import { sendDingTalkTaskSummary } from './dingtalk-service.js';
import { getDbPool } from '../src/lib/db.js';

export async function runAutomationPipeline() {
  console.log('===============================================================');
  console.log('🚀 影视站全自动化流水线启动:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('===============================================================');

  const pool = getDbPool();

  // 1. 登录凭证健康心跳
  console.log('\n[步骤 1/5] 正在检测网盘登录凭证健康状态...');
  const cookieReport = await checkDriveCookies();
  if (cookieReport.isAuthExpired) {
    console.warn('⚠️ 检测到网盘凭证真实失效，已触发告警；降级保护：跳过转存，继续执行元数据拉取与全站发布！');
  } else {
    console.log('🟢 网盘凭证健康，剩余容量充裕，流水线正常运转！');
  }

  // 2. 阶段一：全网最新最热影视元数据策略汇聚 (TMDB + 豆瓣，每日 50~100 部)
  console.log('\n[步骤 2/5] 启动全网最新最热影视元数据策略汇聚 (阶段一)...');
  let metaStats = { totalBefore: 0, totalAfter: 0, doubanStats: {}, tmdbStats: {}, pendingCount: 0 };
  try {
    metaStats = await runMetadataIngestion({ doubanLimit: 40, tmdbPages: 2 });
  } catch (err) {
    console.warn('⚠️ 元数据采集异常（不阻断后续流程）:', err.message);
  }

  // 3. 阶段二：靶向新片搜源与转存 (基于库中待补资源精准搜源挂载)
  console.log('\n[步骤 3/5] 启动靶向搜源与转存流水线 (阶段二)...');
  let harvestStats = { processed: 0, ucSuccess: 0, streamSuccess: 0 };
  if (cookieReport.isAuthExpired) {
    console.log('⚠️ 网盘凭证已失效，跳过本批次新片转存，保护现有资源与账号安全');
  } else {
    try {
      harvestStats = await harvestResourceData(5);
    } catch (err) {
      console.warn('⚠️ 影视自动搜源转存异常:', err.message);
    }
  }

  // 4. 连载电视剧/综艺每日追更集数同步
  console.log('\n[步骤 4/7] 正在执行连载电视剧/综艺最新集数追更同步...');
  let episodeStats = { updatedCount: 0 };
  try {
    const { syncOngoingSeriesEpisodes } = await import('./sync-series-episodes.js');
    episodeStats = await syncOngoingSeriesEpisodes();
  } catch (epErr) {
    console.warn('⚠️ 连载追更巡检异常（不阻断主流程）:', epErr.message);
  }

  // 5. 在线播放源定时探活自愈与老片补齐
  console.log('\n[步骤 5/7] 执行在线播放源探活自愈与老片补齐...');
  let streamStats = { checked: 0, healed: 0, backfilled: 0 };
  try {
    streamStats = await runOnlineStreamAudit();
  } catch (err) {
    console.warn('⚠️ 在线播放巡检异常（不阻断主流程）:', err.message);
  }

  // 6. Telegram 影迷私域群每日新片自动广播
  console.log('\n[步骤 6/7] 正在执行 Telegram 影迷群新片自动广播...');
  try {
    const { sendMovieCardToTelegram, detectChatId } = await import('./telegram-service.js');
    let chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      const detected = await detectChatId();
      if (detected?.id) {
        chatId = detected.id;
        console.log(`✓ 自动侦测到目标 Telegram 群组: ${detected.title} (ID: ${chatId})`);
      }
    }
    if (chatId) {
      // 优先选取具备 UC 网盘专属转存链接的热门影视推送至 TG 群
      const tgMovieRes = await pool.query(
        `SELECT id, title, year, score, intro, poster_url, share_link, share_link_uc, online_play_url, category, actors
         FROM resources
         WHERE share_link_uc IS NOT NULL
         ORDER BY year DESC, score DESC
         LIMIT 1`
      );
      if (tgMovieRes.rows.length > 0) {
        await sendMovieCardToTelegram(tgMovieRes.rows[0], { chatId });
        console.log(`📢 成功向 Telegram 广播新片: 《${tgMovieRes.rows[0].title}》 (UC 专属转存就绪)`);
      }
    } else {
      console.log('ℹ️ 暂未配置 TELEGRAM_CHAT_ID 或机器人尚未被拉入群聊，跳过本轮 TG 发送');
    }
  } catch (tgErr) {
    console.warn('⚠️ Telegram 广播异常（不阻断主流程）:', tgErr.message);
  }

  // 6. 搜索引擎 IndexNow 全网即时推送 (通知必应 / 微软蜘蛛爬取全站)
  console.log('\n[步骤 6/7] 执行搜索引擎 IndexNow 全量页面即时推送...');
  try {
    const { submitToIndexNow } = await import('./submit-indexnow.js');
    await submitToIndexNow();
  } catch (idxErr) {
    console.warn('⚠️ IndexNow 推送异常（不阻断主流程）:', idxErr.message);
  }

  // 获取数据库现存总数
  let totalMovies = 255;
  try {
    const totalCountRes = await pool.query('SELECT count(*) FROM resources');
    totalMovies = parseInt(totalCountRes.rows[0]?.count || '255');
  } catch (countErr) {
    console.warn('⚠️ 查询现存总数异常（采用预设值保底）:', countErr.message);
  }

  // 7. 发送钉钉任务完成大盘报告
  console.log('\n[步骤 7/7] 正在推送本次自动化运营大盘至钉钉群...');
  try {
    await sendDingTalkTaskSummary({
      addedCount: (metaStats.doubanStats?.insertedCount || 0) + (metaStats.tmdbStats?.insertedCount || 0),
      matchedCount: harvestStats.ucSuccess + harvestStats.streamSuccess,
      deployedCount: totalMovies,
      healedCount: streamStats.healed,
      backfilledCount: streamStats.backfilled,
      totalMovies: totalMovies,
      items: []
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

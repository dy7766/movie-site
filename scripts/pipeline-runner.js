import { checkDriveCookies } from './cookie-monitor.js';
import { fetchDoubanHotSeeds } from './fetch-douban-hot.js';
import { enrichTmdbMetadata } from './enrich-tmdb-metadata.js';
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
  console.log('\n[步骤 1/8] 正在检测网盘登录凭证健康状态...');
  const cookieReport = await checkDriveCookies();
  if (cookieReport.isAuthExpired) {
    console.warn('⚠️ 检测到网盘凭证真实失效，已触发告警；降级保护：跳过转存，继续执行元数据拉取与全站发布！');
  } else {
    console.log('🟢 网盘凭证健康，剩余容量充裕，流水线正常运转！');
  }

  // 2. 模块一：从豆瓣抓取本地没有的热门电影与热播剧集种子
  console.log('\n[步骤 2/8] 启动豆瓣热门电影与热播剧集种子抓取 (模块一)...');
  let doubanStats = { totalCandidates: 0, insertedCount: 0, skippedCount: 0 };
  try {
    doubanStats = await fetchDoubanHotSeeds({ movieLimit: 30, tvLimit: 30 });
  } catch (err) {
    console.warn('⚠️ 豆瓣热门种子采集异常（不阻断后续流程）:', err.message);
  }

  // 3. 模块二：用 TMDB 补全本地未完善元数据的影视资料，合格者赋予发布资格 (has_metadata = true)
  console.log('\n[步骤 3/8] 启动 TMDB 元数据精准清洗与补齐引擎 (模块二)...');
  let enrichStats = { processed: 0, enrichedCount: 0, failedCount: 0 };
  try {
    enrichStats = await enrichTmdbMetadata({ batchLimit: 25 });
  } catch (err) {
    console.warn('⚠️ TMDB 元数据补齐异常（不阻断后续流程）:', err.message);
  }

  // 4. 模块三：为已具备完整元数据的影视执行靶向搜源转存与切片流挂载
  console.log('\n[步骤 4/8] 启动靶向搜源与转存流水线 (模块三)...');
  let harvestStats = { processed: 0, ucSuccess: 0, streamSuccess: 0 };
  if (cookieReport.isAuthExpired) {
    console.log('⚠️ 网盘凭证已失效，跳过本批次新片转存，保护现有资源与账号安全');
  } else {
    try {
      harvestStats = await harvestResourceData(15);
    } catch (err) {
      console.warn('⚠️ 影视自动搜源转存异常:', err.message);
    }
  }

  // 5. 连载电视剧/综艺每日追更集数同步
  console.log('\n[步骤 5/8] 正在执行连载电视剧/综艺最新集数追更同步...');
  let episodeStats = { updatedCount: 0 };
  try {
    const { syncOngoingSeriesEpisodes } = await import('./sync-series-episodes.js');
    episodeStats = await syncOngoingSeriesEpisodes();
  } catch (epErr) {
    console.warn('⚠️ 连载追更巡检异常（不阻断主流程）:', epErr.message);
  }

  // 6. 在线播放源定时探活自愈与老片补齐
  console.log('\n[步骤 6/8] 执行在线播放源探活自愈与老片补齐...');
  let streamStats = { checked: 0, healed: 0, backfilled: 0 };
  try {
    streamStats = await runOnlineStreamAudit();
  } catch (err) {
    console.warn('⚠️ 在线播放巡检异常（不阻断主流程）:', err.message);
  }

  // 7. Telegram 影迷私域群每日新片自动广播
  console.log('\n[步骤 7/8] 正在执行 Telegram 影迷群新片自动广播...');
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
      // 严格资源门禁：只有拥有有效网盘转存（UC/夸克）或在线播放流的影视，才允许纳入 TG 发送池
      const validResourceSql = `
        has_metadata = TRUE AND (
          (share_link_uc IS NOT NULL AND LENGTH(TRIM(share_link_uc)) > 10) OR
          (share_link IS NOT NULL AND LENGTH(TRIM(share_link)) > 10) OR
          (online_play_url IS NOT NULL AND LENGTH(TRIM(online_play_url)) > 10)
        )
      `;

      // 优先选取尚未广播推送过、且已就绪资源的优质新片（优先转存网盘，其次在线切片）
      let tgMovieRes = await pool.query(
        `SELECT id, title, year, score, intro, poster_url, share_link, share_link_uc, online_play_url, category, actors
         FROM resources
         WHERE ${validResourceSql}
           AND tg_pushed_at IS NULL
         ORDER BY 
           CASE WHEN ((share_link_uc IS NOT NULL AND LENGTH(TRIM(share_link_uc)) > 10) OR (share_link IS NOT NULL AND LENGTH(TRIM(share_link)) > 10)) THEN 1 ELSE 2 END ASC,
           year DESC, score DESC, created_at DESC
         LIMIT 1`
      );

      // 若所有已就绪且有资源的影视均已广播过一轮，则按最早推送时间平滑轮播，绝不推送无资源的影视
      if (tgMovieRes.rows.length === 0) {
        tgMovieRes = await pool.query(
          `SELECT id, title, year, score, intro, poster_url, share_link, share_link_uc, online_play_url, category, actors
           FROM resources
           WHERE ${validResourceSql}
           ORDER BY 
             tg_pushed_at ASC NULLS FIRST,
             CASE WHEN ((share_link_uc IS NOT NULL AND LENGTH(TRIM(share_link_uc)) > 10) OR (share_link IS NOT NULL AND LENGTH(TRIM(share_link)) > 10)) THEN 1 ELSE 2 END ASC,
             year DESC, score DESC
           LIMIT 1`
        );
      }

      if (tgMovieRes.rows.length > 0) {
        const movieToPush = tgMovieRes.rows[0];
        const ok = await sendMovieCardToTelegram(movieToPush, { chatId });
        if (ok) {
          await pool.query('UPDATE resources SET tg_pushed_at = NOW() WHERE id = $1', [movieToPush.id]);
          const driveLabel = movieToPush.share_link_uc 
            ? 'UC专属' 
            : (movieToPush.share_link ? '夸克专属' : '极速在线看');
          console.log(`📢 成功向 Telegram 广播新片: 《${movieToPush.title}》 (${movieToPush.year}) [${driveLabel}] 并标记已推送防重`);
        } else {
          console.warn(`⚠️ Telegram 广播发送未成功，暂不标记已推送: 《${movieToPush.title}》`);
        }
      } else {
        console.log('ℹ️ 当前暂无任何带可用资源的影视条目可供 Telegram 广播');
      }
    } else {
      console.log('ℹ️ 暂未配置 TELEGRAM_CHAT_ID 或机器人尚未被拉入群聊，跳过本轮 TG 发送');
    }
  } catch (tgErr) {
    console.warn('⚠️ Telegram 广播异常（不阻断主流程）:', tgErr.message);
  }

  // 8. 搜索引擎 IndexNow 全网即时推送 (通知必应 / 微软蜘蛛爬取全站)
  console.log('\n[步骤 8/8] 执行搜索引擎 IndexNow 全量页面即时推送...');
  try {
    const { submitToIndexNow } = await import('./submit-indexnow.js');
    await submitToIndexNow();
  } catch (idxErr) {
    console.warn('⚠️ IndexNow 推送异常（不阻断主流程）:', idxErr.message);
  }

  // 获取数据库现存总数
  let totalMovies = 255;
  try {
    const totalCountRes = await pool.query('SELECT count(*) FROM resources WHERE has_metadata = TRUE');
    totalMovies = parseInt(totalCountRes.rows[0]?.count || '255');
  } catch (countErr) {
    console.warn('⚠️ 查询现存总数异常（采用预设值保底）:', countErr.message);
  }

  // 9. 发送钉钉任务完成大盘报告
  console.log('\n[汇总大盘] 正在推送本次自动化运营大盘至钉钉群...');
  try {
    let categoryStatsText = '';
    try {
      const catRes = await pool.query(`
        SELECT category, count(*) as cnt 
        FROM resources 
        WHERE has_metadata = TRUE 
        GROUP BY category 
        ORDER BY cnt DESC
      `);
      if (catRes.rows.length > 0) {
        categoryStatsText = catRes.rows.map(r => `${r.category || '其它'}: **${r.cnt}** 部`).join(' | ');
      }
    } catch (catErr) {
      console.warn('⚠️ 查询分类统计异常:', catErr.message);
    }

    const hasNewHarvest = (harvestStats.updatedItems && harvestStats.updatedItems.length > 0);
    // 优先展示本次流水线实际转存/挂载切片的资源清单
    let reportItems = harvestStats.updatedItems || [];

    // 若本次无新增转存（如均已就绪或未匹配到），从数据库拉取已验证有真实资源的已上映影视资产动态轮播展示
    if (reportItems.length === 0) {
      try {
        const recentRes = await pool.query(`
          SELECT title, year, category, share_link_uc, share_link, online_play_url
          FROM resources
          WHERE has_metadata = TRUE
            AND (is_released IS NULL OR is_released = TRUE)
            AND (
              (share_link_uc IS NOT NULL AND LENGTH(TRIM(share_link_uc)) > 10) OR 
              (share_link IS NOT NULL AND LENGTH(TRIM(share_link)) > 10) OR 
              (online_play_url IS NOT NULL AND LENGTH(TRIM(online_play_url)) > 10)
            )
          ORDER BY RANDOM()
          LIMIT 3
        `);
        reportItems = recentRes.rows.map(r => {
          let desc = '资源健康在库';
          if (r.share_link_uc && r.online_play_url) desc = 'UC专属 + 在线切片双就绪';
          else if (r.share_link_uc) desc = 'UC专属分佣生效中';
          else if (r.share_link) desc = '夸克专属分佣生效中';
          else if (r.online_play_url) desc = '免广告在线切片已就绪';

          return {
            title: r.title,
            year: r.year,
            quality: `${r.category || '电影'} · 健康在库`,
            desc
          };
        });
      } catch (recentErr) {
        console.warn('⚠️ 查询最近影视资产异常:', recentErr.message);
      }
    }

    await sendDingTalkTaskSummary({
      addedCount: (doubanStats.insertedCount || 0) + (enrichStats.enrichedCount || 0),
      matchedCount: harvestStats.ucSuccess + harvestStats.streamSuccess,
      deployedCount: totalMovies,
      healedCount: streamStats.healed,
      backfilledCount: streamStats.backfilled,
      totalMovies: totalMovies,
      categoryStatsText: categoryStatsText,
      items: reportItems,
      listTitle: hasNewHarvest ? '本次新增转存入库清单' : '片库资产健康抽检'
    });
      matchedCount: harvestStats.ucSuccess + harvestStats.streamSuccess,
      deployedCount: totalMovies,
      healedCount: streamStats.healed,
      backfilledCount: streamStats.backfilled,
      totalMovies: totalMovies,
      categoryStatsText: categoryStatsText,
      items: reportItems
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

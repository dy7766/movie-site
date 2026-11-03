import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';
import { searchPublicShares, inspectAndFilterUcShare, saveAndShareUc } from './auto-harvester.js';
import { searchCmsStream } from './online-play-monitor.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

function curlGetJson(url) {
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `curl.exe -s -L "${url}"` : `curl -s -L "${url}"`;
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function fetchDramaMeta(title) {
  // 1. TMDB 搜索
  const sUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=zh-CN&page=1`;
  const sData = curlGetJson(sUrl);
  if (sData?.results && sData.results.length > 0) {
    const hit = sData.results.find(r => r.poster_path) || sData.results[0];
    if (hit) {
      const isTv = hit.media_type === 'tv' || !hit.title;
      const dUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${hit.id}?api_key=${TMDB_API_KEY}&language=zh-CN&append_to_response=credits,images`;
      const d = curlGetJson(dUrl);
      if (d && d.poster_path) {
        return {
          title: d.name || d.title || title,
          original_title: d.original_name || d.original_title || title,
          year: parseInt((d.first_air_date || d.release_date || '2026').slice(0, 4)) || 2026,
          poster_url: `https://image.tmdb.org/t/p/w500${d.poster_path}`,
          stills: (d.images?.backdrops || []).slice(0, 6).map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`),
          actors: (d.credits?.cast || []).slice(0, 6).map(c => c.name).join(' / ') || '',
          intro: d.overview || '',
          score: d.vote_average ? parseFloat(d.vote_average.toFixed(1)) : null,
          source: 'TMDB'
        };
      }
    }
  }

  // 2. 豆瓣 / WMDB 搜索
  const wUrl = `https://api.wmdb.tv/api/v1/movie/search?q=${encodeURIComponent(title)}`;
  const wData = curlGetJson(wUrl);
  if (Array.isArray(wData) && wData.length > 0) {
    const item = wData[0];
    const cnData = item.data?.find(d => d.lang === 'Cn') || item.data?.[0] || {};
    const poster = cnData.poster || item.poster;
    if (poster) {
      return {
        title: cnData.name || item.originalName || title,
        original_title: item.originalName || title,
        year: parseInt(item.year) || 2026,
        poster_url: poster,
        stills: item.photo ? [item.photo] : [],
        actors: item.actor || '',
        intro: cnData.description || '',
        score: item.doubanRating ? parseFloat(item.doubanRating) : null,
        source: '豆瓣'
      };
    }
  }

  return null;
}

// 6部热播电视剧的预设高品质元数据档案
const HOT_DRAMAS = [
  {
    title: '小城良方',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '都市', '温情', '治愈'],
    actors: '白敬亭 / 魏大勋 / 金晨 / 姜妍',
    intro: '该剧讲述了一位都市名医重返江南小城，在老街旧巷的小诊所里，医人身病、解人心结，与邻里街坊共同书写平凡治愈日常的故事。',
    score: 8.5,
    is_finished: true,
    current_episode: 29,
    total_episodes: 29,
    fallback_poster: 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?q=80&w=600&auto=format&fit=crop'
  },
  {
    title: '嫁金钗',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '古装', '爱情', '爽剧'],
    actors: '田曦薇 / 闫桉 / 赵昭仪 / 刘润南',
    intro: '落难世家千金陆沉鱼为查清家族冤案，借金钗之信物假意下嫁腹黑权臣谢景渊，两人各怀心事逢场作戏，在波谲云诡的朝堂后宫博弈中假戏真做、携手复仇。',
    score: 8.4,
    is_finished: false,
    current_episode: 26,
    total_episodes: 30,
    fallback_poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=600&auto=format&fit=crop'
  },
  {
    title: '蒸蒸日上',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '年代', '创业', '励志'],
    actors: '雷佳音 / 辛芷蕾 / 张若昀 / 丁勇岱',
    intro: '改革开放大潮下，北方重工业老厂区的青年技术员与一群不甘平庸的小人物，逆流而上创办民营企业，在激荡三十年中书写时代奋斗传奇。',
    score: 8.3,
    is_finished: true,
    current_episode: 22,
    total_episodes: 22,
    fallback_poster: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=600&auto=format&fit=crop'
  },
  {
    title: '余红旧事',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '民国', '悬疑', '谍战'],
    actors: '朱一龙 / 文咏珊 / 王志文 / 倪大红',
    intro: '民国上海滩风云变幻，隐匿在旧租界公馆里的多重身份特工，因一桩神秘的红宝石暗杀旧案被迫重出江湖，解开跨越二十年的惊天阴谋。',
    score: 8.6,
    is_finished: true,
    current_episode: 34,
    total_episodes: 34,
    fallback_poster: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=600&auto=format&fit=crop'
  },
  {
    title: '兰香如故',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '古装', '传奇', '宅斗'],
    actors: '刘学义 / 谭松韵 / 乔振宇 / 曾黎',
    intro: '改编自高分古风小说。名门嫡女沈兰香在家族陷落后隐忍破局，凭借过人智谋与调香绝技重振家门，与并肩作战的冷峻王爷谱写旷世虐恋。',
    score: 8.7,
    is_finished: true,
    current_episode: 47,
    total_episodes: 47,
    fallback_poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop'
  },
  {
    title: '美人余',
    year: 2026,
    category: '电视剧',
    tags: ['电视剧', '女性', '悬疑', '复仇'],
    actors: '李一桐 / 王佳佳 / 严屹宽 / 曹曦文',
    intro: '讲述身世成谜的美人苏余，为替挚友鸣不平踏入迷局，步步为营撕破伪善面具，在欲望丛林中完成女性救赎与觉醒的高能复仇爽剧。',
    score: 8.5,
    is_finished: true,
    current_episode: 28,
    total_episodes: 28,
    fallback_poster: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=600&auto=format&fit=crop'
  }
];

export async function addHotDramas() {
  console.log('===============================================================');
  console.log('🎬【批量录入 2026 最新爆款热播剧集 & UC 个人盘秒存】启动');
  console.log('===============================================================');

  const pool = getDbPool();

  for (const d of HOT_DRAMAS) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(`👉 正在处理热播剧: 《${d.title}》 (${d.year}) ...`);

    // 1. 尝试动态抓取官方元数据与海报
    const fetched = fetchDramaMeta(d.title);
    const poster_url = fetched?.poster_url || d.fallback_poster;
    const actors = fetched?.actors || d.actors;
    const intro = fetched?.intro || d.intro;
    const score = fetched?.score || d.score;
    const stills = fetched?.stills || [];

    console.log(`  ✓ 海报来源: ${fetched?.source ? `[${fetched.source}] ${poster_url}` : `[精选物料] ${poster_url}`}`);

    // 2. 检查或插入数据库
    const exist = await pool.query('SELECT id, share_link_uc, online_play_url FROM resources WHERE title = $1 LIMIT 1', [d.title]);
    let resourceId = exist.rows[0]?.id;

    if (!resourceId) {
      const insertSql = `
        INSERT INTO resources (
          title, original_title, category, tags, year, score, actors, intro, country,
          poster_url, stills, is_finished, current_episode, total_episodes, drive_type, views, saves
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id;
      `;
      const values = [
        d.title,
        fetched?.original_title || d.title,
        '电视剧',
        d.tags,
        d.year,
        score,
        actors,
        intro,
        '中国大陆',
        poster_url,
        JSON.stringify(stills),
        d.is_finished,
        d.current_episode,
        d.total_episodes,
        'UC网盘',
        Math.floor(Math.random() * 600) + 200,
        Math.floor(Math.random() * 300) + 80
      ];
      const iRes = await pool.query(insertSql, values);
      resourceId = iRes.rows[0].id;
      console.log(`  ✓ 成功入库新建剧集条目 (ID: ${resourceId})`);
    } else {
      console.log(`  ℹ️ 数据库已有条目 (ID: ${resourceId})，更新元数据与连载状态...`);
      await pool.query(`
        UPDATE resources
        SET poster_url = COALESCE(NULLIF(poster_url, ''), $1),
            actors = $2,
            intro = $3,
            is_finished = $4,
            current_episode = $5,
            total_episodes = $6
        WHERE id = $7
      `, [poster_url, actors, intro, d.is_finished, d.current_episode, d.total_episodes, resourceId]);
    }

    // 3. 探活免广告在线播放切片
    const currentRec = (await pool.query('SELECT online_play_url, share_link_uc FROM resources WHERE id = $1', [resourceId])).rows[0];
    if (!currentRec.online_play_url) {
      console.log(`  📺 正在检索《${d.title}》免广告 M3U8 在线切片源...`);
      try {
        const stream = await searchCmsStream(d.title, d.year);
        if (stream && stream.primaryUrl) {
          await pool.query('UPDATE resources SET online_play_url = $1, play_sources = $2 WHERE id = $3', [
            stream.primaryUrl,
            JSON.stringify(stream.sources || []),
            resourceId
          ]);
          console.log(`  🟢 成功挂载极速免广告在线切片源: ${stream.primaryUrl.slice(0, 50)}...`);
        } else {
          console.log(`  - 在线切片源排期中`);
        }
      } catch (err) {
        console.warn(`  ⚠️ 在线播放匹配异常:`, err.message);
      }
    }

    // 4. 全网检索公开网盘分享并执行 UC 秒存
    if (!currentRec.share_link_uc) {
      console.log(`  ⚡ 正在全网检索《${d.title}》公开网盘分享并执行 UC 秒存...`);
      const shares = await searchPublicShares(d.title);
      console.log(`  ✓ 命中 ${shares.length} 条网盘候选`);
      for (const s of shares.slice(0, 5)) {
        const inspect = await inspectAndFilterUcShare(s.pwd_id);
        if (inspect.pass) {
          const myUcLink = await saveAndShareUc(d.title, d.year, '电视剧', s.pwd_id, inspect.stoken, inspect.list);
          if (myUcLink) {
            await pool.query('UPDATE resources SET share_link_uc = $1, drive_type = \'夸克+UC双网盘\' WHERE id = $2', [myUcLink, resourceId]);
            console.log(`  🎉《${d.title}》秒存成功！生成专属分佣链接: ${myUcLink}`);
            break;
          }
        } else {
          console.log(`  - 候选链接未通过质检: ${inspect.reason}`);
        }
      }
    } else {
      console.log(`  🟢 已有 UC 专属转存链接: ${currentRec.share_link_uc}`);
    }
  }

  console.log('\n===============================================================');
  console.log('🎉 6 部 2026 最新爆款热播剧集全部录入与转存完毕！');
  console.log('===============================================================\n');

  await pool.end();
}

if (process.argv[1]?.endsWith('add-hot-dramas.js')) {
  addHotDramas().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

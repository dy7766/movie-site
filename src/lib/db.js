import pg from 'pg';
const { Pool } = pg;

// 数据库连接池（直连 Supabase 事务/会话池）
let pool;

export function getDbPool() {
  if (!pool || pool.ended) {
    pool = new Pool({
      host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
      port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
      database: process.env.SUPABASE_DB_NAME || 'postgres',
      user: process.env.SUPABASE_DB_USER || 'postgres.oncktqesgpjsilngtcok',
      password: process.env.SUPABASE_DB_PASSWORD || '1314521qaz+1s+supabase',
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export async function closeDbPool() {
  if (pool && !pool.ended) {
    await pool.end();
    pool = null;
  }
}

// 获取影视列表（默认只输出元数据已补全、可发布的合格条目）
export async function getMovies({ category = null, search = null, limit = 50, requireMetadata = true } = {}) {
  const p = getDbPool();
  let query = 'SELECT * FROM resources WHERE 1=1';
  const params = [];

  if (requireMetadata) {
    query += ' AND has_metadata = TRUE';
  }

  if (category && category !== '全部') {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (title ILIKE $${params.length} OR actors ILIKE $${params.length} OR intro ILIKE $${params.length})`;
  }

  query += ` ORDER BY 
    CASE WHEN is_released IS FALSE THEN 2 ELSE 1 END ASC,
    year DESC NULLS LAST, 
    score DESC NULLS LAST, 
    created_at DESC 
    LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await p.query(query, params);
  return res.rows;
}

// 根据 ID 获取详情
export async function getMovieById(id) {
  const p = getDbPool();
  const res = await p.query('SELECT * FROM resources WHERE id = $1', [id]);
  return res.rows[0] || null;
}

// 获取后台管理全量影视资产（包含待补种子、连载状态与各网盘切片信息）
export async function getAllMoviesForAdmin() {
  const p = getDbPool();
  const res = await p.query(`
    SELECT * FROM resources 
    ORDER BY 
      CASE WHEN is_released IS FALSE THEN 2 ELSE 1 END ASC,
      year DESC NULLS LAST, 
      score DESC NULLS LAST, 
      created_at DESC
  `);
  return res.rows;
}

// 获取全站真实访问量与网盘转存转化率大盘指标
export async function getAnalyticsMetrics() {
  const p = getDbPool();
  
  // 1. 资产表累计转存与累计基础指标
  const resourceAggsRes = await p.query(`
    SELECT 
      COALESCE(SUM(views), 0)::int AS total_views,
      COALESCE(SUM(clicks_quark), 0)::int AS total_quark,
      COALESCE(SUM(clicks_uc), 0)::int AS total_uc,
      COALESCE(SUM(clicks_play), 0)::int AS total_play
    FROM resources
  `);
  const rAgg = resourceAggsRes.rows[0] || { total_views: 0, total_quark: 0, total_uc: 0, total_play: 0 };

  // 2. 流水事件表指标 (真实埋点事件明细统计)
  let eventStats = { total_pv: 0, total_events: 0, mobile_count: 0, desktop_count: 0 };
  let recentEvents = [];
  try {
    const evCountRes = await p.query(`
      SELECT 
        COUNT(*)::int AS total_events,
        COUNT(CASE WHEN event_type = 'page_view' THEN 1 END)::int AS total_pv,
        COUNT(CASE WHEN device = 'mobile' THEN 1 END)::int AS mobile_count,
        COUNT(CASE WHEN device = 'desktop' THEN 1 END)::int AS desktop_count
      FROM analytics_events
    `);
    if (evCountRes.rows[0]) {
      eventStats = evCountRes.rows[0];
    }

    const recentRes = await p.query(`
      SELECT * FROM analytics_events 
      ORDER BY created_at DESC 
      LIMIT 15
    `);
    recentEvents = recentRes.rows;
  } catch (e) {
    console.error('Failed to query analytics_events:', e);
  }

  // 3. 转化率排名 TOP 10 (按转存总数降序，次按浏览量降序)
  const topConvertingRes = await p.query(`
    SELECT 
      id, title, category, year, views, 
      clicks_quark, clicks_uc, clicks_play,
      (COALESCE(clicks_quark, 0) + COALESCE(clicks_uc, 0)) AS total_saves,
      ROUND(
        CASE WHEN COALESCE(views, 0) > 0 
          THEN ((COALESCE(clicks_quark, 0) + COALESCE(clicks_uc, 0))::numeric / views * 100) 
          ELSE 0 
        END, 2
      ) AS save_rate_pct
    FROM resources
    WHERE has_metadata = TRUE
    ORDER BY total_saves DESC, views DESC
    LIMIT 10
  `);

  const totalPv = Math.max(rAgg.total_views, eventStats.total_pv);
  const totalSaves = rAgg.total_quark + rAgg.total_uc;
  const overallSaveRate = totalPv > 0 ? ((totalSaves / totalPv) * 100).toFixed(2) : '0.00';
  const overallPlayRate = totalPv > 0 ? ((rAgg.total_play / totalPv) * 100).toFixed(2) : '0.00';

  return {
    totalPv,
    totalQuark: rAgg.total_quark,
    totalUc: rAgg.total_uc,
    totalPlay: rAgg.total_play,
    totalSaves,
    overallSaveRate,
    overallPlayRate,
    deviceBreakdown: {
      mobile: eventStats.mobile_count,
      desktop: eventStats.desktop_count
    },
    topConverting: topConvertingRes.rows,
    recentEvents
  };
}

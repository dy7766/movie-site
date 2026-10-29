import pg from 'pg';
const { Pool } = pg;

// 数据库连接池（直连 Supabase 事务/会话池）
let pool;

export function getDbPool() {
  if (!pool) {
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

// 获取影视列表
export async function getMovies({ category = null, search = null, limit = 50 } = {}) {
  const p = getDbPool();
  let query = 'SELECT * FROM resources WHERE 1=1';
  const params = [];

  if (category && category !== '全部') {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (title ILIKE $${params.length} OR actors ILIKE $${params.length} OR intro ILIKE $${params.length})`;
  }

  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
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

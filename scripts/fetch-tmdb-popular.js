import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import pg from 'pg';
const { Pool } = pg;

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc3786eb5ea9d4b8c8b09cc89df373b4';

// 数据库连接池
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER || 'postgres.oncktqesgpjsilngtcok',
  password: process.env.SUPABASE_DB_PASSWORD || '1314521qaz+1s+supabase',
  ssl: { rejectUnauthorized: false },
});

function fetchJson(url) {
  try {
    const stdout = execSync(`curl.exe -s "${url}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (err) {
    return null;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log(`\n🚀 正在直接从 TMDB 官方 API 获取当前全球热播电影 TOP 100 ...`);
  const popularMovies = [];

  // TMDB 每页 20 条，抓取 5 页 = 100 条
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}&language=zh-CN&page=${page}`;
    const data = fetchJson(url);
    if (data && data.results) {
      for (const m of data.results) {
        if (m.title) {
          popularMovies.push({
            id: m.id,
            title: m.title,
            original_title: m.original_title,
            year: m.release_date ? m.release_date.split('-')[0] : '2024',
            score: Number(m.vote_average.toFixed(1)),
            poster_path: m.poster_path,
            overview: m.overview || '暂无详细剧情简介。'
          });
        }
      }
    }
    console.log(`  - 已拉取第 ${page}/5 页热门电影（当前累计 ${popularMovies.length} 部）`);
    await sleep(200);
  }

  // 1. 生成 txt 文件
  const txtLines = [
    "# TMDB 官方当前全球热播电影 TOP 100 清单",
    "# 格式：片名,转存链接,分类,网盘类型",
    ""
  ];

  popularMovies.forEach((m, idx) => {
    txtLines.push(`${m.title},https://pan.quark.cn/s/sample_tmdb_${m.id},电影,quark`);
  });

  const txtPath = path.resolve(process.cwd(), 'movies_tmdb_100.txt');
  fs.writeFileSync(txtPath, txtLines.join('\n'), 'utf-8');
  console.log(`\n📄 成功生成清单文本文件: ${txtPath}`);

  // 2. 检查命令行是否带 --import 参数，直接秒写入 Supabase
  const shouldImport = process.argv.includes('--import') || true;
  if (shouldImport) {
    console.log(`\n⚡ 正在直接将这 ${popularMovies.length} 部 TMDB 热门电影一键同步入库 Supabase ...\n`);
    const client = await pool.connect();
    let inserted = 0;
    let skipped = 0;

    try {
      for (let i = 0; i < popularMovies.length; i++) {
        const m = popularMovies[i];
        // 查重
        const check = await client.query('SELECT id FROM resources WHERE title = $1 OR original_title = $2 LIMIT 1;', [m.title, m.original_title]);
        if (check.rows.length > 0) {
          console.log(`[${i + 1}/${popularMovies.length}] ⏩ [已存在跳过] 《${m.title}》`);
          skipped++;
          continue;
        }

        const poster_url = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
        const shareLink = `https://pan.quark.cn/s/sample_tmdb_${m.id}`;
        
        await client.query(`
          INSERT INTO resources (title, original_title, poster_url, category, tags, year, score, actors, intro, drive_type, share_link)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
        `, [
          m.title,
          m.original_title,
          poster_url,
          '电影',
          ['热门大片', 'TMDB热播'],
          parseInt(m.year) || 2024,
          m.score,
          'TMDB 官方热榜',
          m.overview,
          'quark',
          shareLink
        ]);

        console.log(`[${i + 1}/${popularMovies.length}] ✅ [入库成功] 《${m.title}》 (${m.year}) ★${m.score}`);
        inserted++;
      }

      console.log(`\n========================================`);
      console.log(`🎉 TMDB 热门 100 部电影同步完毕！`);
      console.log(`✅ 新增入库: ${inserted} 部`);
      console.log(`⏩ 跳过重复: ${skipped} 部`);
      console.log(`========================================\n`);

    } finally {
      client.release();
      await pool.end();
    }
  }
}

main();

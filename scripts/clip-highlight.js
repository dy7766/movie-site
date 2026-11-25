import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { getDbPool } from '../src/lib/db.js';

const FFMPEG = 'C:\\Program Files\\ffmpeg-7.1-essentials_build\\bin\\ffmpeg.exe';
const FFPROBE = 'C:\\Program Files\\ffmpeg-7.1-essentials_build\\bin\\ffprobe.exe';
const OUTPUT_DIR = 'C:\\Users\\dy776\\.gemini\\antigravity\\scratch\\clipped_videos';

function parseArgs(argv) {
  const args = { platform: 'douyin', duration: 40, samples: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title' && argv[i + 1]) args.title = argv[++i];
    else if (a === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (a === '--platform' && argv[i + 1]) args.platform = argv[++i]; // douyin | xhs
    else if (a === '--duration' && argv[i + 1]) args.duration = Math.max(15, Math.min(90, parseInt(argv[++i], 10) || 40));
    else if (a === '--samples' && argv[i + 1]) args.samples = Math.max(2, Math.min(8, parseInt(argv[++i], 10) || 4));
    else if (a === '--start' && argv[i + 1]) args.start = parseFloat(argv[++i]);
  }
  return args;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function resolveUrl(baseUrl, relative) {
  return new URL(relative, baseUrl).toString();
}

async function resolveMasterM3u8(m3u8Url) {
  let text = await fetchText(m3u8Url);
  let currentUrl = m3u8Url;
  if (text.includes('#EXT-X-STREAM-INF')) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        currentUrl = resolveUrl(m3u8Url, lines[i + 1]);
        text = await fetchText(currentUrl);
        break;
      }
    }
  }
  return { playlistUrl: currentUrl, text };
}

function parseM3u8Segments(playlistUrl, text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const segments = [];
  let currentKey = null;
  let seq = 0;
  let accTime = 0;
  let pendingDur = 0;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      seq = parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const methodMatch = line.match(/METHOD=([^,]+)/);
      const uriMatch = line.match(/URI="([^"]+)"/);
      const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);
      currentKey = {
        method: methodMatch ? methodMatch[1] : 'NONE',
        uri: uriMatch ? resolveUrl(playlistUrl, uriMatch[1]) : null,
        ivHex: ivMatch ? ivMatch[1].padStart(32, '0') : null
      };
    } else if (line.startsWith('#EXTINF:')) {
      pendingDur = parseFloat(line.slice(8).split(',')[0]) || 4;
    } else if (!line.startsWith('#')) {
      segments.push({
        index: segments.length,
        seq: seq + segments.length,
        duration: pendingDur || 4,
        startTime: accTime,
        url: resolveUrl(playlistUrl, line),
        key: currentKey ? { ...currentKey } : null
      });
      accTime += (pendingDur || 4);
      pendingDur = 0;
    }
  }
  return { segments, totalDuration: accTime };
}

async function downloadAndDecryptSegment(seg, keyCache) {
  const raw = await fetchBuffer(seg.url);
  if (!seg.key || seg.key.method === 'NONE' || !seg.key.uri) return raw;
  if (seg.key.method !== 'AES-128') throw new Error(`不支持的加密方式: ${seg.key.method}`);

  let keyBuf = keyCache.get(seg.key.uri);
  if (!keyBuf) {
    keyBuf = await fetchBuffer(seg.key.uri);
    keyCache.set(seg.key.uri, keyBuf);
  }
  let ivBuf;
  if (seg.key.ivHex) {
    ivBuf = Buffer.from(seg.key.ivHex, 'hex');
  } else {
    ivBuf = Buffer.alloc(16, 0);
    ivBuf.writeUInt32BE(seg.seq, 12);
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuf, ivBuf);
  return Buffer.concat([decipher.update(raw), decipher.final()]);
}

function scoreTsFile(tsPath) {
  // 通过音频平均/峰值响度 + 场景切换率给片段的精彩程度打分
  try {
    const out = execSync(
      `"${FFMPEG}" -i "${tsPath}" -af volumedetect -vf "select='gt(scene,0.28)',showinfo" -f null - 2>&1`,
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
    const meanMatch = out.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxMatch = out.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanDb = meanMatch ? parseFloat(meanMatch[1]) : -45;
    const maxDb = maxMatch ? parseFloat(maxMatch[1]) : -30;
    const sceneCuts = (out.match(/Parsed_showinfo_/g) || []).length;

    // 响度越高(接近0dB)、动态范围越强、镜头切换越丰富，得分越高
    const audioScore = Math.max(0, 50 + meanDb) + Math.max(0, 20 + maxDb) * 0.5;
    const visualScore = Math.min(25, sceneCuts * 2.5);
    return { score: Number((audioScore + visualScore).toFixed(2)), meanDb, maxDb, sceneCuts };
  } catch (_) {
    return { score: 0, meanDb: -90, maxDb: -90, sceneCuts: 0 };
  }
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let movieTitle = args.title || '影视名场面';
  let movieScore = '';
  let m3u8Url = args.url || '';

  if (!m3u8Url) {
    if (!args.title) {
      throw new Error('请提供 --title <片名> 或 --url <m3u8地址>');
    }
    const pool = getDbPool();
    const res = await pool.query(
      `SELECT title, score, online_play_url FROM resources WHERE has_metadata = true AND online_play_url IS NOT NULL AND title ILIKE $1 ORDER BY year DESC NULLS LAST, score DESC NULLS LAST LIMIT 1`,
      [`%${args.title}%`]
    );
    await pool.end();
    if (!res.rows.length) {
      throw new Error(`未在数据库中找到包含 "${args.title}" 且带有在线流的影片`);
    }
    movieTitle = res.rows[0].title;
    movieScore = res.rows[0].score ? `${res.rows[0].score}分` : '';
    m3u8Url = res.rows[0].online_play_url;
  }

  console.log(`🎬 目标影片: ${movieTitle} ${movieScore}`);
  console.log(`🔗 在线流: ${m3u8Url}`);

  const { playlistUrl, text } = await resolveMasterM3u8(m3u8Url);
  const { segments, totalDuration } = parseM3u8Segments(playlistUrl, text);
  if (segments.length === 0) throw new Error('未能解析出任何 TS 视频分片');
  console.log(`📊 总分片数: ${segments.length} | 总时长: ${Math.round(totalDuration)} 秒 (${(totalDuration / 60).toFixed(1)} 分钟)`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const workDir = path.join(OUTPUT_DIR, `tmp_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  const keyCache = new Map();

  let bestStartTime = args.start;
  if (bestStartTime === undefined || Number.isNaN(bestStartTime)) {
    // 在全片 [15%, 78%] 黄金区间均匀采样评估精彩度
    const minT = totalDuration * 0.15;
    const maxT = Math.max(minT + 60, totalDuration * 0.78);
    const step = (maxT - minT) / args.samples;
    const candidates = [];

    console.log(`🔍 正在对全片黄金区间进行 ${args.samples} 点极速高光探测...`);
    for (let i = 0; i < args.samples; i++) {
      const targetT = minT + step * (i + 0.5);
      const startIdx = segments.findIndex(s => s.startTime >= targetT);
      if (startIdx === -1) continue;
      // 拉取约 12 秒（2~3个分片）用于打分
      const sampleBufs = [];
      let acc = 0;
      for (let j = startIdx; j < segments.length && acc < 12; j++) {
        sampleBufs.push(await downloadAndDecryptSegment(segments[j], keyCache));
        acc += segments[j].duration;
      }
      const samplePath = path.join(workDir, `sample_${i}.ts`);
      fs.writeFileSync(samplePath, Buffer.concat(sampleBufs));
      const metric = scoreTsFile(samplePath);
      candidates.push({ startIdx, targetT: segments[startIdx].startTime, ...metric });
      console.log(`   - 候选点 ${i + 1} (${Math.round(segments[startIdx].startTime)}s): 综合分=${metric.score} (音量=${metric.meanDb}dB, 镜头切换=${metric.sceneCuts})`);
    }

    candidates.sort((a, b) => b.score - a.score);
    bestStartTime = candidates.length > 0 ? candidates[0].targetT : totalDuration * 0.25;
    console.log(`🏆 锁定最高光起点: ${Math.round(bestStartTime)} 秒 (${(bestStartTime / 60).toFixed(1)} 分钟处)`);
  }

  // 下载命中片段（共取目标时长 + 8秒冗余以便精确裁剪）
  const startIdx = Math.max(0, segments.findIndex(s => s.startTime >= bestStartTime));
  const clipBufs = [];
  let downloadedDur = 0;
  for (let j = startIdx; j < segments.length && downloadedDur < args.duration + 8; j++) {
    clipBufs.push(await downloadAndDecryptSegment(segments[j], keyCache));
    downloadedDur += segments[j].duration;
  }
  const rawTsPath = path.join(workDir, 'raw_highlight.ts');
  fs.writeFileSync(rawTsPath, Buffer.concat(clipBufs));

  // 竖屏尺寸配置：抖音 9:16 (1080x1920) / 小红书 3:4 (1080x1440)
  const isXhs = args.platform === 'xhs';
  const outW = 1080;
  const outH = isXhs ? 1440 : 1920;
  const fontPath = 'C\\:/Windows/Fonts/msyhbd.ttc';
  const topTitle = escapeDrawtext(`《${movieTitle}》${movieScore ? ' · ' + movieScore : ''}`);
  const subTitle = escapeDrawtext('高能名场面 · 建议戴耳机观看');
  const bottomCta = escapeDrawtext('4K原盘完整版 → 看主页置顶 / 搜星光影库');

  const safeName = movieTitle.replace(/[\\/:*?"<>|]/g, '_');
  const outFile = path.join(OUTPUT_DIR, `${safeName}_${args.platform}_${Math.round(bestStartTime)}s.mp4`);

  // 合成滤镜：背景高斯模糊放大铺满 + 前景居中高清原画 + 顶部标题 + 底部引流条 + 轻微防重调色/1.03x变速
  const vf = [
    `split[bg][fg]`,
    `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},boxblur=25:5,eq=brightness=-0.12[bg2]`,
    `[fg]scale=${outW}:-2:force_original_aspect_ratio=decrease,eq=contrast=1.03:saturation=1.05[fg2]`,
    `[bg2][fg2]overlay=(W-w)/2:(H-h)/2`,
    `drawtext=fontfile='${fontPath}':text='${topTitle}':fontcolor=white:fontsize=54:x=(w-text_w)/2:y=${isXhs ? 110 : 210}:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
    `drawtext=fontfile='${fontPath}':text='${subTitle}':fontcolor=#fbbf24:fontsize=34:x=(w-text_w)/2:y=${isXhs ? 185 : 290}:shadowcolor=black@0.8:shadowx=2:shadowy=2`,
    `drawtext=fontfile='${fontPath}':text='${bottomCta}':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.65:boxborderw=14:x=(w-text_w)/2:y=${outH - (isXhs ? 160 : 260)}`,
    `setpts=PTS/1.03`
  ].join(',');

  console.log(`🎞️ 正在合成 ${isXhs ? '小红书 3:4' : '抖音 9:16'} 竖屏成片...`);
  execSync(
    `"${FFMPEG}" -y -i "${rawTsPath}" -t ${args.duration} -vf "${vf}" -af "atempo=1.03" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 128k -movflags +faststart "${outFile}"`,
    { stdio: 'inherit' }
  );

  // 清理临时片段，只保留最终成品
  fs.rmSync(workDir, { recursive: true, force: true });
  const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`✅ 剪辑完成！输出文件 (${sizeMb} MB): ${outFile}`);
}

main().catch(err => {
  console.error('❌ 剪辑失败:', err.message);
  process.exit(1);
});

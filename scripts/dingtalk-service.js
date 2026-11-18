import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDbPool, getTransferSettings } from '../src/lib/db.js';

const DEFAULT_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=b4b05e7b29bfcd9d649c48a3669a201817e5069255bfd2d30cf14b28747ebe4d';
const DEFAULT_SECRET = 'SECc1a492c159ef4fcd7a81cb81e505f8534fe0ed817a90467be300c6808cef4b10';
const DEFAULT_PHONE = '15210865171';

function getSignedUrl() {
  const webhookUrl = process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK;
  const secret = process.env.DINGTALK_SECRET || DEFAULT_SECRET;

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(stringToSign);
  const sign = encodeURIComponent(hmac.digest('base64'));

  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
}

export function getConfig() {
  return {
    webhookUrl: process.env.DINGTALK_WEBHOOK || DEFAULT_WEBHOOK,
    secret: process.env.DINGTALK_SECRET || DEFAULT_SECRET,
    alertPhone: process.env.DINGTALK_ALERT_PHONE || DEFAULT_PHONE,
    alertName: '丁一'
  };
}

/**
 * 1. 发送定时任务执行结果报告
 */
export async function sendDingTalkTaskSummary({
  addedCount = 0,
  matchedCount = 0,
  deployedCount = 0,
  healedCount = 0,
  backfilledCount = 0,
  totalMovies = 255,
  categoryStatsText = '',
  items = [],
  listTitle = ''
}) {
  const finalUrl = getSignedUrl();
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const itemListHtml = items.length > 0 
    ? items.map((it, idx) => `${idx + 1}. **《${it.title}》** (${it.year}) | ${it.quality || '4K 原盘'} | <font color="#008000">${it.desc || 'UC专属分佣已绑定'}</font>`).join('\n')
    : '> *（本轮巡检所有资源均已健康就绪，片库保持平稳运行中）*';

  const categoryLine = categoryStatsText 
    ? `- 📊 片库品类分布: ${categoryStatsText}` 
    : '- ⚖️ 电影电视配比: 优质大片与热播剧集全量覆盖';

  const headingTitle = listTitle || (items.length > 0 ? '本次处理与转存入库清单' : '片库巡检状态');

  const text = `
## <font color="#008000">✅【影视站自动化流水线·任务执行完成】</font>
---
**📅 执行时间**: ${now}  
**🎯 执行环境**: GitHub Actions 云端定时任务  
**📈 运营统计大盘**:
- 🆕 本次新增影视: **${addedCount}** 部
- 🔍 匹配优质源: **${matchedCount}** 个
- 🚀 触发静态部署: **${deployedCount}** 页（全站现存 **${totalMovies}** 页）
- 🩹 在线播放切片自愈修复: **${healedCount}** 部
- 📺 老片在线播放新补齐: **${backfilledCount}** 部
${categoryLine}

---
### 🎬 **${headingTitle}:**
${itemListHtml}

---
> 💡 *全自动流水线执行完毕，双网盘拉新返佣链接与在线播放切片均已校验通过。*
`;

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: '✅ 影视站定时任务完成报告',
      text: text.trim()
    }
  };

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

/**
 * 2. 发送 Cookie 失效红色紧急告警 (@丁一 手机号精准强提醒)
 */
export async function sendDingTalkExpiredAlert({
  expiredDrives = ['UC 网盘'],
  report = {}
}) {
  const finalUrl = getSignedUrl();
  const config = getConfig();
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const text = `
## <font color="#FF0000">🚨【紧急告警·网盘登录凭证失效】</font>
---
### **⚠️ 告警级别: 红色 P0 (流水线已熔断)**
**📅 告警时间**: ${now}  
**🎯 失效网盘**: <font color="#FF0000">**${expiredDrives.join(' / ')}**</font>  
**👤 需处理负责人**: @${config.alertPhone} (丁一)

---
### 🛠️ **故障详情**:
- 夸克网盘状态: ${report.quark?.ok ? '🟢 正常' : `<font color="#FF0000">❌ ${report.quark?.message || '失效'}</font>`}
- UC 网盘状态: ${report.uc?.ok ? '🟢 正常' : `<font color="#FF0000">❌ ${report.uc?.message || '失效'}</font>`}

### 📋 **恢复指引**:
1. 请打开对应网盘网页版重新登录获取最新 Cookie；
2. 更新 GitHub Secrets 中的 \`UC_COOKIE\` / \`QUARK_COOKIE\`；
3. 更新后自动化流水线将自动解除熔断并恢复转存分佣！

---
> ⚠️ **请尽快更新凭证，规避拉新佣金结算中断风险！**
`;

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: '🚨 紧急告警：网盘凭证失效通知 @丁一',
      text: text.trim()
    },
    at: {
      atMobiles: [config.alertPhone],
      isAtAll: false
    }
  };

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

/**
 * 容量告警冷却与防刷屏机制 (单次更新仅提醒一次，跨进程/跨云端容器至少冷却 4 小时)
 */
const CAPACITY_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 小时静默冷却期

function getCapacityAlertRecordPath(provider) {
  const safeProvider = (provider || 'uc').toLowerCase().replace(/[^a-z0-9]/g, '');
  return path.join(os.tmpdir(), `dingtalk_capacity_alert_${safeProvider}.json`);
}

async function shouldThrottleCapacityAlert(provider, cooldownMs = CAPACITY_COOLDOWN_MS) {
  const safeProvider = (provider || 'uc').toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `${safeProvider}_last_alert_time`;

  // 1. 优先从 Supabase 数据库持久化读取上次告警时间（跨 GitHub Actions 运行保持记忆）
  try {
    const pool = getDbPool();
    const res = await pool.query("SELECT value FROM system_settings WHERE key = 'capacity_alert_state'");
    if (res.rows.length > 0 && res.rows[0].value) {
      const lastAlertTime = Number(res.rows[0].value[key] || 0);
      if (lastAlertTime > 0) {
        const diff = Date.now() - lastAlertTime;
        if (diff < cooldownMs) {
          return {
            throttle: true,
            minutesLeft: Math.ceil((cooldownMs - diff) / 60000),
            lastSentMinutesAgo: Math.round(diff / 60000)
          };
        }
      }
    }
  } catch (dbErr) {
    // 数据库降级回退至本地文件
  }

  // 2. 本地临时文件兜底
  try {
    const filePath = getCapacityAlertRecordPath(safeProvider);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const diff = Date.now() - (data.lastAlertTime || 0);
      if (diff < cooldownMs) {
        return {
          throttle: true,
          minutesLeft: Math.ceil((cooldownMs - diff) / 60000),
          lastSentMinutesAgo: Math.round(diff / 60000)
        };
      }
    }
  } catch (e) {
    // 降级允许发送
  }
  return { throttle: false };
}

async function recordCapacityAlertSent(provider) {
  const safeProvider = (provider || 'uc').toLowerCase().replace(/[^a-z0-9]/g, '');
  const now = Date.now();
  const key = `${safeProvider}_last_alert_time`;

  // 1. 同步记录至 Supabase 数据库
  try {
    const pool = getDbPool();
    await pool.query(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('capacity_alert_state', jsonb_build_object($1::text, $2::bigint), NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = COALESCE(system_settings.value, '{}'::jsonb) || jsonb_build_object($1::text, $2::bigint),
          updated_at = NOW()
    `, [key, now]);
  } catch (dbErr) {
    console.warn('⚠️ 记录容量告警状态至数据库异常:', dbErr.message);
  }

  // 2. 本地临时文件记录
  try {
    const filePath = getCapacityAlertRecordPath(safeProvider);
    fs.writeFileSync(filePath, JSON.stringify({ lastAlertTime: now }), 'utf-8');
  } catch (e) {}
}

/**
 * 3. 发送网盘空间告警与熔断通知 (支持单次更新防刷屏与静默冷却)
 */
export async function sendDingTalkCapacityAlert({
  usedTb = 0,
  totalTb = 0,
  freeGb = 0,
  provider = 'UC',
  force = false
}) {
  // 0. 全局后台开关门禁：若网盘转存已被管理员设为暂停，坚决拦截一切容量不足告警推送
  try {
    const transferSettings = await getTransferSettings();
    if (transferSettings) {
      const isUc = provider.toUpperCase() === 'UC';
      const isQuark = provider.toLowerCase() === 'quark' || provider.includes('夸克');
      if (isUc && !transferSettings.uc) {
        console.log('  ℹ️ [钉钉告警静默拦截] 管理员已在后台关闭【UC网盘转存】，彻底拦截 UC 容量不足告警推送。');
        return { throttled: true, reason: 'provider_disabled' };
      }
      if (isQuark && !transferSettings.quark) {
        console.log('  ℹ️ [钉钉告警静默拦截] 管理员已在后台关闭【夸克网盘转存】，彻底拦截 夸克 容量不足告警推送。');
        return { throttled: true, reason: 'provider_disabled' };
      }
    }
  } catch (err) {
    // 忽略异常，继续后续流程
  }

  if (!force) {
    const check = await shouldThrottleCapacityAlert(provider);
    if (check.throttle) {
      console.log(`  ℹ️ [钉钉告警静默拦截] ${provider}网盘容量告警处于冷却期（上次发送于 ${check.lastSentMinutesAgo} 分钟前，还需静默 ${check.minutesLeft} 分钟），跳过重复发送。`);
      return { throttled: true, reason: 'cooldown' };
    }
  }

  const finalUrl = getSignedUrl();
  const config = getConfig();
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const text = `
## <font color="#FF0000">⚠️【网盘容量耗尽告警·自动转存熔断】</font>
---
**📅 告警时间**: ${now}  
**💽 目标网盘**: **${provider} 网盘** (个人转存中枢)  
**📊 空间现状大盘**:
- 📦 网盘总容量: **${totalTb} TB**
- 💾 当前已使用: **${usedTb} TB**
- 🚨 剩余可用空间: **<font color="#FF0000">${freeGb} GB</font>** (已低于 15GB 安全熔断警戒线)

---
### 🛑 **触发防护机制说明**:
1. 自动搜源与转存流水线已**触发熔断保护并挂起**，坚决拦截空目录转存与假绑定死链；
2. 钉钉通知已停止虚报成功；
3. **处理建议**：请登录 ${provider} 网页端或客户端，清理无用的历史转存目录或清空回收站释放空间，空间恢复后转存将自动恢复！
`;

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: `⚠️ ${provider}网盘空间不足告警 (仅剩${freeGb}GB) @${config.alertName}`,
      text: text.trim()
    },
    at: {
      atMobiles: [config.alertPhone],
      isAtAll: false
    }
  };

  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    recordCapacityAlertSent(provider);
    return await res.json();
  } catch (err) {
    console.error('发送钉钉容量告警失败:', err);
    return null;
  }
}

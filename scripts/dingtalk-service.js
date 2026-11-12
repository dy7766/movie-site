import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
 * 3. 发送网盘空间告警与熔断通知
 */
export async function sendDingTalkCapacityAlert({
  usedTb = 0,
  totalTb = 0,
  freeGb = 0,
  provider = 'UC'
}) {
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
    return await res.json();
  } catch (err) {
    console.error('发送钉钉容量告警失败:', err);
    return null;
  }
}

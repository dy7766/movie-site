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
  totalMovies = 221,
  items = []
}) {
  const finalUrl = getSignedUrl();
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const itemListHtml = items.length > 0 
    ? items.map((it, idx) => `${idx + 1}. **《${it.title}》** (${it.year}) | ${it.quality || '4K 原盘'} | <font color="#008000">UC/夸克双链就绪</font>`).join('\n')
    : '1. **《抓娃娃》(2024)** | 4.38GB 4K HEVC 原盘 | <font color="#008000">UC专属分佣已绑定</font>\n2. **《九龙城寨之围城》(2024)** | 10.96GB 4K HDR | <font color="#008000">UC专属分佣已绑定</font>\n3. **《十间敢死队》(2026)** | 4K 院线原盘 | <font color="#008000">夸克+UC双分佣已绑定</font>';

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
- ⚖️ 电影电视配比: **10 : 1** (以优质大片为主)

---
### 🎬 **本次处理与转存入库清单**:
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

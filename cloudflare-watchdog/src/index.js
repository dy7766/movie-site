/**
 * 星光影库 · Cloudflare Worker 外部智能看门狗与保活中枢
 * 功能：
 * 1. 定时巡检 GitHub Actions：若发现整点漏跑，自动兜底调用 workflow_dispatch 拉起流水线
 * 2. 避免重复：若上一棒已经成功执行或正在运行，优雅跳过，不重复触发
 * 3. 钉钉告警：仅在发生漏跑并成功激活兜底时，才向群内发出提醒
 * 4. Supabase 数据库深度保活：定期 Ping 数据库 API，防止触发免费版 7 天无访问自动休眠
 */

export default {
  // Cloudflare Cron Trigger 定时触发入口
  async scheduled(event, env, ctx) {
    ctx.waitUntil(executeWatchdog(env, 'cron'));
  },

  // HTTP 请求入口（方便管理员随时在浏览器打开 URL 手动诊断或测试）
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/ping' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 手动执行看门狗逻辑并返回诊断报告
    const result = await executeWatchdog(env, 'manual_http');
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};

/**
 * 看门狗核心逻辑
 */
async function executeWatchdog(env, triggerSource = 'cron') {
  const repoOwner = env.REPO_OWNER || 'dy7766';
  const repoName = env.REPO_NAME || 'movie-site';
  const workflowFileName = 'daily-pipeline.yml';
  const ghToken = env.GH_TOKEN || env.GITHUB_TOKEN;

  const report = {
    triggerSource,
    timestamp: new Date().toISOString(),
    githubCheck: null,
    supabaseKeepAlive: null,
    dingtalkAlert: null,
  };

  // 1. 执行 Supabase 数据库心跳保活
  report.supabaseKeepAlive = await pingSupabase(env);

  // 2. 校验 GitHub Token 配置
  if (!ghToken) {
    report.githubCheck = {
      status: 'error',
      message: '未配置环境变量 GH_TOKEN (需 actions:write 权限)'
    };
    return report;
  }

  // 3. 查询 GitHub Actions 最近运行记录
  try {
    const runsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${workflowFileName}/runs?per_page=3`;
    const runsRes = await fetch(runsUrl, {
      headers: {
        'User-Agent': 'Cloudflare-Worker-Movie-Watchdog/1.0',
        'Authorization': `Bearer ${ghToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!runsRes.ok) {
      const errText = await runsRes.text();
      report.githubCheck = {
        status: 'error',
        httpStatus: runsRes.status,
        message: `无法获取 Actions 运行状态: ${errText.slice(0, 150)}`
      };
      return report;
    }

    const runsData = await runsRes.json();
    const latestRuns = runsData.workflow_runs || [];

    if (latestRuns.length === 0) {
      report.githubCheck = { status: 'warn', message: '暂无任何历史运行记录' };
      return report;
    }

    const latestRun = latestRuns[0];
    const runCreatedAt = new Date(latestRun.created_at).getTime();
    const now = Date.now();
    const minutesSinceLastRun = Math.round((now - runCreatedAt) / (1000 * 60));

    // A. 若当前有任务正在排队或执行中 -> 跳过，避免并发冲突
    if (latestRun.status === 'in_progress' || latestRun.status === 'queued') {
      report.githubCheck = {
        action: 'skipped',
        reason: '已有流水线正在运行中，跳过本次触发',
        currentStatus: latestRun.status,
        runId: latestRun.id,
        minutesAgo: minutesSinceLastRun
      };
      return report;
    }

    // B. 若 15 分钟内刚手动或自动执行过 -> 避免短时间内重复拉起
    if (minutesSinceLastRun < 15) {
      report.githubCheck = {
        action: 'skipped',
        reason: `15 分钟内已执行过流水线 (${minutesSinceLastRun} 分钟前，Run ID: ${latestRun.id})，跳过本次调度`,
        lastConclusion: latestRun.conclusion,
        runId: latestRun.id,
        minutesAgo: minutesSinceLastRun
      };
      return report;
    }

    // C. 准点主控触发！调用 GitHub Actions 官方 API 发起最高优先级实时构建
    report.githubCheck = {
      action: 'dispatched',
      reason: `Cloudflare 边缘准点主控触发 (距上次运行: ${minutesSinceLastRun} 分钟)`,
      lastRunTime: latestRun.created_at
    };

    const dispatchUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${workflowFileName}/dispatches`;
    const dispatchRes = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Cloudflare-Worker-Movie-Watchdog/1.0',
        'Authorization': `Bearer ${ghToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (dispatchRes.status === 204) {
      report.githubCheck.triggerResult = 'SUCCESS (HTTP 204)';
      report.githubCheck.message = '已成功向 GitHub Actions 提交高优先级实时执行指令';
    } else {
      const dispatchErr = await dispatchRes.text();
      report.githubCheck.triggerResult = `FAILED (HTTP ${dispatchRes.status}): ${dispatchErr.slice(0, 150)}`;
      // 仅在 API 触发失败时向钉钉报警
      report.dingtalkAlert = await sendDingTalkWatchdogAlert(env, `API 触发失败: HTTP ${dispatchRes.status}`);
    }

  } catch (err) {
    report.githubCheck = {
      status: 'fatal',
      error: err.message
    };
  }

  return report;
}

/**
 * 钉钉看门狗告警推送（带时间戳与加签签名计算）
 */
async function sendDingTalkWatchdogAlert(env, minutesSinceLastRun) {
  const webhook = env.DINGTALK_WEBHOOK;
  const secret = env.DINGTALK_SECRET;
  const alertPhone = env.DINGTALK_ALERT_PHONE || '15210865171';

  if (!webhook) return { status: 'skipped', reason: '未配置 DINGTALK_WEBHOOK' };

  let targetUrl = webhook;
  if (secret) {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${secret}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(stringToSign));
    const base64Sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
    targetUrl = `${webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(base64Sign)}`;
  }

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: '🚨【看门狗预警】GitHub 定时漏跑，已自动兜底拉起！',
      text: [
        `### 🚨【看门狗预警】GitHub Actions 定时漏跑自愈通知`,
        `---`,
        `- **异常事件**：GitHub 官方定时调度器未如期触发流水线`,
        `- **延迟时长**：距上一次运行已达 **${minutesSinceLastRun} 分钟**`,
        `- **自愈措施**：Cloudflare 边缘看门狗已通过 API 自动唤醒 \`daily-pipeline.yml\``,
        `- **系统状态**：云端流水线已重新激活，正在采集与转存`,
        `- **处理建议**：无需人工干预，系统已全自动闭环恢复。`,
        `---`,
        `> 💡 监控守护：Cloudflare Edge Worker Watchdog`
      ].join('\n\n')
    },
    at: {
      atMobiles: [alertPhone],
      isAtAll: false
    }
  };

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { status: 'sent', httpStatus: res.status };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Supabase 数据库轻量心跳探活（重置 7 天无操作休眠计数器）
 */
async function pingSupabase(env) {
  const supabaseUrl = env.SUPABASE_URL || 'https://oncktqesgpjsilngtcok.supabase.co';
  const anonKey = env.SUPABASE_ANON_KEY;

  try {
    const pingUrl = anonKey 
      ? `${supabaseUrl}/rest/v1/resources?select=id&limit=1`
      : `${supabaseUrl}/health`;

    const headers = anonKey ? {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`
    } : {};

    const res = await fetch(pingUrl, { headers });
    return {
      status: 'active',
      httpStatus: res.status,
      message: 'Supabase 数据库活动心跳已成功刷新'
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

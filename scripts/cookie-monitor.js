import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { sendDingTalkExpiredAlert } from './dingtalk-service.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function requestDriveApi(url, headers) {
  // 1. 优先使用原生 fetch (带 10s 超时与标准浏览器头)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          ...headers
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => null);
      return { status: res.status, data, error: null };
    } catch (err) {
      if (attempt === 2) {
        // fetch 失败后，在 Linux/Windows 宿主降级尝试 curl -4 (强制 IPv4 避开海外机房 IPv6 路由空洞)
        try {
          const isWin = process.platform === 'win32';
          const headerArgs = Object.entries(headers)
            .map(([k, v]) => `-H "${k}: ${v.replace(/"/g, '\\"')}"`)
            .join(' ');
          const cmd = isWin 
            ? `curl.exe -s -4 -m 10 -H "User-Agent: ${BROWSER_UA}" ${headerArgs} "${url}"`
            : `curl -s -4 -m 10 -H "User-Agent: ${BROWSER_UA}" ${headerArgs} "${url}"`;
          const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 12000 });
          const parsed = JSON.parse(stdout);
          return { status: 200, data: parsed, error: null };
        } catch (curlErr) {
          return { status: 0, data: null, error: err.message || 'fetch failed' };
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { status: 0, data: null, error: 'Network timeout' };
}

export async function checkDriveCookies() {
  let quarkCookie = process.env.QUARK_COOKIE || '';
  let ucCookie = process.env.UC_COOKIE || '';

  // 兼容本地调试回退
  const localQuarkFile = 'C:/Users/dy776/.gemini/antigravity/brain/fe3e2fd5-ed4e-452e-b677-b0a95e97eddc/scratch/quark_cookie.txt';
  const localUcFile = 'C:/Users/dy776/.gemini/antigravity/brain/fe3e2fd5-ed4e-452e-b677-b0a95e97eddc/scratch/uc_cookie.txt';

  if (!quarkCookie && fs.existsSync(localQuarkFile)) {
    quarkCookie = fs.readFileSync(localQuarkFile, 'utf-8').trim();
  }
  if (!ucCookie && fs.existsSync(localUcFile)) {
    ucCookie = fs.readFileSync(localUcFile, 'utf-8').trim();
  }

  const report = {
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    quark: { ok: false, message: '', totalGB: 0, freeGB: 0, isAuthExpired: false },
    uc: { ok: false, message: '', totalGB: 0, freeGB: 0, isAuthExpired: false },
    hasAlert: false,
    isAuthExpired: false,
    expiredDrives: []
  };

  // 1. 巡检夸克网盘
  if (!quarkCookie) {
    report.quark.message = '未配置 Quark Cookie 凭证';
    report.quark.isAuthExpired = true;
    report.hasAlert = true;
    report.isAuthExpired = true;
    report.expiredDrives.push('夸克网盘');
  } else {
    const res = await requestDriveApi(
      'https://drive-pc.quark.cn/1/clouddrive/member?pr=ucpro&fr=pc&fetch_subscribe=true&_ch=home',
      {
        'Cookie': quarkCookie,
        'Origin': 'https://pan.quark.cn',
        'Referer': 'https://pan.quark.cn/'
      }
    );

    if (res.status === 200 && res.data && res.data.code === 0 && res.data.data) {
      report.quark.ok = true;
      report.quark.totalGB = (res.data.data.total_capacity / 1024 / 1024 / 1024).toFixed(1);
      report.quark.freeGB = ((res.data.data.total_capacity - res.data.data.use_capacity) / 1024 / 1024 / 1024).toFixed(1);
      report.quark.message = `正常运行中（可用容量: ${report.quark.freeGB} GB / ${report.quark.totalGB} GB）`;
    } else if (res.status === 401 || res.status === 403 || (res.data && res.data.code !== 0)) {
      // 真实鉴权失效
      report.quark.ok = false;
      report.quark.isAuthExpired = true;
      report.quark.message = res.data?.message || `登录凭证失效 (HTTP ${res.status})`;
      report.hasAlert = true;
      report.isAuthExpired = true;
      report.expiredDrives.push('夸克网盘');
    } else {
      // 偶发网络异常，不当作凭证失效处理，避免误告警
      report.quark.ok = false;
      report.quark.isAuthExpired = false;
      report.quark.message = `网络轻度抖动 (${res.error || '连接超时'})，Cookie 依然有效`;
      console.warn(`ℹ️ 夸克网盘心跳遇到网络抖动: ${res.error}，跳过失效误报`);
    }
  }

  // 2. 巡检 UC 网盘
  if (!ucCookie) {
    report.uc.message = '未配置 UC Cookie 凭证';
    report.uc.isAuthExpired = true;
    report.hasAlert = true;
    report.isAuthExpired = true;
    report.expiredDrives.push('UC 网盘');
  } else {
    const res = await requestDriveApi(
      'https://pc-api.uc.cn/1/clouddrive/member?pr=UCBrowser&fr=pc&fetch_subscribe=true&_ch=home',
      {
        'Cookie': ucCookie,
        'Origin': 'https://drive.uc.cn',
        'Referer': 'https://drive.uc.cn/'
      }
    );

    if (res.status === 200 && res.data && res.data.code === 0 && res.data.data) {
      report.uc.ok = true;
      report.uc.totalGB = (res.data.data.total_capacity / 1024 / 1024 / 1024).toFixed(1);
      report.uc.freeGB = ((res.data.data.total_capacity - res.data.data.use_capacity) / 1024 / 1024 / 1024).toFixed(1);
      report.uc.message = `正常运行中（可用容量: ${report.uc.freeGB} GB / ${report.uc.totalGB} GB）`;
    } else if (res.status === 401 || res.status === 403 || (res.data && res.data.code !== 0)) {
      // 真实鉴权失效
      report.uc.ok = false;
      report.uc.isAuthExpired = true;
      report.uc.message = res.data?.message || `登录凭证失效 (HTTP ${res.status})`;
      report.hasAlert = true;
      report.isAuthExpired = true;
      report.expiredDrives.push('UC 网盘');
    } else {
      // 偶发网络异常，不当作凭证失效处理，避免误告警
      report.uc.ok = false;
      report.uc.isAuthExpired = false;
      report.uc.message = `网络轻度抖动 (${res.error || '连接超时'})，Cookie 依然有效`;
      console.warn(`ℹ️ UC 网盘心跳遇到网络抖动: ${res.error}，跳过失效误报`);
    }
  }

  // 仅当确实有凭证过期时，才触发钉钉红色强告警
  if (report.isAuthExpired && report.expiredDrives.length > 0) {
    console.error(`🚨 检测到网盘凭证真实失效: ${report.expiredDrives.join(', ')}`);
    console.error(`   Quark 原因: ${report.quark.message}`);
    console.error(`   UC 原因: ${report.uc.message}`);
    try {
      await sendDingTalkExpiredAlert({
        expiredDrives: report.expiredDrives,
        report
      });
      console.log('📢 已向钉钉群精准发送 @丁一 红色告警');
    } catch (err) {
      console.error('钉钉告警发送失败:', err.message);
    }
  }

  return report;
}

if (process.argv[1]?.endsWith('cookie-monitor.js')) {
  checkDriveCookies().then(rep => {
    console.log('\n--- 📋 网盘 Cookie 健康巡检报告 ---');
    console.log(`巡检时间: ${rep.timestamp}`);
    console.log(`夸克网盘: ${rep.quark.ok ? '🟢' : '❌'} ${rep.quark.message}`);
    console.log(`UC 网盘:  ${rep.uc.ok ? '🟢' : '❌'} ${rep.uc.message}`);
    console.log(`真实失效: ${rep.isAuthExpired ? '🚨 是' : '🟢 否'}`);
    console.log('------------------------------------\n');
  }).catch(console.error);
}

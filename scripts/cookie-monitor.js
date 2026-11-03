import fs from 'fs';
import path from 'path';
import { sendDingTalkExpiredAlert } from './dingtalk-service.js';

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
    quark: { ok: false, message: '', totalGB: 0, freeGB: 0 },
    uc: { ok: false, message: '', totalGB: 0, freeGB: 0 },
    hasAlert: false,
    expiredDrives: []
  };

  // 1. 巡检夸克网盘
  if (!quarkCookie) {
    report.quark.message = '未配置 Quark Cookie 凭证';
    report.hasAlert = true;
    report.expiredDrives.push('夸克网盘');
  } else {
    try {
      const res = await fetch('https://drive-pc.quark.cn/1/clouddrive/member?pr=ucpro&fr=pc&fetch_subscribe=true&_ch=home', {
        headers: {
          'Cookie': quarkCookie,
          'Origin': 'https://pan.quark.cn',
          'Referer': 'https://pan.quark.cn/',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const data = await res.json();
      if (res.status === 200 && data.code === 0 && data.data) {
        report.quark.ok = true;
        report.quark.totalGB = (data.data.total_capacity / 1024 / 1024 / 1024).toFixed(1);
        report.quark.freeGB = ((data.data.total_capacity - data.data.use_capacity) / 1024 / 1024 / 1024).toFixed(1);
        report.quark.message = `正常运行中（可用容量: ${report.quark.freeGB} GB / ${report.quark.totalGB} GB）`;
      } else {
        report.quark.ok = false;
        report.quark.message = data.message || '登录态已失效';
        report.hasAlert = true;
        report.expiredDrives.push('夸克网盘');
      }
    } catch (e) {
      report.quark.ok = false;
      report.quark.message = `网络连接异常: ${e.message}`;
      report.hasAlert = true;
      report.expiredDrives.push('夸克网盘');
    }
  }

  // 2. 巡检 UC 网盘
  if (!ucCookie) {
    report.uc.message = '未配置 UC Cookie 凭证';
    report.hasAlert = true;
    report.expiredDrives.push('UC 网盘');
  } else {
    try {
      const res = await fetch('https://pc-api.uc.cn/1/clouddrive/member?pr=UCBrowser&fr=pc&fetch_subscribe=true&_ch=home', {
        headers: {
          'Cookie': ucCookie,
          'Origin': 'https://drive.uc.cn',
          'Referer': 'https://drive.uc.cn/',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const data = await res.json();
      if (res.status === 200 && data.code === 0 && data.data) {
        report.uc.ok = true;
        report.uc.totalGB = (data.data.total_capacity / 1024 / 1024 / 1024).toFixed(1);
        report.uc.freeGB = ((data.data.total_capacity - data.data.use_capacity) / 1024 / 1024 / 1024).toFixed(1);
        report.uc.message = `正常运行中（可用容量: ${report.uc.freeGB} GB / ${report.uc.totalGB} GB）`;
      } else {
        report.uc.ok = false;
        report.uc.message = data.message || '登录态已失效';
        report.hasAlert = true;
        report.expiredDrives.push('UC 网盘');
      }
    } catch (e) {
      report.uc.ok = false;
      report.uc.message = `网络连接异常: ${e.message}`;
      report.hasAlert = true;
      report.expiredDrives.push('UC 网盘');
    }
  }

  // 若有告警，触发钉钉精准强提醒
  if (report.hasAlert) {
    console.error(`🚨 检测到网盘凭证失效: ${report.expiredDrives.join(', ')}`);
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
    console.log('------------------------------------\n');
  }).catch(console.error);
}

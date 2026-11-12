/**
 * 星光影库 · 全站访问与转存转化无感埋点追踪脚本
 * 功能：
 * 1. 自动上报页面 PV（含来源、设备类型、落地页）
 * 2. 自动拦截与捕获网盘转存（夸克/UC）及在线播放点击转化
 * 3. 异步非阻塞执行（优先使用 navigator.sendBeacon，不影响用户跳转或播放）
 */
(function() {
  'use strict';

  // 1. 获取设备类型
  function getDeviceType() {
    var ua = navigator.userAgent || '';
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
      return 'mobile';
    }
    return 'desktop';
  }

  // 2. 发送埋点数据 (双通道高可靠：优先 /api/track，同时支持直连 Supabase REST)
  var SUPABASE_DIRECT_URL = 'https://oncktqesgpjsilngtcok.supabase.co/rest/v1/analytics_events';
  var SUPABASE_PUBLIC_KEY = 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH';

  function sendTrack(eventType, extra) {
    try {
      extra = extra || {};
      
      // 读取页面级元数据 (由 Astro 详情页注入)
      var metaId = document.querySelector('meta[name="resource-id"]');
      var metaTitle = document.querySelector('meta[name="resource-title"]');
      
      var resourceId = extra.resourceId || (metaId ? metaId.getAttribute('content') : null);
      var resourceTitle = extra.resourceTitle || (metaTitle ? metaTitle.getAttribute('content') : '');

      // 门禁规则：转存事件 (click_quark / click_uc) 与点播必须严格绑定具体影视资产！
      // 坚决拦截未绑定片名、或误将网站通用标题当成电影的假埋点
      if (eventType === 'click_quark' || eventType === 'click_uc' || eventType === 'click_play') {
        if (!resourceId || !resourceTitle || resourceTitle.indexOf('星光影库 -') === 0 || resourceTitle === '星光影库') {
          return;
        }
      }

      var payload = {
        event_type: eventType,
        resource_id: resourceId ? String(resourceId).trim() : null,
        resource_title: resourceTitle || (eventType === 'page_view' ? document.title : ''),
        device: getDeviceType(),
        page_url: window.location.href,
        referrer: document.referrer || ''
      };

      var jsonPayload = JSON.stringify(payload);
      var endpoint = '/api/track';

      // 优先使用 sendBeacon，保证页面即使跳转或关闭也能可靠送达边缘
      var beaconSent = false;
      if (navigator.sendBeacon) {
        try {
          var blob = new Blob([jsonPayload], { type: 'application/json' });
          beaconSent = navigator.sendBeacon(endpoint, blob);
        } catch (_) {}
      }

      // 若 sendBeacon 不可用或排队失败，使用 keepalive fetch 直连边缘/Supabase
      if (!beaconSent) {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonPayload,
          keepalive: true
        }).catch(function() {
          // 兜底直连 Supabase REST API
          fetch(SUPABASE_DIRECT_URL, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_PUBLIC_KEY,
              'Authorization': 'Bearer ' + SUPABASE_PUBLIC_KEY,
              'Content-Type': 'application/json'
            },
            body: jsonPayload,
            keepalive: true
          }).catch(function() {});
        });
      }
    } catch (e) {
      // 埋点异常绝不阻断用户正常交互
    }
  }

  // 暴露给全局调用
  window.starlightTrack = sendTrack;

  // 3. 页面加载完成时自动上报 PV
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    sendTrack('page_view');
  } else {
    window.addEventListener('DOMContentLoaded', function() {
      sendTrack('page_view');
    });
  }

  // 4. 全局事件代理：自动监听转存和播放点击
  document.addEventListener('click', function(event) {
    try {
      var target = event.target ? event.target.closest('a, button, [data-track]') : null;
      if (!target) return;

      var explicitTrack = target.getAttribute('data-track');
      var resId = target.getAttribute('data-resource-id');
      var resTitle = target.getAttribute('data-resource-title');
      var href = target.getAttribute('href') || '';

      // 向上寻找可能携带的电影信息
      if (!resId || !resTitle) {
        var card = target.closest('[data-resource-id]');
        if (card) {
          resId = resId || card.getAttribute('data-resource-id');
          resTitle = resTitle || card.getAttribute('data-resource-title');
        }
      }

      var extra = { resourceId: resId, resourceTitle: resTitle };

      // 1) 明确指定了 data-track
      if (explicitTrack) {
        sendTrack('click_' + explicitTrack, extra);
        return;
      }

      // 2) 智能链接识别：夸克转存
      if (href.indexOf('pan.quark.cn') !== -1) {
        sendTrack('click_quark', extra);
        return;
      }

      // 3) 智能链接识别：UC转存
      if (href.indexOf('drive.uc.cn') !== -1) {
        sendTrack('click_uc', extra);
        return;
      }

      // 4) 智能识别：在线播放流与播放按钮
      if (
        href.indexOf('player.html') !== -1 ||
        href.indexOf('.m3u8') !== -1 ||
        target.classList.contains('play-btn') ||
        (target.innerText && (target.innerText.indexOf('免广告播放') !== -1 || target.innerText.indexOf('在线播放') !== -1))
      ) {
        sendTrack('click_play', extra);
        return;
      }
    } catch (e) {
      // 静默
    }
  }, { passive: true });

})();

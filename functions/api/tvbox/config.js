// Cloudflare Pages Function: /api/tvbox/config
// 星光影库 · 深度集成摸鱼网盘驱动内核 (原生支持夸克/UC/阿里扫码弹窗登录与4K硬解)
// 任何用户在 TVBox 设置 -> 配置地址中输入: https://xkykmovie.com/api/tvbox/config 即可使用

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=180, s-maxage=300'
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.origin || 'https://xkykmovie.com';

  const config = {
    // 采用摸鱼同款成熟稳定的 Spider 核心，内置完整的 Quark/UC/Ali/115 扫码弹窗组件
    spider: 'https://qiniu.gongxueyun.com/upload/2371282/2026-11-12/noknow/759250805_1_1794505074145.jar;md5;53b51f8c239b727ce4cd18dc2c3b7a99',
    wallpaper: 'http://127.0.0.1:9978/proxy?do=wallpaper',
    logo: 'https://modelscope-resouces.oss-cn-zhangjiakou.aliyuncs.com/avatar%2Ff5309172-1af6-4c4f-a1c5-a4773a1cc718.gif',
    sites: [
      {
        key: 'xkyk_4k_pan',
        name: '星光',
        type: 1,
        api: `${host}/api/maccms`,
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
        categories: ['电影', '电视剧', '动漫', '综艺', '纪录片']
      },
      {
        key: 'FishPs',
        name: '鱼鱼',
        type: 3,
        api: 'csp_FishPs',
        searchable: 1,
        filterable: 0
      },
      {
        key: 'Wogg',
        name: '玩偶',
        type: 3,
        api: 'csp_Wogg',
        searchable: 1,
        changeable: 1,
        filterable: 1,
        ext: {
          site: [
            'https://wogg.xxooo.cf',
            'https://woggpan.888484.xyz',
            'https://www.wogg.live'
          ]
        }
      },
      // 核心网盘推送与扫码弹窗驱动：当遇到夸克/UC链接时，负责弹窗引导扫码并转存
      {
        key: 'push_agent',
        name: '推送',
        type: 3,
        api: 'csp_Push',
        searchable: 0,
        changeable: 0,
        indexs: 0,
        timeout: 60
      }
    ],
    parses: [
      {
        name: '聚合解析',
        type: 0,
        url: 'https://jx.jsonplayer.com/player/?url='
      },
      {
        name: '高速嗅探',
        type: 0,
        url: 'https://jx.aidouer.net/?url='
      }
    ],
    rules: [],
    ijk: [
      {
        group: '硬解码',
        options: [
          { category: 4, name: 'opensles', value: '0' },
          { category: 4, name: 'overlay-format', value: '842225234' },
          { category: 4, name: 'framedrop', value: '1' },
          { category: 4, name: 'soundtouch', value: '1' },
          { category: 4, name: 'start-on-prepared', value: '1' },
          { category: 1, name: 'http-detect-range-support', value: '0' },
          { category: 1, name: 'fflags', value: 'fastseek' },
          { category: 2, name: 'skip_loop_filter', value: '48' },
          { category: 4, name: 'reconnect', value: '1' },
          { category: 4, name: 'enable-accurate-seek', value: '0' },
          { category: 4, name: 'mediacodec', value: '1' },
          { category: 4, name: 'mediacodec-auto-rotate', value: '1' },
          { category: 4, name: 'mediacodec-handle-resolution-change', value: '1' },
          { category: 4, name: 'mediacodec-hevc', value: '1' },
          { category: 1, name: 'dns_cache_timeout', value: '600000000' }
        ]
      }
    ]
  };

  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: CORS_HEADERS
  });
}

// Cloudflare Pages Function: /api/tvbox/config
// 星光影库 · TVBox / FongMi / 影视仓 一键订阅配置中枢
// 任何用户直接在 TVBox 设置 -> 配置地址中输入: https://xkykmovie.com/api/tvbox/config 即可使用

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=600, s-maxage=1800'
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.origin || 'https://xkykmovie.com';

  const config = {
    spider: 'https://ghproxy.net/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    wallpaper: 'https://bing.img.run/rand_uhd.php',
    sites: [
      {
        key: 'xkyk_4k_pan',
        name: '🌟星光影库 · 4K网盘原画专线',
        type: 1,
        api: `${host}/api/maccms`,
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
        categories: ['电影', '电视剧', '动漫', '综艺', '纪录片']
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
    rules: [
      {
        name: 'quark',
        hosts: ['pan.quark.cn']
      },
      {
        name: 'uc',
        hosts: ['drive.uc.cn']
      }
    ]
  };

  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: CORS_HEADERS
  });
}

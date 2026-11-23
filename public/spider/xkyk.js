/**
 * 星光影库 · Drpy v2 标准爬虫规则
 * 可直接提交或导入至 饭太硬、摸鱼、肥猫、巧儿 等第三方 TVBox 订阅仓库
 */
var rule = {
    title: '星光影库(4K原盘)',
    host: 'https://xkykmovie.com',
    url: '/api/maccms?ac=detail&t=fyclass&pg=fypage',
    searchUrl: '/api/maccms?ac=detail&wd=**&pg=fypage',
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    headers: {
        'User-Agent': 'MOBILE_UA'
    },
    class_name: '电影&电视剧&动漫&综艺&纪录片',
    class_url: '1&2&3&4&5',
    play_parse: true,
    lazy: '',
    limit: 20,
    推荐: 'json:list;vod_name;vod_pic;vod_remarks;vod_id',
    一级: 'json:list;vod_name;vod_pic;vod_remarks;vod_id',
    二级: '*',
    搜索: 'json:list;vod_name;vod_pic;vod_remarks;vod_id'
};

/**
 * 星光影库 · 4K 原盘智能转存与流媒体直链爬虫 (Drpy v2 标准规则)
 * 1. 自动下钻网盘分享目录，展开真实集数与体积
 * 2. 点击播放即时向夸克/UC发起真实转存（计入收益），并提取 4K 原画直链推流
 */
var rule = {
    title: '星光',
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
    play_parse: 1,
    limit: 20,
    推荐: 'json:list;vod_name;vod_pic;vod_remarks;vod_id',
    一级: 'json:list;vod_name;vod_pic;vod_remarks;vod_id',
    二级: $js.toString(() => {
        let html = request(input);
        let data = JSON.parse(html);
        let vod = data.list && data.list[0] ? data.list[0] : {};
        
        let playFrom = [];
        let playList = [];
        
        let froms = (vod.vod_play_from || '').split('$$$');
        let urls = (vod.vod_play_url || '').split('$$$');
        
        for (let i = 0; i < froms.length; i++) {
            let from = froms[i];
            let urlPart = urls[i] || '';
            
            // 如果是夸克/UC网盘源，自动调用解析中枢展开真实剧集列表
            if (from === '夸父' || from === 'U盘' || urlPart.includes('pan.quark.cn')) {
                let shareMatch = urlPart.match(/https?:\/\/[^\$#]+/);
                let shareUrl = shareMatch ? shareMatch[0] : '';
                
                if (shareUrl) {
                    try {
                        let resolveRes = request('https://xkykmovie.com/api/pan/resolve?url=' + encodeURIComponent(shareUrl));
                        let resolveData = JSON.parse(resolveRes);
                        
                        if (resolveData.code === 1 && resolveData.list && resolveData.list.length > 0) {
                            let epStrs = resolveData.list.map(ep => {
                                // 传递 pwd_id, fid 与 token 至播放中枢
                                let playParam = resolveData.pwd_id + '@' + ep.fid + '@' + (ep.share_fid_token || '');
                                return ep.name + ' (' + ep.size_text + ')$' + playParam;
                            });
                            playFrom.push(from);
                            playList.push(epStrs.join('#'));
                            continue;
                        }
                    } catch (e) {
                        // 容错保留原链接
                    }
                }
            }
            
            playFrom.push(from);
            playList.push(urlPart);
        }
        
        vod.vod_play_from = playFrom.join('$$$');
        vod.vod_play_url = playList.join('$$$');
        VOD = vod;
    }),
    lazy: $js.toString(() => {
        // 核心播放调度：input 中携带 pwdId@fid@token
        if (input.includes('@')) {
            let parts = input.split('@');
            let pwdId = parts[0];
            let fid = parts[1];
            let token = parts[2] || '';
            
            // 调用 /api/pan/play 完成真实转存（计入收益）并换取 4K 原画直链
            let playApi = 'https://xkykmovie.com/api/pan/play?pwd_id=' + pwdId + '&fid=' + fid + '&token=' + encodeURIComponent(token);
            try {
                let res = request(playApi);
                let json = JSON.parse(res);
                if (json.code === 1 && json.url) {
                    input = {
                        parse: 0,
                        url: json.url,
                        header: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    };
                }
            } catch (e) {
                // 走重定向流
                input = { parse: 0, url: playApi + '&redirect=1' };
            }
        }
    })
};

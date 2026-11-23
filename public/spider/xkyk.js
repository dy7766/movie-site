/**
 * 星光影库 · 全球高可用直连爬虫 (Drpy v2 规范)
 * 零依赖受限域名，直连 Supabase 边缘节点与全球 CDN 图片镜像
 * 完美穿透各类公司/校园/企业路由器行为管理拦截
 */
var rule = {
    title: '星光',
    host: 'https://oncktqesgpjsilngtcok.supabase.co',
    url: '/rest/v1/resources?select=id,title,category,poster_url,year,score,share_link,share_link_uc&has_metadata=eq.true&category=eq.fyclass&order=year.desc,score.desc,created_at.desc&limit=20&offset=fypage',
    searchUrl: '/rest/v1/resources?select=id,title,category,poster_url,year,score,share_link,share_link_uc&has_metadata=eq.true&or=(title.ilike.*fyfilter*,actors.ilike.*fyfilter*)&order=year.desc,score.desc,created_at.desc&limit=20',
    detailUrl: '/rest/v1/resources?select=*&id=eq.fyid',
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    headers: {
        'apikey': 'sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH',
        'Authorization': 'Bearer sb_publishable_pQLb1OOxod2ibn_i1QqoJg_lt9FZPTH',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    class_name: '电影&电视剧&动漫&综艺&纪录片',
    class_url: '电影&电视剧&动漫&综艺&纪录片',
    play_parse: true,
    lazy: '',
    limit: 20,
    推荐: $js.toString(() => {
        let res = request(input);
        let list = JSON.parse(res);
        let d = (list || []).map(item => {
            let pic = item.poster_url || '';
            if (pic.includes('image.tmdb.org')) {
                pic = 'https://wsrv.nl/?url=' + encodeURIComponent(pic);
            }
            return {
                vod_id: item.id,
                vod_name: item.title,
                vod_pic: pic,
                vod_remarks: (item.year ? item.year + ' / ' : '') + '4K'
            };
        });
        setResult(d);
    }),
    一级: $js.toString(() => {
        let res = request(input);
        let list = JSON.parse(res);
        let d = (list || []).map(item => {
            let pic = item.poster_url || '';
            if (pic.includes('image.tmdb.org')) {
                pic = 'https://wsrv.nl/?url=' + encodeURIComponent(pic);
            }
            return {
                vod_id: item.id,
                vod_name: item.title,
                vod_pic: pic,
                vod_remarks: (item.year ? item.year + ' / ' : '') + '4K'
            };
        });
        setResult(d);
    }),
    二级: $js.toString(() => {
        let res = request(input);
        let list = JSON.parse(res);
        if (list && list.length > 0) {
            let item = list[0];
            let pic = item.poster_url || '';
            if (pic.includes('image.tmdb.org')) {
                pic = 'https://wsrv.nl/?url=' + encodeURIComponent(pic);
            }
            let playFrom = [];
            let playList = [];
            if (item.share_link) {
                playFrom.push('夸父');
                playList.push('4K原画·点击播放$' + item.share_link);
            }
            if (item.share_link_uc) {
                playFrom.push('U盘');
                playList.push('4K极速·点击播放$' + item.share_link_uc);
            }
            VOD = {
                vod_id: item.id,
                vod_name: item.title,
                vod_pic: pic,
                type_name: item.category || '电影',
                vod_year: item.year ? String(item.year) : '',
                vod_area: item.country || '华语',
                vod_actor: item.actors || '',
                vod_content: item.intro || '',
                vod_play_from: playFrom.join('$$$'),
                vod_play_url: playList.join('$$$')
            };
        }
    }),
    搜索: $js.toString(() => {
        let res = request(input);
        let list = JSON.parse(res);
        let d = (list || []).map(item => {
            let pic = item.poster_url || '';
            if (pic.includes('image.tmdb.org')) {
                pic = 'https://wsrv.nl/?url=' + encodeURIComponent(pic);
            }
            return {
                vod_id: item.id,
                vod_name: item.title,
                vod_pic: pic,
                vod_remarks: (item.year ? item.year + ' / ' : '') + '4K'
            };
        });
        setResult(d);
    })
};

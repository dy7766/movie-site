// Cloudflare Pages Edge Middleware
// 负责处理域名标准化与 SEO 权重 301 永久重定向

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // 1. 如果访问来源是 Cloudflare Pages 测试二级域名 (*.pages.dev) 或 www 子域名
  // 统一 301 永久重定向至官方正式独立域名 xkykmovie.com，保留完整路径与查询参数
  if (url.hostname.endsWith('.pages.dev') || url.hostname === 'www.xkykmovie.com') {
    url.hostname = 'xkykmovie.com';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  // 2. 正式域名请求直接放行，返回静态渲染内容
  return context.next();
}

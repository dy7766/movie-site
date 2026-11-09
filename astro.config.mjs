import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://xkykmovie.com',
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes('/hub-8f92') && !page.includes('/preview') && !page.includes('/admin')
    })
  ],
  output: 'static'
});

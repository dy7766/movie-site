import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://xkykmovie.com',
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes('/admin')
    })
  ],
  output: 'static'
});

import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://movie-site-8r4.pages.dev',
  integrations: [tailwind(), sitemap()],
  output: 'static'
});

import { defineConfig } from 'vite';
import wishForWash from './tools/vite-plugin-wfw.js';

// The public URL the site is deployed to (GitHub Pages). Used for the canonical
// link, Open Graph tags and the share QR code. Change it in one place here.
export const SITE_URL = 'https://sailalithkanumuri8.github.io/WishForWash/';

export default defineConfig({
  // Relative base so the build works on GitHub Pages, Netlify or any sub-path.
  base: './',
  plugins: [wishForWash({ siteUrl: SITE_URL })],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});

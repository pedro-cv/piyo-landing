// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages later: set PUBLIC_BASE="/piyo-landing/" (and PUBLIC_SITE) at build time.
// Default is the site root so local dev and any static host work unchanged.
const base = process.env.PUBLIC_BASE || '/';
const site = process.env.PUBLIC_SITE || 'https://piyo.example';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  build: { assets: 'assets' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    build: { target: 'es2022', chunkSizeWarningLimit: 600 },
    ssr: { noExternal: ['gsap', 'lenis'] },
  },
});

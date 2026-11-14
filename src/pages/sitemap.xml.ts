import type { APIRoute } from 'astro';

// Every .astro page in this folder, as clean URLs without a trailing slash (same form as the canonical tag).
const pages = Object.keys(import.meta.glob('./*.astro'))
  .map((f) => f.replace(/^\.\//, '').replace(/\.astro$/, ''))
  .map((p) => (p === 'index' ? '' : p))
  .sort();

export const GET: APIRoute = ({ site }) => {
  const base = new URL(import.meta.env.BASE_URL, site ?? 'https://piyo.example');
  const urls = pages.map((p) => `  <url><loc>${new URL(p, base).toString()}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};

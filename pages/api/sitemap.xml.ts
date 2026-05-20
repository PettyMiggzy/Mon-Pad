import type { NextApiRequest, NextApiResponse } from 'next';
import { api } from '@/lib/api';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  let tokens: { address: string }[] = [];
  try {
    tokens = await api.listTokens();
  } catch {
    // graceful degradation: still emit static routes if indexer is down
  }

  const staticRoutes = ['', '/create', '/swap', '/stake', '/how-it-works', '/docs'];
  const tokenRoutes = tokens.map((t) => `/token/${t.address}`);

  const urls = [...staticRoutes, ...tokenRoutes]
    .map((route) => {
      const isToken = route.startsWith('/token/');
      const priority = route === '' ? '1.0' : isToken ? '0.6' : '0.7';
      const changefreq = isToken ? 'hourly' : 'daily';
      return `  <url>
    <loc>https://www.monpad.net${route}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
}

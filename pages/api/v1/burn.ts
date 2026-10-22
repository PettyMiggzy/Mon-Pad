import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchMonshiBurnStats } from '@/lib/monshiBurn';

/** Live Monchi (MONSHI) burn counter data — same source as the homepage FOMO strip. */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=30');
  try {
    const s = await fetchMonshiBurnStats(true);
    res.status(200).json({
      burned: s.burned.toString(),
      burnedWhole: s.burnedWhole,
      circulatingWhole: s.circulatingWhole,
      totalSupply: s.totalSupply.toString(),
      updatedAt: s.updatedAt,
    });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'burn read failed' });
  }
}

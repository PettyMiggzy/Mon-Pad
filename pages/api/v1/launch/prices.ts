import type { NextApiRequest, NextApiResponse } from 'next';
import { LAUNCH_AGENT_ENABLED, LAUNCH_PRICES, LIMITS } from '@/lib/launchAgent/pricing';
import { meshyConfigured } from '@/lib/launchAgent/meshy';

// GET /api/v1/launch/prices — public. Prices are in Monpad credits (1 credit = $0.01).
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    enabled: LAUNCH_AGENT_ENABLED,
    creditUsd: 0.01,
    prices: LAUNCH_PRICES,
    character3dAvailable: meshyConfigured(),
    limits: { charactersPerWalletPerDay: LIMITS.charactersPerWalletPerDay },
    note: 'Every paid step is charged before it runs and refunded if it fails.',
  });
}

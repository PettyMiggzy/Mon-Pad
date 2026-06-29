import type { NextApiRequest, NextApiResponse } from 'next';

// Same-origin JSON-RPC proxy. The browser talks to /api/rpc; this serverless
// function forwards to the real RPC endpoint, which lives ONLY in the server-side
// RPC_URL env var and never ships to the client. A same-origin check stops the
// proxy from being used as a free public RPC by other sites.
//
// Vercel env (server-side, NOT NEXT_PUBLIC):
//   RPC_URL = https://<your-quicknode-endpoint>/...
// Also remove NEXT_PUBLIC_RPC_URL / _FALLBACK / _WSS so nothing leaks client-side.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const RPC_URL = process.env.RPC_URL || 'https://rpc.monad.xyz';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  // Same-origin guard: if an Origin header is present, its host must match the host
  // serving this route (works for prod, custom domain, and *.vercel.app previews).
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: 'forbidden' });
    } catch {
      return res.status(403).json({ error: 'forbidden' });
    }
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    return res.send(text);
  } catch {
    return res.status(502).json({ error: 'rpc upstream error' });
  }
}

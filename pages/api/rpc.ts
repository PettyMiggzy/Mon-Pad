import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchMonadRpc } from '@/lib/rpcUpstream';

// Same-origin JSON-RPC proxy. The browser talks to /api/rpc; this serverless
// function forwards to the real RPC endpoint(s), which live ONLY in server-side
// env and never ship to the client. A same-origin check stops the proxy from
// being used as a free public RPC by other sites.
//
// Vercel env (server-side, NOT NEXT_PUBLIC):
//   RPC_URL          = primary (default https://rpc.monad.xyz)
//   RPC_URL_FALLBACK = backup (e.g. Alchemy) — tried when primary fails
// Also remove NEXT_PUBLIC_RPC_URL / _FALLBACK / _WSS so nothing leaks client-side.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// JSON-RPC method allowlist. The app only ever needs read methods + raw-tx relay,
// so anything outside this set is rejected — an extra guard against the proxy being
// abused for expensive/unexpected calls even if a caller forges the Origin header.
const ALLOWED_METHODS = new Set<string>([
  'eth_chainId', 'net_version', 'web3_clientVersion',
  'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_call', 'eth_getCode', 'eth_getStorageAt', 'eth_getBalance',
  'eth_getLogs', 'eth_getTransactionCount', 'eth_getTransactionReceipt',
  'eth_getTransactionByHash', 'eth_getBlockTransactionCountByNumber',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
  'eth_sendRawTransaction', 'eth_getProof', 'eth_syncing',
]);

function methodAllowed(body: unknown): boolean {
  const check = (m: unknown) => typeof m === 'string' && ALLOWED_METHODS.has(m);
  if (Array.isArray(body)) return body.length > 0 && body.length <= 100 && body.every((c) => check((c as any)?.method));
  return check((body as any)?.method);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  // Same-origin guard. Browsers always attach an Origin header to fetch() POSTs,
  // so we REQUIRE it and require it to match the host serving this route. Requests
  // with no Origin (curl/scripts/other servers) are rejected — otherwise the proxy
  // is an open, unauthenticated front-end to the operator's metered RPC endpoint.
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin) return res.status(403).json({ error: 'forbidden' });
  try {
    if (new URL(origin).host !== host) return res.status(403).json({ error: 'forbidden' });
  } catch {
    return res.status(403).json({ error: 'forbidden' });
  }

  if (!methodAllowed(req.body)) return res.status(403).json({ error: 'method not allowed' });

  try {
    const upstream = await fetchMonadRpc(req.body ?? {});
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    return res.send(text);
  } catch {
    return res.status(502).json({ error: 'rpc upstream error' });
  }
}

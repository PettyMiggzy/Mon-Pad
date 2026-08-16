import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Same-origin JSON-RPC proxy for Robinhood Chain (4663), mirroring /api/rpc.
 *
 * WHY THIS EXISTS. The only public RPC for 4663 is Blockscout's, and it answers HTTP 429 with
 * `{"message":"Too many requests","result":null,"status":"0"}` — note that shape: no `error` key, so a
 * client that checks for JSON-RPC errors sees a response with a null result rather than a failure, and
 * reports something useless. Pointing the pad at it meant every read and every gas estimate was a coin
 * flip. The real endpoint lives ONLY in the server-side ROBINHOOD_RPC_URL env var and never ships to the
 * browser.
 *
 * Vercel env (server-side, NOT NEXT_PUBLIC):
 *   ROBINHOOD_RPC_URL = https://<your-endpoint>/...
 *
 * NOTE: this route is for the PAGE's own reads. A wallet's chain RPC cannot use it — MetaMask calls from
 * its own extension context and sends no matching Origin, so the guard below rejects it, by design. The
 * wallet-facing URL is NEXT_PUBLIC_ROBINHOOD_RPC_URL (see lib/wagmi.ts), which is public by nature.
 */

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://robinhoodchain.blockscout.com/api/eth-rpc';

// Read methods plus raw-tx relay. Anything else is refused even if a caller forges Origin.
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
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    // Upstream rate limiting is the failure this route exists to make visible, so turn a non-JSON-RPC
    // body into a real JSON-RPC error rather than passing through a null result that reads as success.
    if (!upstream.ok) {
      return res.status(200).json({
        jsonrpc: '2.0',
        id: (req.body as any)?.id ?? null,
        error: { code: -32000, message: `4663 RPC upstream ${upstream.status}: ${text.slice(0, 200)}` },
      });
    }
    res.status(upstream.status);
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    return res.send(text);
  } catch {
    return res.status(502).json({ error: 'rpc upstream error' });
  }
}

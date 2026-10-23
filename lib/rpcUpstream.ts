/**
 * Server-only Monad RPC endpoints. Never import into client bundles —
 * keys live in RPC_URL / RPC_URL_FALLBACK (Vercel / .env.local only).
 *
 * Primary:  RPC_URL            (default public https://rpc.monad.xyz)
 * Backup:   RPC_URL_FALLBACK   (e.g. Alchemy — used when primary fails)
 */

const PUBLIC_MONAD = 'https://rpc.monad.xyz';

export function monadRpcEndpoints(): string[] {
  const primary = (process.env.RPC_URL || '').trim() || PUBLIC_MONAD;
  const fallback = (process.env.RPC_URL_FALLBACK || '').trim();
  const out: string[] = [primary];
  if (fallback && fallback !== primary) out.push(fallback);
  return out;
}

/** First configured URL (for single-endpoint callers). */
export function monadRpcUrl(): string {
  return monadRpcEndpoints()[0];
}

/**
 * POST JSON-RPC body to primary, then fallback on network / non-2xx / empty body.
 * Returns the upstream Response from the first success.
 */
export async function fetchMonadRpc(body: unknown, init?: { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 12_000;
  const endpoints = monadRpcEndpoints();
  let lastErr: unknown;
  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) return res;
      lastErr = new Error(`rpc ${res.status} from ${i === 0 ? 'primary' : 'fallback'}`);
      // try fallback on 429/5xx; on 4xx (bad request) still try once in case primary is broken HTML
      if (res.status < 400 || res.status === 429 || res.status >= 500) continue;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('rpc upstream error');
}

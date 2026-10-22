// lib/launchClient.ts — browser helpers for launch-by-chat (same daily signature as Studio).
export const dayStr = () => new Date().toISOString().slice(0, 10);

export async function studioSig(
  address: string,
  sign: (a: { account: `0x${string}`; message: string }) => Promise<string>,
): Promise<string> {
  const key = `studio-sig:${address.toLowerCase()}:${dayStr()}`;
  try { const c = localStorage.getItem(key); if (c) return c; } catch { /* private mode */ }
  const sig = await sign({ account: address as `0x${string}`, message: `Mon-Pad Studio: ${address.toLowerCase()} ${dayStr()}` });
  try { localStorage.setItem(key, sig); } catch { /* ignore */ }
  return sig;
}

export async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d?.error || `request failed (${r.status})`), { status: r.status, data: d });
  return d as T;
}

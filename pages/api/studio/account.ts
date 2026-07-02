import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ACCESS_MON, HOLDER_MIN_MONSHI, FREE_DAILY, MIN_TOPUP_MON, MON_USD, OPEN_BETA, PACKS, TREASURY, monshiBalance, veniceKey, verifyPayment } from '@/lib/studioServer';

// Monshi Studio account: GET = status (access/holder/credits/free-left/packs),
// POST = redeem a MON payment tx (access unlock or credit top-up). Payments are
// plain MON transfers to the treasury, verified on-chain server-side; each tx hash
// is stored (PK) so it can only ever be redeemed once.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const today = () => new Date().toISOString().slice(0, 10);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Studio storage not configured' });

  if (req.method === 'GET') {
    const wallet = lc(req.query.wallet as string);
    if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });
    const [{ data: acct }, monshi] = await Promise.all([
      supabase.from('studio_accounts').select('*').eq('wallet', wallet).maybeSingle(),
      monshiBalance(wallet),
    ]);
    const holder = monshi >= HOLDER_MIN_MONSHI;
    const freeUsed = acct?.free_date === today() ? acct.free_used : 0;
    const freeEligible = holder || OPEN_BETA; // beta: everyone gets the free chat lane
    return res.status(200).json({
      wallet, credits: acct?.credits ?? 0, access: (acct?.access ?? false) || holder || OPEN_BETA, paidAccess: acct?.access ?? false,
      holder, monshi, beta: OPEN_BETA, freeLeft: freeEligible ? Math.max(0, FREE_DAILY - freeUsed) : 0, freeDaily: FREE_DAILY,
      accessMon: ACCESS_MON, minTopupMon: MIN_TOPUP_MON, monUsd: MON_USD, packs: PACKS,
      treasury: TREASURY || null, configured: !!TREASURY,
      holderMinMonshi: HOLDER_MIN_MONSHI,
      // Diagnostics only — never the key material itself.
      ai: (() => { const k = veniceKey(); return k ? (k.startsWith('VENICE_INFERENCE_KEY_') ? 'ok' : 'set-check-format') : 'missing'; })(),
    });
  }

  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, any>;
    const wallet = lc(b.wallet);
    const txHash = String(b.txHash || '');
    const kind = b.kind === 'access' ? 'access' : 'credits';
    if (!isAddr(wallet) || !/^0x[0-9a-f]{64}$/i.test(txHash)) return res.status(400).json({ error: 'wallet + txHash required' });
    if (!TREASURY) return res.status(500).json({ error: 'Studio treasury not configured' });

    // Replay guard FIRST: claim the tx hash before crediting (PK = atomic).
    const mon = await verifyPayment(txHash, wallet);
    if (mon === null) return res.status(400).json({ error: 'payment not found / not to treasury / not yours' });
    if (kind === 'access' && mon < ACCESS_MON) return res.status(400).json({ error: `access costs ${ACCESS_MON} MON` });
    if (kind === 'credits' && mon < MIN_TOPUP_MON) return res.status(400).json({ error: `minimum top-up is ${MIN_TOPUP_MON} MON` });
    const credits = kind === 'credits' ? Math.round(mon * MON_USD * 100) : 0;

    const { error: payErr } = await supabase.from('studio_payments').insert({ tx_hash: txHash.toLowerCase(), wallet, mon, kind, credits });
    if (payErr) {
      if ((payErr as any).code === '23505') return res.status(409).json({ error: 'payment already redeemed' });
      return res.status(500).json({ error: payErr.message });
    }

    const { data: acct } = await supabase.from('studio_accounts').select('*').eq('wallet', wallet).maybeSingle();
    const { error } = await supabase.from('studio_accounts').upsert({
      wallet,
      credits: (acct?.credits ?? 0) + credits,
      access: (acct?.access ?? false) || kind === 'access',
      free_used: acct?.free_used ?? 0, free_date: acct?.free_date ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'wallet' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, kind, mon, credits });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'GET or POST only' });
}

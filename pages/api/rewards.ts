import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, http, recoverMessageAddress, formatUnits, type Address } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MONSHI_TOKEN, MONAD_CHAIN_ID } from '@/lib/constants';
import { tokenAbi } from '@/lib/abis';

// Monshi Rewards — points / daily streaks / referrals. Holding MONSHI multiplies
// your earn-rate (tiered). Points are non-transferable and off-chain; a future
// season converts them to a MONSHI/treasury airdrop. Framed as rewards, not yield.

const TABLE = 'rewards';
const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const CHECKIN_MSG = (d: string) => `Mon-Pad Rewards: daily check-in ${d}`;
const CHECKIN_BASE = 100;

function tierOf(bal: number): { name: string; mult: number } {
  if (bal >= 5_000_000) return { name: 'Diamond', mult: 3 };
  if (bal >= 1_000_000) return { name: 'Gold', mult: 2 };
  if (bal >= 250_000) return { name: 'Silver', mult: 1.5 };
  if (bal >= 100_000) return { name: 'Bronze', mult: 1.25 };
  return { name: 'Member', mult: 1 };
}

async function monshiBalance(wallet: string): Promise<number> {
  const rpc = process.env.RPC_URL || 'https://rpc.monad.xyz';
  try {
    const client = createPublicClient({
      chain: { id: MONAD_CHAIN_ID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as any,
      transport: http(rpc, { timeout: 7_000, retryCount: 1 }),
    });
    const raw = await (client.readContract as any)({ address: MONSHI_TOKEN as Address, abi: tokenAbi as any, functionName: 'balanceOf', args: [wallet as Address] });
    return Number(formatUnits(raw as bigint, 18));
  } catch { return 0; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Rewards storage not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });

  // ── READ ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (req.query.leaderboard) {
      const { data, error } = await supabase.from(TABLE).select('wallet,points,streak').order('points', { ascending: false }).limit(50);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }
    const wallet = lc(req.query.wallet as string);
    if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });
    const { data } = await supabase.from(TABLE).select('*').eq('wallet', wallet).maybeSingle();
    const bal = await monshiBalance(wallet);
    const tier = tierOf(bal);
    const points = data?.points ?? 0;
    const { count } = await supabase.from(TABLE).select('wallet', { count: 'exact', head: true }).gt('points', points);
    return res.status(200).json({
      wallet, points, streak: data?.streak ?? 0,
      checkedInToday: data?.last_checkin === today(),
      refCount: data?.ref_count ?? 0, referredBy: data?.referred_by ?? null,
      monshi: bal, tier: tier.name, multiplier: tier.mult, rank: (count ?? 0) + 1,
    });
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, any>;
    const wallet = lc(b.wallet);
    if (!isAddr(wallet)) return res.status(400).json({ error: 'invalid wallet' });

    if (b.action === 'checkin') {
      const d = today();
      try {
        const signer = lc(await recoverMessageAddress({ message: CHECKIN_MSG(d), signature: b.signature }));
        if (signer !== wallet) return res.status(401).json({ error: 'bad signature' });
      } catch { return res.status(401).json({ error: 'bad signature' }); }

      const { data: row } = await supabase.from(TABLE).select('*').eq('wallet', wallet).maybeSingle();
      if (row?.last_checkin === d) return res.status(409).json({ error: 'already checked in today' });

      const tier = tierOf(await monshiBalance(wallet));
      const streak = row?.last_checkin === yesterday() ? (row.streak || 0) + 1 : 1;
      const streakMult = Math.min(2, 1 + 0.1 * (streak - 1)); // +10%/day, capped at 2x
      const earned = Math.round(CHECKIN_BASE * tier.mult * streakMult);
      const points = (row?.points ?? 0) + earned;
      const { error } = await supabase.from(TABLE).upsert({
        wallet, points, streak, last_checkin: d,
        referred_by: row?.referred_by ?? null, ref_count: row?.ref_count ?? 0, updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, earned, points, streak, tier: tier.name, multiplier: tier.mult });
    }

    if (b.action === 'refer') {
      const code = lc(b.code);
      if (!isAddr(code) || code === wallet) return res.status(400).json({ error: 'invalid referral' });
      const { data: me } = await supabase.from(TABLE).select('*').eq('wallet', wallet).maybeSingle();
      if (me?.referred_by) return res.status(409).json({ error: 'already referred' });
      // credit the referee (+250) and the referrer (+500, ref_count++)
      await supabase.from(TABLE).upsert({
        wallet, points: (me?.points ?? 0) + 250, streak: me?.streak ?? 0, last_checkin: me?.last_checkin ?? null,
        referred_by: code, ref_count: me?.ref_count ?? 0, updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet' });
      const { data: ref } = await supabase.from(TABLE).select('*').eq('wallet', code).maybeSingle();
      await supabase.from(TABLE).upsert({
        wallet: code, points: (ref?.points ?? 0) + 500, streak: ref?.streak ?? 0, last_checkin: ref?.last_checkin ?? null,
        referred_by: ref?.referred_by ?? null, ref_count: (ref?.ref_count ?? 0) + 1, updated_at: new Date().toISOString(),
      }, { onConflict: 'wallet' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'GET or POST only' });
}

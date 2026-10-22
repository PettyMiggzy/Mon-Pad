// lib/launchAgent/account.ts — auth + credit ledger helpers shared by the launch endpoints.
// Reuses the Studio ledger: daily wallet signature, atomic debit-before-work, refund on failure.

import type { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { verifyStudioSig } from '../studioServer';
import { LAUNCH_AGENT_ENABLED } from './pricing';

export const lc = (s?: string) => (s || '').toLowerCase();
export const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
export const startOfDayIso = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

export type Authed = { supabase: SupabaseClient; wallet: string; body: Record<string, any> };

/** Common gate: POST only, feature flag, storage configured, valid wallet + signature. */
export async function authed(req: NextApiRequest, res: NextApiResponse): Promise<Authed | null> {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'POST only' }); return null; }
  if (!LAUNCH_AGENT_ENABLED) { res.status(503).json({ error: 'launch agent is paused' }); return null; }
  const supabase = getSupabaseAdmin();
  if (!supabase) { res.status(500).json({ error: 'storage not configured' }); return null; }
  const body = (req.body || {}) as Record<string, any>;
  const wallet = lc(body.wallet);
  if (!isAddr(wallet)) { res.status(400).json({ error: 'invalid wallet' }); return null; }
  if (!(await verifyStudioSig(wallet, String(body.signature || '')))) { res.status(401).json({ error: 'bad signature — sign in again' }); return null; }
  return { supabase, wallet, body };
}

/** Debit BEFORE the provider call. Returns the new balance, or null if the user can't afford it. */
export async function spend(supabase: SupabaseClient, wallet: string, cost: number): Promise<number | null> {
  const { data, error } = await supabase.rpc('studio_spend_credits', { p_wallet: wallet, p_cost: cost });
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? null : Number(data);
}

export async function refund(supabase: SupabaseClient, wallet: string, amount: number) {
  await supabase.rpc('studio_add_credits', { p_wallet: wallet, p_amount: amount });
}

export async function logUsage(supabase: SupabaseClient, wallet: string, mode: string, model: string, credits: number) {
  await supabase.from('studio_usage').insert({ wallet, mode, model, credits });
}

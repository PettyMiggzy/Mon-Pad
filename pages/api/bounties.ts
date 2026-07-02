import type { NextApiRequest, NextApiResponse } from 'next';
import { recoverMessageAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Mon-Pad Bounties v1 — a signed public board. Posters offer a MONSHI reward for a
// task (raids, memes, tools, listings); hunters claim in comments/TG and the poster
// marks it awarded. Payment is wallet-to-wallet by the poster (no escrow in v1 —
// clearly labeled in the UI). Writes are gated by wallet signatures.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const clip = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
export const postMessage = (title: string) => `Mon-Pad Bounties: post "${title}"`;
export const updateMessage = (id: string, status: string) => `Mon-Pad Bounties: update ${id} ${status}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Bounties storage not configured' });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('bounties').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, any>;
    const poster = lc(b.wallet);
    const title = clip(b.title, 80);
    const description = clip(b.description, 1000);
    const reward = clip(b.reward, 64);
    const contact = clip(b.contact, 64);
    if (!isAddr(poster) || title.length < 4 || description.length < 10 || !reward) {
      return res.status(400).json({ error: 'title (4+), description (10+), reward required' });
    }
    try {
      const signer = lc(await recoverMessageAddress({ message: postMessage(title), signature: b.signature }));
      if (signer !== poster) return res.status(401).json({ error: 'bad signature' });
    } catch { return res.status(401).json({ error: 'bad signature' }); }
    const { data, error } = await supabase.from('bounties').insert({ title, description, reward, contact, poster }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const b = (req.body || {}) as Record<string, any>;
    const id = String(b.id || '');
    const status = b.status === 'awarded' ? 'awarded' : b.status === 'closed' ? 'closed' : null;
    const wallet = lc(b.wallet);
    if (!id || !status || !isAddr(wallet)) return res.status(400).json({ error: 'id, status, wallet required' });
    try {
      const signer = lc(await recoverMessageAddress({ message: updateMessage(id, status), signature: b.signature }));
      if (signer !== wallet) return res.status(401).json({ error: 'bad signature' });
    } catch { return res.status(401).json({ error: 'bad signature' }); }
    const { data: row } = await supabase.from('bounties').select('poster').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.poster !== wallet) return res.status(403).json({ error: 'only the poster can update' });
    const claimer = status === 'awarded' && isAddr(b.claimer) ? lc(b.claimer) : null;
    const { error } = await supabase.from('bounties').update({ status, claimer, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'GET, POST or PATCH only' });
}

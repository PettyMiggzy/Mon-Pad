import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { downloadGlb, getImageTo3D, getRigging, startRigging } from '@/lib/launchAgent/meshy';
import { MESHY_RIG_CREDITS } from '@/lib/launchAgent/pricing';
import { isAddr, lc, refund } from '@/lib/launchAgent/account';
import { verifyStudioSig } from '@/lib/studioServer';

// GET  /api/v1/launch/character/:id  -> progress; each call advances the job (model -> rig -> ready).
// POST /api/v1/launch/character/:id  {wallet, signature, token} -> attach the finished character to a token.
const BUCKET = 'images';
const PUBLIC = (r: any) => ({ id: r.id, stage: r.stage, glb: r.glb_url || null, rigged: r.rigged, token: r.token || null, error: r.error || null });

async function store(supabase: any, id: string, glb: Buffer, rigged: boolean) {
  const path = `models/${id}${rigged ? '-rigged' : ''}.glb`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, glb, { contentType: 'model/gltf-binary', upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl as string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'storage not configured' });
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'bad id' });
  const { data: row } = await supabase.from('launch_characters').select('*').eq('id', id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'not found' });

  if (req.method === 'POST') {
    const wallet = lc(req.body?.wallet);
    if (!isAddr(wallet) || wallet !== row.wallet || !(await verifyStudioSig(wallet, String(req.body?.signature || '')))) return res.status(401).json({ error: 'not your character' });
    const token = lc(req.body?.token);
    if (!isAddr(token)) return res.status(400).json({ error: 'invalid token address' });
    await supabase.from('launch_characters').update({ token, updated_at: new Date().toISOString() }).eq('id', id);
    return res.status(200).json(PUBLIC({ ...row, token }));
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'GET or POST' }); }

  try {
    let r = row;
    const patch = async (p: Record<string, any>) => {
      r = { ...r, ...p };
      await supabase.from('launch_characters').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);
    };
    if (r.stage === 'model') {
      const t = await getImageTo3D(r.model_task);
      if (t.status === 'FAILED' || t.status === 'CANCELED') {
        if (!r.refunded) await refund(supabase, r.wallet, Number(r.credits));
        await patch({ stage: 'failed', refunded: true, error: t.error || '3D build failed — credits refunded' });
      } else if (t.status === 'SUCCEEDED' && t.glb) {
        const url = await store(supabase, id, await downloadGlb(t.glb), false); // usable model saved first
        let rig: string | null = null;
        try { rig = await startRigging(r.model_task); } catch { /* not humanoid enough: keep the static model */ }
        await patch(rig ? { stage: 'rig', rig_task: rig, glb_url: url } : { stage: 'ready', glb_url: url });
      }
    } else if (r.stage === 'rig') {
      const t = await getRigging(r.rig_task);
      if (t.status === 'SUCCEEDED' && t.glb) {
        const url = await store(supabase, id, await downloadGlb(t.glb), true);
        await patch({ stage: 'ready', glb_url: url, rigged: true, meshy_credits: Number(r.meshy_credits) + MESHY_RIG_CREDITS });
      } else if (t.status === 'FAILED' || t.status === 'CANCELED') {
        await patch({ stage: 'ready' }); // static model still works
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(PUBLIC(r));
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || 'status unavailable').slice(0, 160) });
  }
}

// pages/bounties.tsx — Mon-Pad Bounties: post a task with a MONSHI reward (raids,
// memes, tools, integrations); hunters take it on; poster marks it awarded and pays
// wallet-to-wallet. v1 is a signed board (no escrow — labeled clearly).

import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

type Bounty = { id: string; title: string; description: string; reward: string; poster: string; contact?: string; status: 'open' | 'awarded' | 'closed'; claimer?: string; created_at: string };

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 14 };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const STATUS_COLOR: Record<string, string> = { open: '#4ADE80', awarded: '#FFD700', closed: '#6b7280' };

export default function BountiesPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [rows, setRows] = useState<Bounty[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ title: '', description: '', reward: '', contact: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => { fetch('/api/bounties').then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function post() {
    if (!address || busy) return;
    setBusy(true); setNote(null);
    try {
      const signature = await signMessageAsync({ account: address, message: `Mon-Pad Bounties: post "${f.title.trim().slice(0, 80)}"` });
      const r = await fetch('/api/bounties', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, signature, ...f, title: f.title.trim().slice(0, 80) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setShowForm(false); setF({ title: '', description: '', reward: '', contact: '' }); load();
      setNote('✅ Bounty posted!');
    } catch (e: any) { setNote(`⚠️ ${String(e?.message || 'error').slice(0, 120)}`); }
    setBusy(false);
  }

  async function setStatus(bn: Bounty, status: 'awarded' | 'closed') {
    if (!address || busy) return;
    setBusy(true); setNote(null);
    try {
      const signature = await signMessageAsync({ account: address, message: `Mon-Pad Bounties: update ${bn.id} ${status}` });
      const r = await fetch('/api/bounties', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: bn.id, status, wallet: address, signature }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'failed');
      load();
    } catch (e: any) { setNote(`⚠️ ${String(e?.message || 'error').slice(0, 120)}`); }
    setBusy(false);
  }

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' };

  return (
    <>
      <Head><title>Bounties | Mon-Pad</title><meta name="description" content="Mon-Pad bounties — earn MONSHI for raids, memes, tools and integrations." /></Head>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 60px', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>🎯 Bounties</h1>
          <button onClick={() => setShowForm((v) => !v)} disabled={!address} style={{ marginLeft: 'auto', background: '#8B5CF6', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 10, fontWeight: 800, cursor: 'pointer', opacity: address ? 1 : 0.5 }}>
            {showForm ? 'Cancel' : '+ Post bounty'}
          </button>
        </div>
        <p style={{ color: '#9aa4b2', fontSize: 13, marginTop: 0 }}>
          Earn <b style={{ color: '#c4b5fd' }}>MONSHI</b> for raids, memes, tools & integrations. Posters pay winners directly (no escrow yet — work with posters you trust).
        </p>
        {note && <div style={{ ...card, padding: '9px 12px', fontSize: 13, marginBottom: 10 }}>{note}</div>}

        {showForm && (
          <div style={{ ...card, padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={input} placeholder="Title — e.g. Meme pack for $MONSHI (10 memes)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} />
            <textarea style={{ ...input, resize: 'vertical' }} rows={3} placeholder="What exactly needs to be done + how it's judged…" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input style={{ ...input, flex: 1, minWidth: 140 }} placeholder="Reward — e.g. 2M MONSHI" value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} maxLength={64} />
              <input style={{ ...input, flex: 1, minWidth: 140 }} placeholder="Contact — @telegram" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} maxLength={64} />
            </div>
            <button onClick={post} disabled={busy} style={{ background: '#8B5CF6', color: '#fff', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Signing…' : 'Sign & post (free)'}
            </button>
          </div>
        )}

        {rows.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9aa4b2' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎯</div>
            No bounties yet — post the first one.
          </div>
        ) : rows.map((bn) => (
          <div key={bn.id} style={{ ...card, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>{bn.title}</b>
              <span style={{ fontSize: 11, fontWeight: 800, color: STATUS_COLOR[bn.status], border: `1px solid ${STATUS_COLOR[bn.status]}55`, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase' }}>{bn.status}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 900, color: '#FFD700' }}>{bn.reward}</span>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{bn.description}</div>
            <div style={{ fontSize: 12, color: '#9aa4b2', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>by {short(bn.poster)}</span>
              {bn.contact && <span>📨 {bn.contact}</span>}
              {bn.claimer && <span>🏆 won by {short(bn.claimer)}</span>}
              {address && bn.poster === address.toLowerCase() && bn.status === 'open' && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => setStatus(bn, 'awarded')} disabled={busy} style={{ background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.5)', color: '#FFD700', padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Mark awarded</button>
                  <button onClick={() => setStatus(bn, 'closed')} disabled={busy} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Close</button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

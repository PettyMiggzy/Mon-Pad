// pages/studio.tsx — Monshi Studio: AI chat / code / images, fronted by Monshi.
// Access: pay MON once (or hold MONSHI). Holders chat free (daily cap, cheap model);
// premium modes (big-model chat, Claude code, images) burn credits bought with MON.
// All AI calls go through our API — provider keys never touch the browser.

import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useSendTransaction, useSignMessage } from 'wagmi';
import { parseEther } from 'viem';

type Acct = {
  credits: number; access: boolean; paidAccess: boolean; holder: boolean; monshi: number;
  freeLeft: number; freeDaily: number; accessMon: number; minTopupMon: number; monUsd: number;
  packs: { mon: number; credits: number }[]; treasury: string | null; configured: boolean; holderMinMonshi: number;
};
type Msg = { role: 'user' | 'assistant'; content: string; image?: string; meta?: string };
type Mode = 'chat' | 'code' | 'image';

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 14 };
const fmt = (n: number) => n.toLocaleString('en-US');
const dayStr = () => new Date().toISOString().slice(0, 10);

export default function StudioPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();

  const [acct, setAcct] = useState<Acct | null>(null);
  const [mode, setMode] = useState<Mode>('chat');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showTopup, setShowTopup] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!address) { setAcct(null); return; }
    try { const r = await fetch(`/api/studio/account?wallet=${address}`); if (r.ok) setAcct(await r.json()); } catch { /* ignore */ }
  }, [address]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  // Daily session signature, cached per wallet+day.
  async function getSig(): Promise<string> {
    if (!address) throw new Error('connect wallet');
    const key = `studio-sig:${address.toLowerCase()}:${dayStr()}`;
    const cached = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    if (cached) return cached;
    const sig = await signMessageAsync({ account: address, message: `Mon-Pad Studio: ${address.toLowerCase()} ${dayStr()}` });
    localStorage.setItem(key, sig);
    return sig;
  }

  async function pay(mon: number, kind: 'access' | 'credits') {
    if (!address || !acct?.treasury || payBusy) return;
    setPayBusy(true); setNote(null);
    try {
      const hash = await sendTransactionAsync({ to: acct.treasury as `0x${string}`, value: parseEther(String(mon)) });
      setNote('⏳ Confirming payment on-chain…');
      // Give the tx a moment, then redeem (retry a few times while it mines).
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch('/api/studio/account', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: address, txHash: hash, kind }),
        });
        if (res.ok) { const j = await res.json(); setNote(kind === 'access' ? '🔓 Studio unlocked!' : `✅ +${fmt(j.credits)} credits`); setShowTopup(false); await load(); setPayBusy(false); return; }
        const j = await res.json().catch(() => ({}));
        if (res.status !== 400) { setNote(`Error: ${j.error || res.status}`); setPayBusy(false); return; }
      }
      setNote('Payment sent but not confirmed yet — retry redeem in a minute.');
    } catch { setNote('Payment cancelled.'); }
    setPayBusy(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !address) return;
    setInput(''); setNote(null); setBusy(true);
    const mine: Msg = { role: 'user', content: text };
    setMsgs((m) => [...m, mine]);
    try {
      const signature = await getSig();
      if (mode === 'image') {
        const r = await fetch('/api/studio/image', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: address, signature, prompt: text }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'image failed');
        setMsgs((m) => [...m, { role: 'assistant', content: '', image: j.image, meta: `−${j.charged} credits` }]);
      } else {
        const history = [...msgs.filter((m) => !m.image), mine].map(({ role, content }) => ({ role, content }));
        const r = await fetch('/api/studio/chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: address, signature, mode, messages: history }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'chat failed');
        setMsgs((m) => [...m, { role: 'assistant', content: j.reply, meta: j.charged ? `−${j.charged} credits` : `free · ${j.freeLeft} left today` }]);
      }
      await load();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${String(e?.message || 'error').slice(0, 160)}` }]);
    }
    setBusy(false);
  }

  const unlocked = !!acct?.access;
  const modeCost: Record<Mode, string> = {
    chat: acct?.holder && (acct?.freeLeft ?? 0) > 0 ? `free (${acct?.freeLeft} left)` : '2 cr',
    code: '15 cr', image: '20 cr',
  };

  return (
    <>
      <Head><title>Monshi Studio | Mon-Pad</title><meta name="description" content="Monshi Studio — AI chat, code and image generation on Mon-Pad. Hold MONSHI to chat free; buy credits with MON for premium AI." /></Head>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 40px', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/monshi-chibi.webp" alt="Monshi" width={54} height={54} style={{ borderRadius: 14, border: '1px solid rgba(139,92,246,0.5)', boxShadow: '0 0 18px rgba(139,92,246,0.45)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Monshi <span style={{ color: '#a78bfa' }}>Studio</span></h1>
            <div style={{ fontSize: 12, color: '#9aa4b2' }}>AI chat · code · images — powered by Monshi. Holders chat free.</div>
          </div>
          {address && acct && (
            <button onClick={() => setShowTopup(true)} style={{ ...card, padding: '8px 14px', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
              ⚡ {fmt(acct.credits)} cr <span style={{ color: '#a78bfa', fontWeight: 600 }}>· top up</span>
            </button>
          )}
        </div>

        {!address ? (
          <div style={{ ...card, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>🤖</div>
            <b style={{ fontSize: 17 }}>Connect your wallet to meet Monshi</b>
            <div style={{ color: '#9aa4b2', fontSize: 13, marginTop: 6 }}>Hold {fmt(100000)}+ MONSHI to chat free, or unlock with MON.</div>
          </div>
        ) : !acct ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9aa4b2' }}>loading…</div>
        ) : !unlocked ? (
          // ── Gate ───────────────────────────────────────────────────────────
          <div style={{ ...card, padding: 28, textAlign: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/monshi-statue.png" alt="Monshi" style={{ height: 150, width: 'auto', margin: '0 auto 10px', filter: 'drop-shadow(0 0 22px rgba(139,92,246,0.7))' }} />
            <div style={{ fontSize: 20, fontWeight: 900 }}>Unlock Monshi Studio</div>
            <div style={{ fontSize: 13, color: '#c4b5fd', margin: '8px 0 4px' }}>One-time <b>{fmt(acct.accessMon)} MON</b> (~${Math.round(acct.accessMon * acct.monUsd)}) — then buy credits as you go.</div>
            <div style={{ fontSize: 12, color: '#9aa4b2', marginBottom: 16 }}>Or hold <b>{fmt(acct.holderMinMonshi)}+ MONSHI</b> — holders get in free with {acct.freeDaily} free chats/day. You hold {fmt(Math.floor(acct.monshi))}.</div>
            {!acct.configured && <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>⚠️ Studio treasury not configured yet (set STUDIO_TREASURY + VENICE_API_KEY).</div>}
            <button disabled={payBusy || !acct.configured} onClick={() => pay(acct.accessMon, 'access')} style={{ background: '#8B5CF6', color: '#fff', border: 'none', padding: '12px 26px', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: payBusy || !acct.configured ? 0.6 : 1 }}>
              {payBusy ? 'Processing…' : `🔓 Unlock · ${fmt(acct.accessMon)} MON`}
            </button>
            <div style={{ marginTop: 12 }}>
              <Link href="/swap" style={{ fontSize: 13, color: '#a78bfa' }}>Get MONSHI instead →</Link>
            </div>
            {note && <div style={{ marginTop: 12, fontSize: 13, color: '#c4b5fd' }}>{note}</div>}
          </div>
        ) : (
          // ── Studio ─────────────────────────────────────────────────────────
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {(['chat', 'code', 'image'] as Mode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${mode === m ? '#a78bfa' : 'rgba(139,92,246,0.3)'}`,
                  background: mode === m ? 'rgba(139,92,246,0.35)' : 'rgba(10,6,20,0.5)', color: mode === m ? '#fff' : '#c4b5fd',
                }}>
                  {m === 'chat' ? '💬 Chat' : m === 'code' ? '🧑‍💻 Code (Claude)' : '🎨 Image'} <span style={{ color: '#9aa4b2', fontWeight: 500 }}>· {modeCost[m]}</span>
                </button>
              ))}
              {acct.holder && <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: '#4ADE80' }}>💎 holder · {acct.freeLeft}/{acct.freeDaily} free chats left</span>}
            </div>

            <div style={{ ...card, height: '52vh', minHeight: 320, overflowY: 'auto', padding: 16 }}>
              {msgs.length === 0 && (
                <div style={{ color: '#9aa4b2', fontSize: 14, textAlign: 'center', marginTop: 60 }}>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>🦝</div>
                  gm — I'm Monshi. Ask me anything, have me write code, or describe an image.
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                  <div style={{
                    maxWidth: '82%', padding: '10px 13px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    background: m.role === 'user' ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${m.role === 'user' ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  }}>
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt="generated" style={{ maxWidth: '100%', borderRadius: 8 }} />
                    ) : m.content}
                    {m.meta && <div style={{ fontSize: 10, color: '#7c6aa8', marginTop: 6 }}>{m.meta}</div>}
                  </div>
                </div>
              ))}
              {busy && <div style={{ color: '#a78bfa', fontSize: 13 }}>Monshi is {mode === 'image' ? 'painting' : 'thinking'}…</div>}
              <div ref={bottomRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <textarea
                value={input} onChange={(e) => setInput(e.target.value)} rows={mode === 'code' ? 3 : 1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={mode === 'image' ? 'describe the image…' : mode === 'code' ? 'describe the code you need… (shift+enter = newline)' : 'message Monshi…'}
                style={{ flex: 1, resize: 'none', padding: '11px 12px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <button onClick={send} disabled={busy || !input.trim()} style={{ background: '#8B5CF6', color: '#fff', border: 'none', padding: '0 22px', borderRadius: 10, fontWeight: 800, cursor: 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}>Send</button>
            </div>
            {note && <div style={{ marginTop: 8, fontSize: 13, color: '#c4b5fd' }}>{note}</div>}
          </>
        )}

        {/* Top-up modal */}
        {showTopup && acct && (
          <div onClick={() => setShowTopup(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 80 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...card, background: '#0d0919', width: 'min(380px, 92vw)', padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <b style={{ fontSize: 17 }}>Buy credits</b>
                <button onClick={() => setShowTopup(false)} style={{ background: 'none', border: 'none', color: '#9aa4b2', fontSize: 18, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: '#9aa4b2', marginBottom: 14 }}>Pay in MON · 1 credit = $0.01 of AI. Chat 2cr · Code 15cr · Image 20cr.</div>
              {acct.packs.map((p) => (
                <button key={p.mon} disabled={payBusy} onClick={() => pay(p.mon, 'credits')} style={{ width: '100%', ...card, color: '#fff', padding: 13, borderRadius: 10, cursor: 'pointer', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, opacity: payBusy ? 0.6 : 1 }}>
                  <span>{fmt(p.mon)} MON</span><span style={{ color: '#a78bfa' }}>{fmt(p.credits)} credits</span>
                </button>
              ))}
              {note && <div style={{ fontSize: 12, color: '#c4b5fd', marginTop: 4 }}>{note}</div>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

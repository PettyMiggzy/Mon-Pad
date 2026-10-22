import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { postJson, studioSig } from '@/lib/launchClient';

const LivingCoin = dynamic(() => import('@/components/token/LivingCoin'), { ssr: false });

type Prices = { enabled: boolean; prices: { draft: number; art: number; character: number }; character3dAvailable: boolean };
type Draft = { name: string; symbol: string; description: string; imagePrompt: string };
type Bubble = { who: 'monshi' | 'you'; text: string };

const GREETING = "Yo, I'm Monshi. Tell me the coin you want in a sentence and I'll set it up: name, ticker, art, even a 3D character.";

export default function ChatPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [prices, setPrices] = useState<Prices | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([{ who: 'monshi', text: GREETING }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [charId, setCharId] = useState<string | null>(null);
  const [charStage, setCharStage] = useState<string | null>(null);
  const [glb, setGlb] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string, who: Bubble['who'] = 'monshi') => setBubbles((b) => [...b, { who, text }]), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [bubbles, busy, charStage]);
  useEffect(() => { fetch('/api/v1/launch/prices').then((r) => r.json()).then(setPrices).catch(() => {}); }, []);

  const loadCredits = useCallback(async () => {
    if (!address) { setCredits(null); return; }
    try { const r = await fetch(`/api/studio/account?wallet=${address}`); if (r.ok) setCredits((await r.json()).credits ?? 0); } catch { /* ignore */ }
  }, [address]);
  useEffect(() => { loadCredits(); }, [loadCredits]);

  const sig = useCallback(() => studioSig(address!, signMessageAsync as any), [address, signMessageAsync]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    try { return await fn(); }
    catch (e: any) {
      say(e?.status === 402 ? `You need more credits for that. Top up in Studio, then try again.` : (e?.message || 'Something broke. Try again.'));
      return null;
    } finally { setBusy(null); loadCredits(); }
  }

  async function sendIdea() {
    const idea = input.trim();
    if (!address || idea.length < 3 || busy) return;
    setInput(''); say(idea, 'you');
    const d = await run('Thinking…', async () => postJson<{ draft: Draft }>('/api/v1/launch/draft', { wallet: address, signature: await sig(), prompt: idea }));
    if (!d) return;
    setDraft(d.draft); setImageUrl(null); setCharId(null); setCharStage(null); setGlb(null);
    say(`Here's the plan: ${d.draft.name} ($${d.draft.symbol}). Want me to draw it?`);
  }

  async function makeArt() {
    if (!address || !draft) return;
    const d = await run('Drawing…', async () => {
      const a = await postJson<{ image: string }>('/api/v1/launch/art', { wallet: address, signature: await sig(), imagePrompt: draft.imagePrompt });
      return postJson<{ url: string }>('/api/upload', { dataUrl: a.image });
    });
    if (d) { setImageUrl(d.url); say('Fresh art. Add a 3D living character, or go straight to launch.'); }
  }

  async function makeCharacter() {
    if (!address || !imageUrl) return;
    const d = await run('Building 3D…', async () => postJson<{ id: string }>('/api/v1/launch/character', { wallet: address, signature: await sig(), imageUrl }));
    if (d) { setCharId(d.id); setCharStage('model'); say("Building your 3D coin. This takes a few minutes, and you can watch it here."); }
  }

  useEffect(() => {
    if (!charId || charStage === 'ready' || charStage === 'failed') return;
    const t = setInterval(async () => {
      try {
        const r = await (await fetch(`/api/v1/launch/character/${charId}`)).json();
        if (r.stage) setCharStage(r.stage);
        if (r.stage === 'ready' && r.glb) { setGlb(r.glb); say(r.rigged ? 'He lives. Tilt your head, he looks back.' : 'Your 3D coin is ready.'); }
        if (r.stage === 'failed') say(r.error || '3D build failed. Credits were refunded.');
      } catch { /* retry next tick */ }
    }, 6000);
    return () => clearInterval(t);
  }, [charId, charStage, say]);

  const launchHref = draft
    ? `/create?${new URLSearchParams({ name: draft.name, symbol: draft.symbol, desc: draft.description, ...(imageUrl ? { img: imageUrl } : {}), ...(charId && charStage === 'ready' ? { cid: charId } : {}) }).toString()}`
    : '/create';

  return (
    <>
      <Head>
        <title>Launch by chat | Monpad</title>
        <meta name="description" content="Describe a coin to Monshi and launch it on Monad. Name, ticker, art and a 3D living character, made for you." />
      </Head>
      <div className="mc-wrap">
        <header className="mc-head">
          <h1>Launch by chat</h1>
          <p>Describe it. Monshi builds it. You sign the launch.</p>
          {prices && <p className="mc-prices">Draft {prices.prices.draft} cr · Art {prices.prices.art} cr{prices.character3dAvailable ? ` · 3D character ${prices.prices.character} cr` : ''}{credits !== null ? ` · You have ${credits} cr` : ''} · <Link href="/studio">Top up</Link></p>}
        </header>

        <div className="mc-log" aria-live="polite">
          {bubbles.map((b, i) => <div key={i} className={`mc-b mc-${b.who}`}>{b.text}</div>)}

          {draft && (
            <div className="mc-card">
              <div className="mc-card-top">
                {imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={imageUrl} alt="" className="mc-img" />}
                <div><strong>{draft.name}</strong> <span className="mc-tk">${draft.symbol}</span><p>{draft.description}</p></div>
              </div>
              {glb && <LivingCoin glb={glb} height={240} />}
              {charStage && charStage !== 'ready' && charStage !== 'failed' && <p className="mc-note">Building 3D ({charStage === 'model' ? 'shaping' : 'rigging'})…</p>}
              <div className="mc-actions">
                {!imageUrl && <button onClick={makeArt} disabled={!!busy}>Draw it ({prices?.prices.art ?? '…'} cr)</button>}
                {imageUrl && !charId && prices?.character3dAvailable && <button onClick={makeCharacter} disabled={!!busy}>Add 3D character ({prices.prices.character} cr)</button>}
                <Link href={launchHref} className="mc-go">Launch it</Link>
              </div>
            </div>
          )}
          {busy && <div className="mc-b mc-monshi mc-busy">{busy}</div>}
          <div ref={bottom} />
        </div>

        {!address ? (
          <div className="mc-connect"><ConnectButton /></div>
        ) : (
          <form className="mc-in" onSubmit={(e) => { e.preventDefault(); sendIdea(); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={400} placeholder="A cat that hates Mondays and burns coins…" aria-label="Describe your coin" />
            <button type="submit" disabled={!!busy || input.trim().length < 3}>Send</button>
          </form>
        )}
      </div>

      <style jsx>{`
        .mc-wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 120px; }
        .mc-head h1 { font-family: var(--font-display), sans-serif; font-size: clamp(32px, 6vw, 52px); margin: 0; }
        .mc-head p { color: var(--t3); margin: 6px 0 0; }
        .mc-prices { font-size: 12px; font-family: var(--mono); }
        .mc-prices a { color: var(--p); }
        .mc-log { display: flex; flex-direction: column; gap: 10px; margin: 20px 0; }
        .mc-b { max-width: 85%; padding: 10px 14px; border-radius: 16px; line-height: 1.45; }
        .mc-monshi { background: rgba(181,123,255,0.16); border: 1px solid rgba(181,123,255,0.35); align-self: flex-start; }
        .mc-you { background: linear-gradient(135deg, var(--p), var(--pink)); color: #fff; align-self: flex-end; }
        .mc-busy { opacity: 0.7; font-style: italic; }
        .mc-card { border: 1px solid var(--bd-glow, rgba(181,123,255,0.4)); border-radius: 16px; padding: 14px; background: rgba(18,12,32,0.8); display: grid; gap: 12px; }
        .mc-card-top { display: flex; gap: 12px; align-items: flex-start; }
        .mc-card-top p { margin: 4px 0 0; color: var(--t2); font-size: 14px; }
        .mc-img { width: 88px; height: 88px; border-radius: 12px; object-fit: cover; flex: none; }
        .mc-tk { color: var(--pink); font-weight: 700; }
        .mc-note { color: var(--t3); font-size: 13px; margin: 0; }
        .mc-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .mc-actions button, .mc-go, .mc-in button { min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid rgba(181,123,255,0.5); background: rgba(181,123,255,0.14); color: #fff; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; text-decoration: none; }
        .mc-go { background: linear-gradient(135deg, var(--p), var(--pink)); border-color: transparent; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .mc-in { position: fixed; left: 0; right: 0; bottom: 76px; max-width: 720px; margin: 0 auto; padding: 0 16px; display: flex; gap: 8px; }
        .mc-in input { flex: 1; min-height: 48px; border-radius: 12px; border: 1px solid var(--bd2, #333); background: var(--bg2, #120c20); color: #fff; padding: 0 14px; font: inherit; }
        .mc-connect { display: flex; justify-content: center; margin-top: 24px; }
        @media (min-width: 901px) { .mc-in { bottom: 20px; } }
      `}</style>
    </>
  );
}

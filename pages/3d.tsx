// pages/3d.tsx — "/3d": the ACTUAL Mon-Pad launchpad, in 3D. Same UI (real hero,
// filter tabs, and the real <TokenCard> grid), mounted on a 3D-perspective stage:
// a starfield space, Monshi glowing behind, mouse-parallax tilt, and cards that lift
// toward you on hover. It looks like the pad because it IS the pad — just dimensional.

import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import TokenGrid from '@/components/TokenGrid';
import { listV3Tokens } from '@/lib/chainV3';
import type { TokenSummary } from '@/lib/api';

type FilterKey = 'all' | 'trending' | 'near-graduation' | 'graduated';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trending', label: 'Trending' },
  { key: 'near-graduation', label: 'Near Graduation' },
  { key: 'graduated', label: 'Graduated' },
];

export default function Pad3DPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await listV3Tokens(60);
        if (cancelled) return;
        let rows = list;
        if (filter === 'graduated') rows = list.filter((t) => t.graduated);
        else if (filter === 'near-graduation') rows = list.filter((t) => !t.graduated).sort((a, b) => b.progress - a.progress);
        else if (filter === 'trending') rows = [...list].sort((a, b) => b.progress - a.progress);
        const mapped: TokenSummary[] = rows.slice(0, 12).map((t) => ({
          address: t.token, name: t.name, symbol: t.symbol, imageUrl: undefined, creator: t.creator,
          marketCapMon: (BigInt(t.priceWeiPerToken) * 1_000_000_000n).toString(),
          volume24hMon: '0', monRaisedNet: t.monRaisedNet, graduated: t.graduated, createdAt: 0, sparkline: [],
        }));
        setTokens(mapped);
        setLoading(false);
        try {
          const addrs = mapped.map((t) => t.address).join(',');
          if (addrs) {
            const metas = await fetch(`/api/token-meta?addresses=${addrs}`).then((r) => (r.ok ? r.json() : []));
            if (!cancelled && Array.isArray(metas) && metas.length) {
              const byAddr = new Map<string, string>(metas.filter((m: any) => m?.image_url).map((m: any) => [String(m.address).toLowerCase(), m.image_url as string]));
              if (byAddr.size) setTokens((prev) => prev.map((t) => ({ ...t, imageUrl: byAddr.get(t.address.toLowerCase()) || t.imageUrl })));
            }
          }
        } catch { /* logos optional */ }
      } catch { if (!cancelled) { setTokens([]); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  function onMove(e: React.MouseEvent) {
    const ry = ((e.clientX / window.innerWidth) - 0.5) * 9;
    const rx = -((e.clientY / window.innerHeight) - 0.5) * 6;
    setTilt({ x: rx, y: ry });
  }

  return (
    <>
      <Head>
        <title>Mon-Pad 3D — the launchpad, dimensional</title>
        <meta name="robots" content="noindex" />
        <style>{`
          @keyframes twinkle { 0%,100%{opacity:.5} 50%{opacity:1} }
          .pad3d-card-lift a { transition: transform .18s ease, box-shadow .18s ease; display:block; }
          .pad3d-card-lift a:hover { transform: scale(1.05); box-shadow: 0 16px 44px rgba(139,92,246,0.45); position:relative; z-index:2; }
        `}</style>
      </Head>

      <div
        onMouseMove={onMove}
        onMouseLeave={() => setTilt({ x: 0, y: 0 })}
        style={{
          position: 'fixed', inset: 0, top: 56, overflow: 'hidden', perspective: 1500,
          background: 'radial-gradient(1200px 700px at 50% -10%, #17102e 0%, #05030c 60%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* starfield */}
        <div style={{
          position: 'absolute', inset: -100, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(1.5px 1.5px at 20px 30px, #fff, transparent), radial-gradient(1.5px 1.5px at 120px 80px, #cbd5e1, transparent), radial-gradient(1px 1px at 200px 160px, #a78bfa, transparent), radial-gradient(1.5px 1.5px at 300px 50px, #fff, transparent), radial-gradient(1px 1px at 380px 220px, #fff, transparent)',
          backgroundSize: '400px 300px', opacity: 0.5, animation: 'twinkle 6s ease-in-out infinite',
          transform: `translate(${tilt.y * -3}px, ${tilt.x * 3}px)`,
        }} />

        {/* Monshi glowing behind, parallaxed for depth */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/monshi-statue.png" alt="Monshi" style={{
          position: 'absolute', left: '50%', top: '48%', height: '78%', width: 'auto',
          transform: `translate(-50%,-50%) translate(${tilt.y * -6}px, ${tilt.x * 6}px)`,
          opacity: 0.16, filter: 'drop-shadow(0 0 60px rgba(139,92,246,0.9))', pointerEvents: 'none', userSelect: 'none',
        }} draggable={false} />

        {/* The pad, on a 3D stage */}
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            width: 'min(1120px, 94vw)', padding: '22px 8px 60px',
            transformStyle: 'preserve-3d',
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transition: 'transform .15s ease-out',
          }}>
            {/* hero */}
            <div style={{ textAlign: 'center', marginBottom: 16, transform: 'translateZ(60px)' }}>
              <h1 style={{ fontSize: 30, fontWeight: 900, color: '#fff', margin: 0, textShadow: '0 0 22px rgba(139,92,246,0.8)' }}>
                Launch a coin. <span style={{ color: '#a78bfa' }}>Earn forever.</span>
              </h1>
              <p style={{ marginTop: 6, fontSize: 14, color: 'rgba(220,215,240,0.75)' }}>
                Pocket fees on every trade + <b style={{ color: '#4ADE80' }}>~$800</b> when your coin graduates.
              </p>
              <Link href="/create" style={{ display: 'inline-block', marginTop: 12, background: '#8B5CF6', color: '#fff', textDecoration: 'none', fontWeight: 800, padding: '11px 22px', borderRadius: 10, boxShadow: '0 0 24px rgba(139,92,246,0.5)' }}>+ Create coin</Link>
            </div>

            {/* filter tabs */}
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 18, transform: 'translateZ(40px)' }}>
              {FILTERS.map((f) => {
                const active = f.key === filter;
                return (
                  <button key={f.key} onClick={() => setFilter(f.key)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '6px 2px',
                    fontWeight: active ? 800 : 500, color: active ? '#a78bfa' : 'rgba(220,215,240,0.7)',
                    borderBottom: active ? '2px solid #8B5CF6' : '2px solid transparent',
                  }}>{f.label}</button>
                );
              })}
            </div>

            {/* the REAL pad grid, lifted in 3D */}
            <div className="pad3d-card-lift" style={{ transform: 'translateZ(20px)' }}>
              <TokenGrid tokens={tokens} loading={loading} />
            </div>
          </div>
        </div>

        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px', zIndex: 60 }}>← Back to Mon-Pad</Link>
        <div style={{ position: 'absolute', bottom: 16, left: 18, fontSize: 12, color: '#7c6aa8', pointerEvents: 'none' }}>move your mouse — the pad tilts in 3D · hover a coin</div>
      </div>
    </>
  );
}

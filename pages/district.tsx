// pages/district.tsx — "Monshi District" (Phase-0 land ownership mock, special link)
// A bounded neon city: buy plots with MONSHI, prime plots near the central Trending
// Stage cost the most, owned plots build up with token signage, some are rentable.
// All mock/visual for now — proves the vibe before any land contract is written.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Plot } from '@/components/District3D';

const District3D = dynamic(() => import('@/components/District3D'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      surveying the district…
    </div>
  ),
});

const N = 12, SP = 2.2;
const NAMES = ['Shiba Chief', 'Pepe Prime', 'Raging Bull', 'Botcat', 'Gold Ape', 'Arch Mage', 'Pandeez', 'Lionheart', 'Moony', 'Diamond Hands', 'The Reaper', 'Puppo', 'Shadow Ninja', 'To The Moon', 'Banana Gang', 'Laser Cat'];
const hash = (n: number) => Math.floor(Math.abs(Math.sin(n * 127.1) * 43758.5453) % 1 * 1_000_000);
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);

function buildPlots(): Plot[] {
  const plots: Plot[] = [];
  const half = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i - half) * SP, z = (j - half) * SP;
      if (Math.hypot(x, z) < 4.2) continue; // reserve the hub
      const ring = Math.max(Math.abs(i - half), Math.abs(j - half));
      const zone: Plot['zone'] = ring <= 2.5 ? 'prime' : ring <= 4.5 ? 'standard' : 'outer';
      const h = hash(i * 100 + j + 7);
      const ownedPct = zone === 'prime' ? 74 : zone === 'standard' ? 46 : 26;
      const owned = h % 100 < ownedPct;
      const pfp = (h % 16) + 1;
      const height = zone === 'prime' ? 2.6 + (h % 150) / 100 : zone === 'standard' ? 1.6 + (h % 120) / 100 : 1.0 + (h % 70) / 100;
      const forRent = owned && h % 5 === 0;
      const price = zone === 'prime' ? 5_000_000 : zone === 'standard' ? 1_000_000 : 250_000;
      plots.push({ id: `${i}-${j}`, i, j, x, z, zone, owned, pfp, height, forRent, price, name: NAMES[pfp - 1] });
    }
  }
  return plots;
}

const card = { background: 'rgba(12,8,22,0.92)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 12 };

export default function DistrictPage() {
  const plots = useMemo(buildPlots, []);
  const [sel, setSel] = useState<Plot | null>(null);

  const counts = useMemo(() => ({
    total: plots.length,
    available: plots.filter((p) => !p.owned).length,
    owned: plots.filter((p) => p.owned).length,
    rent: plots.filter((p) => p.forRent).length,
    primeLeft: plots.filter((p) => p.zone === 'prime' && !p.owned).length,
  }), [plots]);

  const zoneLabel = { prime: 'Prime · trackside', standard: 'Standard', outer: 'Outer' };
  const zoneColor = { prime: '#FFD700', standard: '#c4b5fd', outer: '#8b7fb0' };

  return (
    <>
      <Head>
        <title>Monshi District (3D) | Mon-Pad</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, top: 56, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        <District3D plots={plots} onSelect={setSel} />

        {/* Title */}
        <div style={{ position: 'absolute', top: 14, left: 18, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', textShadow: '0 0 16px rgba(139,92,246,0.8)' }}>MONSHI <span style={{ color: '#a78bfa' }}>DISTRICT</span></span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#000', background: '#a78bfa', padding: '2px 7px', borderRadius: 999 }}>LAND · MOCK</span>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: '#9aa4b2' }}>drag to orbit · scroll to zoom · click a plot to buy</div>
        </div>

        {/* Counts */}
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 14, ...card, padding: '7px 14px', fontSize: 12, color: '#cbd5e1' }}>
          <span>🟢 <b style={{ color: '#fff' }}>{counts.available}</b> for sale</span>
          <span>🏙 <b style={{ color: '#fff' }}>{counts.owned}</b> owned</span>
          <span>🏷 <b style={{ color: '#fff' }}>{counts.rent}</b> to rent</span>
          <span>👑 <b style={{ color: '#FFD700' }}>{counts.primeLeft}</b> prime left</span>
        </div>

        {/* Legend */}
        <div style={{ position: 'absolute', bottom: 16, left: 18, fontSize: 12, color: '#cbd5e1', ...card, padding: '9px 12px', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 800, color: '#fff', marginBottom: 2 }}>The district</div>
          <div>👑 gold = <b>prime</b> (by the Trending Stage — most eyeballs, priciest)</div>
          <div>🟣 violet = standard · ⚫ dim = outer</div>
          <div>🏙 towers = owned projects · 🟢 green roof = for rent</div>
        </div>

        {/* Buy / plot panel */}
        {sel && (
          <div onClick={() => setSel(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(400px, 92vw)', padding: 20, color: '#fff', boxShadow: '0 0 40px rgba(139,92,246,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Plot ({sel.i}, {sel.j})</div>
                <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#9aa4b2', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 13, marginBottom: 12, color: zoneColor[sel.zone], fontWeight: 700 }}>{zoneLabel[sel.zone]} zone</div>

              {sel.owned ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/mock/pfp${String(sel.pfp).padStart(2, '0')}.png`} alt={sel.name} width={42} height={42} style={{ borderRadius: 8 }} />
                    <div>
                      <div style={{ fontWeight: 700 }}>Owned — <span style={{ color: '#c4b5fd' }}>{sel.name}</span></div>
                      <div style={{ fontSize: 12, color: '#9aa4b2' }}>{sel.forRent ? '🏷 available to rent' : 'not listed'}</div>
                    </div>
                  </div>
                  {sel.forRent ? (
                    <button style={{ width: '100%', background: '#4ADE80', color: '#04120a', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}>Rent · {fmtK(Math.round(sel.price / 20))} MONSHI / week</button>
                  ) : (
                    <button style={{ width: '100%', ...card, border: '1px solid #8B5CF6', color: '#fff', padding: 12, borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Make an offer</button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: '#9aa4b2', marginBottom: 6 }}>Price</div>
                  <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 12 }}>{fmtK(sel.price)} <span style={{ fontSize: 14, color: '#a78bfa' }}>MONSHI</span></div>
                  <button style={{ width: '100%', background: '#8B5CF6', color: '#fff', border: 'none', padding: 12, borderRadius: 10, fontWeight: 800, cursor: 'pointer', marginBottom: 8 }}>Buy plot</button>
                  <div style={{ fontSize: 11, color: '#7c6aa8', textAlign: 'center' }}>🔥 70% burned · 30% treasury · then build & rent it out</div>
                </>
              )}
            </div>
          </div>
        )}

        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px', zIndex: 60 }}>← Back to Mon-Pad</Link>
      </div>
    </>
  );
}

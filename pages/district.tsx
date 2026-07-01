// pages/district.tsx — "Mon-Pad City, powered by MONSHI" (Phase-0 land mock).
// A large zoned city: Downtown (premium, by the Trending Stage) → Business →
// Residential → Entertainment. Buy plots with MONSHI, build businesses, rent them
// out. All mock/visual — proves the full city vision before any land contract.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Plot, District } from '@/components/District3D';

const District3D = dynamic(() => import('@/components/District3D'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      building the city…
    </div>
  ),
});

const N = 22, SP = 2.4;
const NAMES = ['Shiba Chief', 'Pepe Prime', 'Raging Bull', 'Botcat', 'Gold Ape', 'Arch Mage', 'Pandeez', 'Lionheart', 'Moony', 'Diamond Hands', 'The Reaper', 'Puppo', 'Shadow Ninja', 'To The Moon', 'Banana Gang', 'Laser Cat'];

const DIST: Record<District, { label: string; color: string; neon: string; price: number; chip: string }> = {
  downtown: { label: 'Downtown', color: '#2a2010', neon: '#FFD700', price: 10_000_000, chip: '#FFD700' },
  business: { label: 'Business District', color: '#1c1533', neon: '#8B5CF6', price: 3_000_000, chip: '#c4b5fd' },
  residential: { label: 'Residential', color: '#0f2222', neon: '#2dd4bf', price: 750_000, chip: '#5eead4' },
  entertainment: { label: 'Entertainment', color: '#26102a', neon: '#ff4fd8', price: 2_000_000, chip: '#f0abfc' },
};
const BIZ: Record<string, { icon: string; label: string }> = {
  hq: { icon: '🏢', label: 'Token HQ' },
  trade: { icon: '📈', label: 'Trading Desk' },
  bank: { icon: '🏦', label: 'Vault / Bank' },
  boost: { icon: '🔥', label: 'Boost Agency' },
  ad: { icon: '📺', label: 'Ad Agency' },
  predict: { icon: '🎰', label: 'Prediction Parlor' },
  gallery: { icon: '🖼️', label: 'Gallery' },
};

const hash = (n: number) => Math.floor(Math.abs(Math.sin(n * 127.1) * 43758.5453) % 1 * 1_000_000);
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);

function buildPlots(): Plot[] {
  const plots: Plot[] = [];
  const half = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = (i - half) * SP, z = (j - half) * SP;
      const d = Math.hypot(x, z);
      if (d < 5.5) continue; // hub
      const district: District = d < 14 ? 'downtown' : d < 24 ? 'business' : d < 33 ? 'residential' : 'entertainment';
      const m = DIST[district];
      const h = hash(i * 100 + j + 7);
      const ownedPct = district === 'downtown' ? 88 : district === 'business' ? 64 : district === 'residential' ? 44 : 58;
      const owned = h % 100 < ownedPct;
      const pfp = (h % 16) + 1;
      const height =
        district === 'downtown' ? 4 + Math.max(0, 14 - d) * 0.42 + (h % 180) / 100 :
        district === 'business' ? 2.4 + (h % 260) / 100 :
        district === 'residential' ? 1.2 + (h % 170) / 100 :
        2 + (h % 240) / 100;
      const biz =
        district === 'downtown' ? ['hq', 'trade', 'bank'][h % 3] :
        district === 'business' ? ['boost', 'ad', 'hq'][h % 3] :
        district === 'residential' ? 'hq' :
        ['predict', 'gallery'][h % 2];
      const forRent = owned && h % 6 === 0;
      const price = Math.round((m.price * (district === 'downtown' ? 1 + Math.max(0, 14 - d) * 0.06 : 1)) / 1000) * 1000;
      plots.push({ id: `${i}-${j}`, i, j, x, z, district, biz, owned, pfp, height, forRent, price, name: NAMES[pfp - 1], color: m.color, neon: m.neon });
    }
  }
  return plots;
}

const card = { background: 'rgba(12,8,22,0.92)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 12 };

export default function CityPage() {
  const plots = useMemo(buildPlots, []);
  const [sel, setSel] = useState<Plot | null>(null);

  const counts = useMemo(() => ({
    available: plots.filter((p) => !p.owned).length,
    owned: plots.filter((p) => p.owned).length,
    rent: plots.filter((p) => p.forRent).length,
    downtownLeft: plots.filter((p) => p.district === 'downtown' && !p.owned).length,
  }), [plots]);

  return (
    <>
      <Head>
        <title>Mon-Pad City (3D) | powered by MONSHI</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, top: 56, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        <District3D plots={plots} onSelect={setSel} />

        {/* Title */}
        <div style={{ position: 'absolute', top: 14, left: 18, pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', textShadow: '0 0 16px rgba(139,92,246,0.85)' }}>
            MON-PAD <span style={{ color: '#a78bfa' }}>CITY</span>
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>powered by MONSHI · <span style={{ color: '#9aa4b2', fontWeight: 400 }}>drag to orbit · click a plot to buy</span></div>
        </div>

        {/* Counts */}
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 14, ...card, padding: '7px 14px', fontSize: 12, color: '#cbd5e1' }}>
          <span>🟢 <b style={{ color: '#fff' }}>{counts.available}</b> for sale</span>
          <span>🏙 <b style={{ color: '#fff' }}>{counts.owned}</b> built</span>
          <span>🏷 <b style={{ color: '#fff' }}>{counts.rent}</b> to rent</span>
          <span>👑 <b style={{ color: '#FFD700' }}>{counts.downtownLeft}</b> downtown left</span>
        </div>

        {/* Districts legend */}
        <div style={{ position: 'absolute', bottom: 16, left: 18, fontSize: 12, color: '#cbd5e1', ...card, padding: '9px 12px', lineHeight: 1.8 }}>
          <div style={{ fontWeight: 800, color: '#fff', marginBottom: 2 }}>Districts</div>
          {(Object.keys(DIST) as District[]).map((d) => (
            <div key={d}><span style={{ color: DIST[d].chip, fontWeight: 700 }}>●</span> {DIST[d].label} — {fmtK(DIST[d].price)} MONSHI{d === 'downtown' ? ' (by the Trending Stage)' : ''}</div>
          ))}
        </div>

        {/* Plot panel */}
        {sel && (
          <div onClick={() => setSel(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(410px, 92vw)', padding: 20, color: '#fff', boxShadow: '0 0 40px rgba(139,92,246,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Plot ({sel.i}, {sel.j})</div>
                <button onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#9aa4b2', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: DIST[sel.district].chip }}>{DIST[sel.district].label}</span>
                <span style={{ fontSize: 12, color: '#9aa4b2' }}>· {BIZ[sel.biz].icon} {BIZ[sel.biz].label}</span>
              </div>

              {sel.owned ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/mock/pfp${String(sel.pfp).padStart(2, '0')}.png`} alt={sel.name} width={42} height={42} style={{ borderRadius: 8 }} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{BIZ[sel.biz].label} — <span style={{ color: '#c4b5fd' }}>{sel.name}</span></div>
                      <div style={{ fontSize: 12, color: '#9aa4b2' }}>{sel.forRent ? '🏷 available to rent' : 'owned · not listed'}</div>
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
                  <div style={{ fontSize: 13, color: '#9aa4b2', marginBottom: 4 }}>Empty lot — build a {BIZ[sel.biz].label.toLowerCase()}</div>
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

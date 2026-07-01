// pages/3d.tsx — "/3d": the entire Mon-Pad homepage as REAL 3D geometry (hero text,
// buttons, and token-card kiosks are all objects in a lit 3D scene you orbit).
// Uses live tokens + logos, blended with demo projects so it's always populated.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { listV3Tokens } from '@/lib/chainV3';
import type { Card, FilterKey } from '@/components/Pad3DScene';

const Pad3DScene = dynamic(() => import('@/components/Pad3DScene'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      building Mon-Pad in 3D…
    </div>
  ),
});

const MOCKS = [
  { n: 'Shiba Chief', s: 'SHIBC' }, { n: 'Pepe Prime', s: 'PEPE' }, { n: 'Raging Bull', s: 'BULL' },
  { n: 'Botcat', s: 'BOTC' }, { n: 'Gold Ape', s: 'APE' }, { n: 'Arch Mage', s: 'MAGE' },
  { n: 'Pandeez', s: 'PNDA' }, { n: 'Lionheart', s: 'LION' }, { n: 'Laser Cat', s: 'LSR' },
];
const pfp = (i: number) => `/mock/pfp${String((i % 16) + 1).padStart(2, '0')}.png`;
function demoCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => {
    const m = MOCKS[i % MOCKS.length];
    const r = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const graduated = i % 8 === 0;
    return { name: m.n, symbol: m.s, address: '', img: pfp(i), progress: graduated ? 1 : Math.min(0.98, 0.06 + r * 0.9), graduated, boosted: i % 6 === 0, mcMon: 900 + Math.abs(Math.cos(i * 7.13) * 90000) };
  });
}

export default function Pad3DPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const SHOW = 9;
    (async () => {
      try {
        const list = await listV3Tokens(60);
        if (cancelled) return;
        let rows = list;
        if (filter === 'graduated') rows = list.filter((t) => t.graduated);
        else if (filter === 'near-graduation') rows = list.filter((t) => !t.graduated).sort((a, b) => b.progress - a.progress);
        else if (filter === 'trending') rows = [...list].sort((a, b) => b.progress - a.progress);
        const real: Card[] = rows.slice(0, SHOW).map((t, i) => {
          let mcMon = 0;
          try { mcMon = Number(formatEther(BigInt(t.priceWeiPerToken))) * 1e9; } catch { mcMon = 0; }
          return { name: t.name, symbol: t.symbol, address: t.token, img: pfp(i), progress: t.progress, graduated: t.graduated, mcMon };
        });
        const addrs = real.map((r) => r.address).filter(Boolean);
        if (addrs.length) {
          try {
            const res = await fetch(`/api/token-meta?addresses=${addrs.join(',')}`);
            if (res.ok) {
              const meta = (await res.json()) as { address: string; image_url?: string }[];
              const imgs = new Map(meta.map((m) => [m.address.toLowerCase(), m.image_url]));
              real.forEach((r) => { const u = imgs.get(r.address.toLowerCase()); if (u) r.img = u; });
            }
          } catch { /* logos optional */ }
        }
        if (cancelled) return;
        setCards([...real, ...demoCards(Math.max(0, SHOW - real.length))].slice(0, SHOW));
      } catch { if (!cancelled) setCards(demoCards(9)); }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <>
      <Head>
        <title>Mon-Pad 3D</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, top: 56, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        {cards ? <Pad3DScene cards={cards} filter={filter} onFilter={setFilter} /> : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa' }}>building Mon-Pad in 3D…</div>
        )}
        <div style={{ position: 'absolute', top: 14, left: 18, pointerEvents: 'none' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', textShadow: '0 0 16px rgba(139,92,246,0.85)' }}>MON-PAD <span style={{ color: '#a78bfa' }}>3D</span></div>
          <div style={{ marginTop: 3, fontSize: 12, color: '#9aa4b2' }}>drag to orbit · everything here is a 3D object · click a coin to trade</div>
        </div>
        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px', zIndex: 60 }}>← Back to Mon-Pad</Link>
      </div>
    </>
  );
}

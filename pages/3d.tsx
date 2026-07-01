// pages/3d.tsx — "/3d": a 3D version of the Mon-Pad homepage. The token feed as a
// curved wall of real UI cards floating around Monshi. Live tokens (with logos) blended
// with demo projects so it's always populated. Click a card → its token page.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { listV3Tokens } from '@/lib/chainV3';
import type { Card } from '@/components/Web3D';

const Web3D = dynamic(() => import('@/components/Web3D'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      rendering Mon-Pad in 3D…
    </div>
  ),
});

const MOCKS = [
  { n: 'Shiba Chief', s: 'SHIBC' }, { n: 'Pepe Prime', s: 'PEPE' }, { n: 'Raging Bull', s: 'BULL' },
  { n: 'Botcat', s: 'BOTC' }, { n: 'Gold Ape', s: 'APE' }, { n: 'Arch Mage', s: 'MAGE' },
  { n: 'Pandeez', s: 'PNDA' }, { n: 'Lionheart', s: 'LION' }, { n: 'Moony', s: 'MOON' },
  { n: 'Diamond Hands', s: 'DMND' }, { n: 'The Reaper', s: 'RIP' }, { n: 'Laser Cat', s: 'LSR' },
];
const pfp = (i: number) => `/mock/pfp${String((i % 16) + 1).padStart(2, '0')}.png`;
function demoCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => {
    const m = MOCKS[i % MOCKS.length];
    const r = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const graduated = i % 11 === 0;
    return { name: m.n, symbol: m.s, address: '', img: pfp(i), progress: graduated ? 1 : Math.min(0.98, 0.05 + r * 0.9), graduated, boosted: i % 7 === 0, mcMon: 800 + Math.abs(Math.cos(i * 7.13) * 90000) };
  });
}

export default function ThreeDPage() {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const SHOW = 12;
    listV3Tokens(60)
      .then(async (toks) => {
        if (cancelled) return;
        const real: Card[] = toks.map((t, i) => {
          let mcMon = 0;
          try { mcMon = Number(formatEther(BigInt(t.priceWeiPerToken))) * 1e9; } catch { mcMon = 0; }
          return { name: t.name, symbol: t.symbol, address: t.token, img: pfp(i), progress: t.progress, graduated: t.graduated, mcMon };
        });
        const addrs = real.map((r) => r.address).filter(Boolean);
        if (addrs.length) {
          try {
            const res = await fetch(`/api/token-meta?addresses=${addrs.slice(0, 60).join(',')}`);
            if (res.ok) {
              const rows = (await res.json()) as { address: string; image_url?: string }[];
              const imgs = new Map(rows.map((r) => [r.address.toLowerCase(), r.image_url]));
              real.forEach((r) => { const u = imgs.get(r.address.toLowerCase()); if (u) r.img = u; });
            }
          } catch { /* logos best-effort */ }
        }
        if (cancelled) return;
        const blended = [...real, ...demoCards(Math.max(0, SHOW - real.length))].slice(0, SHOW);
        setCards(blended);
      })
      .catch(() => { if (!cancelled) setCards(demoCards(12)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Head>
        <title>Mon-Pad 3D</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, top: 56, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        {cards ? <Web3D cards={cards} /> : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa' }}>rendering Mon-Pad in 3D…</div>
        )}

        <div style={{ position: 'absolute', top: 14, left: 18, pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', textShadow: '0 0 16px rgba(139,92,246,0.85)' }}>MON-PAD <span style={{ color: '#a78bfa' }}>3D</span></div>
          <div style={{ marginTop: 3, fontSize: 12, color: '#9aa4b2' }}>the pad, in 3D · drag to orbit · click a card to trade</div>
        </div>

        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px', zIndex: 60 }}>← Back to Mon-Pad</Link>
      </div>
    </>
  );
}

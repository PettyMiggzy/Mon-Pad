// pages/launch.tsx — 3D "Launch Bay" preview (special link: /launch)
// Tokens render as rockets; fuel gauge = bonding progress; gold = boosted;
// green + lifted = graduated. Live tokens from chain, with demo rockets blended
// in so every state is visible even before there's much on-chain activity.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { listV3Tokens } from '@/lib/chainV3';
import type { Rocket } from '@/components/LaunchBay3D';

function Loading() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>MON-PAD · LAUNCH BAY</div>
        <div style={{ marginTop: 8, color: '#7c6aa8' }}>spinning up the 3D bay…</div>
      </div>
    </div>
  );
}

const LaunchBay3D = dynamic(() => import('@/components/LaunchBay3D'), { ssr: false, loading: () => <Loading /> });

// Demo rockets to showcase every state (used to fill the bay / as fallback).
const DEMO: Rocket[] = [
  { name: 'Boosted Demo', symbol: 'BOOST', address: '', progress: 0.97, graduated: false, boosted: true },
  { name: 'Launched Demo', symbol: 'MOON', address: '', progress: 1, graduated: true },
  { name: 'Near Grad', symbol: 'SOON', address: '', progress: 0.9, graduated: false },
  { name: 'Fueling', symbol: 'PUMP', address: '', progress: 0.62, graduated: false },
  { name: 'Rising', symbol: 'GEM', address: '', progress: 0.44, graduated: false },
  { name: 'Fresh Mint', symbol: 'NEW', address: '', progress: 0.16, graduated: false },
  { name: 'Launched Demo 2', symbol: 'STAR', address: '', progress: 1, graduated: true },
  { name: 'Steady', symbol: 'HODL', address: '', progress: 0.33, graduated: false },
];

export default function LaunchPage() {
  const [rockets, setRockets] = useState<Rocket[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listV3Tokens(24)
      .then((toks) => {
        if (cancelled) return;
        const real: Rocket[] = toks.map((t) => ({
          name: t.name, symbol: t.symbol, address: t.token, progress: t.progress, graduated: t.graduated,
        }));
        // demo flourish: mark the highest-progress non-graduated token as boosted so the gold state shows
        let topIdx = -1, topP = -1;
        real.forEach((r, i) => { if (!r.graduated && r.progress > topP) { topP = r.progress; topIdx = i; } });
        if (topIdx >= 0) real[topIdx].boosted = true;
        const blended = real.length < 8 ? [...real, ...DEMO.slice(0, 8 - real.length)] : real;
        setRockets(blended.length ? blended : DEMO);
      })
      .catch(() => { if (!cancelled) setRockets(DEMO); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Head>
        <title>Launch Bay (3D preview) | Mon-Pad</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, background: '#05030c', overflow: 'hidden' }}>
        {rockets ? <LaunchBay3D rockets={rockets} /> : <Loading />}

        {/* Title + preview badge */}
        <div style={{ position: 'absolute', top: 18, left: 20, pointerEvents: 'none', fontFamily: 'system-ui' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: 0.5, textShadow: '0 0 16px rgba(139,92,246,0.8)' }}>
              MON-PAD <span style={{ color: '#a78bfa' }}>LAUNCH BAY</span>
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#000', background: '#a78bfa', padding: '2px 7px', borderRadius: 999, letterSpacing: 1 }}>3D PREVIEW</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#9aa4b2' }}>drag to orbit · scroll to zoom · click a rocket to open its token</div>
        </div>

        {/* Legend */}
        <div style={{ position: 'absolute', bottom: 18, left: 20, fontFamily: 'system-ui', fontSize: 12, color: '#cbd5e1', background: 'rgba(10,6,20,0.6)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '10px 12px', lineHeight: 1.8 }}>
          <div style={{ fontWeight: 800, color: '#fff', marginBottom: 2 }}>Legend</div>
          <div>🟪 fuel gauge = bonding progress</div>
          <div>🟡 gold + sparkle = boosted / trending</div>
          <div>🟢 green + liftoff = graduated to DEX</div>
        </div>

        {/* Back link */}
        <Link href="/" style={{ position: 'absolute', top: 18, right: 20, fontFamily: 'system-ui', fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px' }}>
          ← Back to Mon-Pad
        </Link>
      </div>
    </>
  );
}

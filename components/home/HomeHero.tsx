// Home hero: headline + CTA with the Monshi statue, live stats, and the trust strip. Percents come from lib/fees.ts.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { feePct, LP_FEE_SLICES } from '@/lib/fees';

const SLICE_COLOR: Record<string, string> = { creator: '#836EF9', platform: '#A0055D', monshi: '#FF8A3D', project: '#2FD27A' };
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString());

export function HomeHero({ listed, totalMcapUsd }: { listed: number | null; totalMcapUsd: number | null }) {
  const [burned, setBurned] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/v1/burn').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.burnedWhole) setBurned(j.burnedWhole); }).catch(() => {});
  }, []);
  return (
    <div className="hh">
      <div className="hh-hero">
        <p className="pad-kicker" style={{ margin: 0 }}>Monad · 143</p>
        <h1>Launch a coin. Liquidity locked from block one.</h1>
        <p>One transaction, no creation fee. Pay in MON. Creators earn {feePct(LP_FEE_SLICES[0].bps)} of every trading fee.</p>
        <div className="acts">
          <Link href="/create" className="pad-launch">+ Launch a coin</Link>
          <a href="#board" className="pad-ghost" style={{ borderRadius: 10 }}>The board</a>
        </div>
        <img className="statue" src="/monshi-statue.png" alt="Monshi" />
      </div>
      <div className="hh-side">
        <div className="hh-stats">
          <div className="hh-stat"><small>Coins listed</small><b>{listed ?? '—'}</b></div>
          <div className="hh-stat"><small>Total market cap</small><b>{totalMcapUsd == null ? '—' : `$${compact(totalMcapUsd)}`}</b></div>
          <div className="hh-stat"><small>MONSHI burned</small><b>{burned == null ? '—' : compact(burned)}</b></div>
          <div className="hh-stat"><small>Creation fee</small><b>Free</b></div>
        </div>
        <div className="hh-trust">
          <div className="hh-badges"><span className="hh-badge">🔒 Liquidity locked · Uniswap V4</span><span className="hh-badge">✅ No rug</span></div>
          <div className="hh-bar">
            {LP_FEE_SLICES.map((s) => <i key={s.id} style={{ width: `${s.bps / 100}%`, background: SLICE_COLOR[s.id] || '#836EF9' }} />)}
          </div>
          <div className="hh-key">
            {LP_FEE_SLICES.map((s) => <span key={s.id}><i style={{ background: SLICE_COLOR[s.id] || '#836EF9' }} />{feePct(s.bps)} {s.label}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

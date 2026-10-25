// Landing hero (V4 pad): wordmark, tagline, CTAs and live stats over the Monshi artwork. Numbers are live, never invented.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, Coins, Flame, Gift, Rocket } from 'lucide-react';

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString());

export function LaunchHero({ listed, totalMcapUsd }: { listed: number | null; totalMcapUsd: number | null }) {
  const [burned, setBurned] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/v1/burn').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.burnedWhole) setBurned(j.burnedWhole); }).catch(() => {});
  }, []);
  const stats = [
    { icon: Boxes, value: listed == null ? '—' : String(listed), label: 'Coins launched' },
    { icon: Coins, value: totalMcapUsd == null ? '—' : `$${compact(totalMcapUsd)}`, label: 'Total market cap' },
    { icon: Flame, value: burned == null ? '—' : compact(burned), label: 'MONSHI burned' },
    { icon: Gift, value: 'Free', label: 'Creation fee' },
  ];
  return (
    <section className="lh-hero">
      <div className="lh-copy">
        <h1 className="lh-word" aria-label="Monpad">MONPAD</h1>
        <div className="lh-tag">THE LAUNCHPAD<br />FOR <span>MONAD</span></div>
        <p className="lh-sub">Launch a coin in one transaction. Liquidity is locked from block one on Uniswap V4. Pay in MON. Fair, transparent, community driven.</p>
        <div className="lh-cta">
          <a href="#board" className="lh-btn lh-btn-p"><Rocket size={18} />Explore Launches<ArrowRight size={16} /></a>
          <Link href="/create" className="lh-btn lh-btn-g">+ Launch a coin</Link>
        </div>
        <div className="lh-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div className="lh-stat" key={s.label}>
                <Icon size={26} strokeWidth={1.6} />
                <div><b>{s.value}</b><small>{s.label}</small></div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="lh-script" aria-hidden>
        <svg width="46" height="34" viewBox="0 0 46 34" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round"><path d="M3 30 L6 8 L16 18 L23 4 L30 18 L40 8 L43 30 Z" /></svg>
        <span>Build.<br />Launch.<br />Grow.<br /><em>on Monad</em></span>
      </div>
    </section>
  );
}

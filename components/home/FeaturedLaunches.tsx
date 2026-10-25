// "Featured Launches" row: the top coins on the pad as glass cards. Progress is market cap toward the next round milestone.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { TokenSummary } from '@/lib/api';
import { feePct } from '@/lib/fees';

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 })}`);
const mcapOf = (t: TokenSummary) => Number(BigInt(t.marketCapMon || '0') / 10n ** 12n) / 1e6;
const nextMilestone = (m: number) => { let g = 10_000; while (g <= m && g < 1e12) g *= 10; return g; };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const TABS = ['Top', 'New', 'All'] as const;

export function FeaturedLaunches({ tokens, loading }: { tokens: TokenSummary[]; loading: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Top');
  const rows = useMemo(() => {
    const r = [...tokens];
    if (tab === 'New') return r.slice(0, 3); // listV4Tokens is newest first
    return r.sort((a, b) => mcapOf(b) - mcapOf(a)).slice(0, 3);
  }, [tokens, tab]);
  return (
    <section className="lh-sec">
      <div className="lh-sec-head">
        <div><h2>Featured Launches</h2><p>The biggest coins on the pad, live from the chain.</p></div>
        <div className="lh-tabs" role="tablist">
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
        </div>
        <a href="#board" className="lh-viewall">View All <ArrowRight size={15} /></a>
      </div>
      <div className="lh-cards">
        {loading && rows.length === 0 && [0, 1, 2].map((i) => <div className="lh-card lh-skel" key={i} />)}
        {rows.map((t) => {
          const m = mcapOf(t);
          const goal = nextMilestone(m);
          const pct = Math.max(2, Math.min(100, (m / goal) * 100));
          return (
            <Link href={`/token/${t.address}`} className="lh-card" key={t.address}>
              <div className="lh-card-top">
                {t.imageUrl ? <img src={t.imageUrl} alt="" className="lh-ava" /> : <span className="lh-ava lh-ava-l">{(t.symbol || '?').slice(0, 1)}</span>}
                <div className="lh-card-t"><b>{t.name}</b>
                  <span className="lh-tags"><i>${t.symbol}</i><i>Uniswap V4</i><i>Fee {feePct(t.feeBps ?? 100)}</i></span>
                </div>
                <span className="lh-live"><u />Live now</span>
              </div>
              <p className="lh-card-d">Liquidity locked. Launched by {short(t.creator)}. Trades in MON or USDC.</p>
              <div className="lh-prog"><i style={{ width: `${pct}%` }} /></div>
              <div className="lh-card-f"><span>{usd(m)} <em>/ {usd(goal)}</em></span><span>{pct.toFixed(0)}%</span></div>
            </Link>
          );
        })}
        {!loading && Array.from({ length: Math.max(0, 3 - rows.length) }).map((_, i) => (
          <Link href="/create" className="lh-card lh-yours" key={`y${i}`}>
            <span className="lh-ava lh-ava-l">+</span>
            <b>{rows.length === 0 && i === 0 ? 'Launch the first coin' : 'Your coin here'}</b>
            <p className="lh-card-d">Free to launch. Liquidity locked from block one. Pay in MON.</p>
            <span className="lh-viewall">Launch a coin <ArrowRight size={15} /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

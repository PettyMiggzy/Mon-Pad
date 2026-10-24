// "Pool depth": what a trade of each size would cost, from live router simulations. The pool is an AMM, not an order book.
import { useEffect, useState } from 'react';
import { poolDepth, type DepthRow, type V4Token } from '@/lib/v4/chain';

const px = (n: number) => (n >= 1 ? n.toFixed(4) : n.toPrecision(3));

function Row({ r, side }: { r: DepthRow; side: 'buy' | 'sell' }) {
  const w = r.impactPct == null ? 0 : Math.min(100, Math.abs(r.impactPct) * 4);
  return (
    <div className={`xch-dep-row ${side}`}>
      <i style={{ width: `${w}%` }} />
      <span>${r.usdc.toLocaleString()}</span>
      <span>{r.avgPrice == null ? 'n/a' : px(r.avgPrice)}</span>
      <span>{r.impactPct == null ? 'too large' : `${r.impactPct.toFixed(2)}%`}</span>
    </div>
  );
}

export default function DepthPanel({ token }: { token: V4Token }) {
  const [d, setD] = useState<{ buys: DepthRow[]; sells: DepthRow[] } | null>(null);
  useEffect(() => {
    let off = false;
    const run = () => poolDepth(token).then((x) => { if (!off) setD(x); }).catch(() => {});
    run();
    const i = setInterval(run, 30000);
    return () => { off = true; clearInterval(i); };
  }, [token.address, Math.round(token.priceUsdc * 1e9)]);
  return (
    <div className="xch-panel">
      <div className="xch-ph">POOL DEPTH · price impact by size</div>
      <div className="xch-dep-head"><span>Size</span><span>Avg price</span><span>Impact</span></div>
      {d ? [...d.buys].reverse().map((r) => <Row key={`b${r.usdc}`} r={r} side="buy" />) : <div className="xch-dim">Loading…</div>}
      <div className="xch-mid">{px(token.priceUsdc)} <small>last</small></div>
      {d && d.sells.map((r) => <Row key={`s${r.usdc}`} r={r} side="sell" />)}
      <div className="xch-note">Red rows: buying that much. Green rows: selling that much. Includes the 1% fee + creator tax.</div>
    </div>
  );
}

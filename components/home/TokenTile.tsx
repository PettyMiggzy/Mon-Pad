import Link from 'next/link';
import type { TokenSummary } from '@/lib/api';
import { fmtMon } from '@/lib/format';
import { isDemoAddress } from '@/lib/demo';

function ageLabel(createdAt: number): string {
  if (!createdAt) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Spark({ points }: { points?: number[] }) {
  if (!points || points.length < 2) return <span className="pad-spark pad-spark-empty" />;
  const w = 88;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg className="pad-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="2" />
    </svg>
  );
}

export function TokenTile({ token }: { token: TokenSummary }) {
  return (
    <Link href={`/token/${token.address}`} className="pad-card">
      {token.imageUrl ? (
        <img className="pad-card-pfp" src={token.imageUrl} alt="" />
      ) : (
        <span className="pad-card-pfp pad-card-letter">{token.symbol.slice(0, 1)}</span>
      )}
      <div className="pad-card-meta">
        <div className="pad-card-name">
          {token.name} <span>${token.symbol}</span>
          {isDemoAddress(token.address) && <em className="pad-demo-tag">DEMO</em>}
        </div>
        <div className="pad-card-by">{ageLabel(token.createdAt)}</div>
        <div className="pad-card-stats">
          <div>
            <div className="k">Mcap</div>
            <div className="v">{fmtMon(token.marketCapMon)}</div>
          </div>
          <div>
            <div className="k">24h vol</div>
            <div className="v up">{fmtMon(token.volume24hMon)}</div>
          </div>
          <Spark points={token.sparkline} />
        </div>
      </div>
    </Link>
  );
}

export function TokenSkeleton() {
  return <div className="pad-card pad-card-skel" aria-hidden />;
}

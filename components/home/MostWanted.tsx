import Link from 'next/link';
import type { TokenSummary } from '@/lib/api';
import { fmtMon } from '@/lib/format';

export function MostWanted({ token }: { token: TokenSummary | null }) {
  if (!token) {
    return (
      <section className="pad-wanted">
        <div className="pad-wanted-kicker">Most wanted</div>
        <p>No launches yet. Be the first name on the board.</p>
        <Link href="/create" className="pad-launch">
          + Launch
        </Link>
      </section>
    );
  }
  return (
    <Link href={`/token/${token.address}`} className="pad-wanted">
      <div className="pad-wanted-kicker">Most wanted</div>
      <div className="pad-wanted-row">
        {token.imageUrl ? <img src={token.imageUrl} alt="" /> : <span>{token.symbol.slice(0, 1)}</span>}
        <div>
          <h3>
            {token.name} <em>${token.symbol}</em>
          </h3>
          <p>
            {fmtMon(token.marketCapMon)} MON mcap · {fmtMon(token.volume24hMon)} MON 24h
          </p>
        </div>
      </div>
    </Link>
  );
}

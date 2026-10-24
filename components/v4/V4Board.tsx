// Exchange-style board for V4 listings.
import Link from 'next/link';
import type { TokenSummary } from '@/lib/api';

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const px = (n: number) => (n >= 1 ? n.toFixed(4) : n.toPrecision(3));
const mcapOf = (t: TokenSummary) => Number(BigInt(t.marketCapMon || '0') / 10n ** 12n) / 1e6;

export default function V4Board({ tokens, loading, query }: { tokens: TokenSummary[]; loading: boolean; query: string }) {
  const totalMcap = tokens.reduce((a, t) => a + mcapOf(t), 0);
  return (
    <div className="xch">
      <div className="xch-idx">
        <div><small>LISTED</small><b>{tokens.length}</b></div>
        <div><small>TOTAL MARKET CAP</small><b>{usd(totalMcap)}</b></div>
        <div><small>QUOTE</small><b>USDC</b></div>
        <div><small>LIQUIDITY</small><b>🔒 Locked</b></div>
      </div>
      <div className="xch-panel">
        <table className="xch-tbl">
          <thead><tr><th>SYMBOL</th><th>LAST (USDC)</th><th>MKT CAP</th><th className="xch-hm">FEE</th><th /></tr></thead>
          <tbody>
            {tokens.map((t) => {
              const p = mcapOf(t) / 1e9;
              return (
                <tr key={t.address}>
                  <td>
                    <Link href={`/token/${t.address}`} className="xch-sym">
                      {t.imageUrl ? <img src={t.imageUrl} alt="" width={22} height={22} /> : <span className="xch-tk">{t.symbol.slice(0, 1)}</span>}
                      <b>{t.symbol}</b><small>{t.name}</small>
                    </Link>
                  </td>
                  <td>{px(p)}</td>
                  <td>{usd(mcapOf(t))}</td>
                  <td className="xch-hm">{t.feeBps != null ? `${t.feeBps / 100}%` : '—'}</td>
                  <td><Link href={`/token/${t.address}`} className="xch-trade">Trade</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && tokens.length === 0 && <div className="xch-dim" style={{ padding: 20 }}>{query.trim() ? 'Nothing matches that search.' : 'No listings yet. Be the first.'}</div>}
        {loading && tokens.length === 0 && <div className="xch-dim" style={{ padding: 20 }}>Loading listings…</div>}
      </div>
    </div>
  );
}

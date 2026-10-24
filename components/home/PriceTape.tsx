// Scrolling price tape of listed coins (USDC prices).
import type { TokenSummary } from '@/lib/api';

const mcapOf = (t: TokenSummary) => Number(BigInt(t.marketCapMon || '0') / 10n ** 12n) / 1e6;
const px = (n: number) => (n >= 1 ? n.toFixed(4) : n.toPrecision(3));

export function PriceTape({ tokens }: { tokens: TokenSummary[] }) {
  if (!tokens.length) return null;
  const items = tokens.slice(0, 20).map((t) => <span key={t.address}>{t.symbol}<b>${px(mcapOf(t) / 1e9)}</b></span>);
  return (
    <div className="pad-tape" aria-label="Listed coin prices">
      <div className="pad-tape-in">{items}{items.map((e) => ({ ...e, key: `${e.key}-2` }))}</div>
    </div>
  );
}

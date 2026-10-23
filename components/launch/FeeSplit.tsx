import { feePct, LP_FEE_SLICES } from '@/lib/fees';

/** LP fee bar. Percents come from lib/fees.ts. */
export function FeeSplit() {
  return (
    <div className="pad-fees" aria-label="LP fee split">
      {LP_FEE_SLICES.map((slice) => (
        <div key={slice.id} className={`pad-fee pad-fee-${slice.id}`}>
          <b>{feePct(slice.bps)}</b>
          <span>{slice.label}</span>
        </div>
      ))}
    </div>
  );
}

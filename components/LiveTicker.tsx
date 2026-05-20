import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTradeFeed } from '../lib/ws';
import type { Trade } from '../lib/api';
import { fmtMon, shortAddr, fmtAgo } from '../lib/format';

type Props = {
  maxItems?: number;
};

/**
 * LiveTicker
 * Horizontal infinite-scrolling trade strip. The pump.fun pattern:
 * render the trade list TWICE side-by-side, animate translateX from 0 to -50%
 * so the second copy lands exactly where the first started -> seamless loop.
 *
 * Animation duration scales with trade count (* 5s per trade) so 1 trade
 * cycles fast and 30 trades cycle slowly; visual density stays consistent.
 */
export default function LiveTicker({ maxItems = 20 }: Props) {
  const trades = useTradeFeed(maxItems);

  // Lock the duration into useMemo keyed off length-bucket so new trades
  // arriving mid-scroll don't cause speed jitter on every render. We rebucket
  // every 5 trades, which is enough granularity to feel natural.
  const durationSec = useMemo(() => {
    const n = Math.max(trades.length, 1);
    const bucket = Math.ceil(n / 5) * 5;
    return bucket * 5;
  }, [Math.ceil(trades.length / 5)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        width: '100%',
        height: 30,
        background: 'var(--bg-strip, rgba(20, 16, 42, 0.85))',
        borderTop: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        borderBottom: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {trades.length === 0 ? (
        <div
          style={{
            width: '100%',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--p3, rgba(220, 215, 240, 0.3))',
            letterSpacing: 0.3,
          }}
        >
          Waiting for live trades…
        </div>
      ) : (
        <motion.div
          style={{
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            willChange: 'transform',
          }}
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: durationSec, ease: 'linear', repeat: Infinity }}
          whileHover={{ transition: { duration: 0 } }}
        >
          {/* Render the list twice for seamless loop */}
          {[0, 1].map((copy) => (
            <div
              key={copy}
              style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
              aria-hidden={copy === 1 ? true : undefined}
            >
              {trades.map((t, i) => (
                <TickerItem key={`${copy}-${t.ts}-${i}`} trade={t} isLast={i === trades.length - 1} />
              ))}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function TickerItem({ trade, isLast }: { trade: Trade; isLast: boolean }) {
  const symbol = trade.tokenSymbol ?? '???';
  const isBuy = trade.side === 'buy';
  const sideColor = isBuy ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)';

  return (
    <>
      <Link
        href={`/token/${trade.tokenAddress}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 4px',
          fontSize: 12,
          textDecoration: 'none',
          color: 'inherit',
          flexShrink: 0,
        }}
      >
        {/* Side dot */}
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: sideColor,
            flexShrink: 0,
          }}
          aria-label={trade.side}
        />

        {/* Symbol */}
        <span
          style={{
            fontWeight: 700,
            color: 'var(--brand, #8B5CF6)',
          }}
        >
          {symbol}
        </span>

        {/* Side word */}
        <span style={{ color: sideColor, fontWeight: 600 }}>{trade.side}</span>

        {/* Amount */}
        <span style={{ color: 'var(--p1, #ECE9F8)' }}>
          {fmtMon(trade.monAmount)} MON
        </span>

        {/* Wallet */}
        <span
          style={{
            color: 'var(--p2, rgba(220, 215, 240, 0.5))',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11,
          }}
        >
          {shortAddr(trade.wallet)}
        </span>

        {/* Time */}
        <span
          style={{
            color: 'var(--p3, rgba(220, 215, 240, 0.3))',
            fontSize: 11,
          }}
        >
          {fmtAgo(trade.ts)}
        </span>
      </Link>

      {/* Separator */}
      {!isLast && (
        <span
          aria-hidden
          style={{
            color: 'var(--p3, rgba(220, 215, 240, 0.3))',
            margin: '0 12px',
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          ·
        </span>
      )}
    </>
  );
}

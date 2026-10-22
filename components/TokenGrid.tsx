import { motion } from 'framer-motion';
import Link from 'next/link';
import type { TokenSummary } from '../lib/api';
import TokenCard from './TokenCard';

type Props = {
  tokens: TokenSummary[];
  loading?: boolean;
  emptyMessage?: string;
  /** pump.fun-style denser board */
  dense?: boolean;
};

/**
 * TokenGrid
 * Dumb-reusable presentational grid. Parent owns the fetch and filter state.
 *
 * States:
 *   loading + zero tokens  -> 8 skeleton placeholders (uses existing .skeleton class)
 *   not loading + zero     -> centered emptyMessage
 *   has tokens             -> grid of <TokenCard>, keyed by address
 *   loading + has tokens   -> render existing tokens (no flash)
 */
export default function TokenGrid({ tokens, loading = false, emptyMessage, dense = false }: Props) {
  const gridClass = dense
    ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2'
    : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4';

  // Loading initial fetch: show skeletons only when we have nothing yet.
  if (loading && tokens.length === 0) {
    return (
      <div className={gridClass}>
        {Array.from({ length: dense ? 18 : 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  // Empty state (not loading, no tokens).
  if (!loading && tokens.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        style={{
          padding: '64px 24px',
          textAlign: 'center',
          border: '1px dashed var(--bd, rgba(139, 92, 246, 0.25))',
          borderRadius: 16,
          background: 'var(--bg-card, rgba(28, 24, 56, 0.4))',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>🪙</div>
        <div style={{ color: 'var(--p1, #ECE9F8)', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          {emptyMessage ?? 'No coins yet'}
        </div>
        <div style={{ color: 'var(--p2, rgba(220, 215, 240, 0.6))', fontSize: 13, marginBottom: 18 }}>
          Be the first to launch on Mon-Pad.
        </div>
        <Link
          href="/create"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10,
            background: 'var(--brand, #8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14,
            textDecoration: 'none', boxShadow: '0 0 20px rgba(139, 92, 246, 0.35)',
          }}
        >
          + Create coin
        </Link>
      </motion.div>
    );
  }

  // Has tokens: render grid. Refetch-loading is intentionally ignored to avoid
  // flashing skeletons over real data.
  return (
    <div className={gridClass}>
      {tokens.map((t, i) => (
        <TokenCard key={t.address} token={t} index={i} dense={dense} />
      ))}
    </div>
  );
}

/**
 * SkeletonCard
 * Same overall dimensions as TokenCard: image block (1:1) + 3 short text rows + bar.
 * Uses the existing .skeleton class from styles/globals.css which already
 * combines pulse + shimmer animations and respects var(--r) border-radius.
 */
function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--bg-card, rgba(28, 24, 56, 0.6))',
        border: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Image block */}
      <div
        className="skeleton"
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 8,
        }}
      />

      {/* Name + symbol row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          className="skeleton"
          style={{ height: 12, flex: 1, borderRadius: 4 }}
        />
        <div
          className="skeleton"
          style={{ height: 12, width: 36, borderRadius: 4 }}
        />
      </div>

      {/* Two stat rows */}
      <div
        className="skeleton"
        style={{ height: 10, width: '70%', borderRadius: 4 }}
      />
      <div
        className="skeleton"
        style={{ height: 10, width: '55%', borderRadius: 4 }}
      />

      {/* Progress bar */}
      <div
        className="skeleton"
        style={{ height: 4, width: '100%', borderRadius: 2, marginTop: 4 }}
      />
    </div>
  );
}

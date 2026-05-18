import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Trophy, GraduationCap, Flame } from 'lucide-react';
import { api, type TokenSummary, type TopEarner } from '../lib/api';
import { fmtMon, shortAddr } from '../lib/format';

export type HomeRailVariant = 'top-earners' | 'top-graduated' | 'hottest-24h';

type Props = {
  variant: HomeRailVariant;
  limit?: number;
};

type RailConfig = {
  title: string;
  Icon: typeof Trophy;
};

const CONFIG: Record<HomeRailVariant, RailConfig> = {
  'top-earners': { title: 'Top Earners', Icon: Trophy },
  'top-graduated': { title: 'Graduated', Icon: GraduationCap },
  'hottest-24h': { title: 'Hottest 24h', Icon: Flame },
};

const MEDAL: Record<number, string> = {
  1: '#FCD34D', // gold
  2: '#C0C0C0', // silver
  3: '#CD7F32', // bronze
};

export default function HomeRail({ variant, limit = 8 }: Props) {
  const [rows, setRows] = useState<TopEarner[] | TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRows(null);

    const fetcher = (): Promise<TopEarner[] | TokenSummary[]> => {
      if (variant === 'top-earners') return api.listTopEarners();
      if (variant === 'top-graduated') return api.listTokens('graduated');
      return api.listTokens('trending');
    };

    fetcher()
      .then((data) => {
        if (cancelled) return;
        setRows(data.slice(0, limit) as TopEarner[] | TokenSummary[]);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? 'Unable to load.');
      });

    return () => {
      cancelled = true;
    };
  }, [variant, limit]);

  const { title, Icon } = CONFIG[variant];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        background: 'var(--bg-card, rgba(28, 24, 56, 0.6))',
        border: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingBottom: 8,
          borderBottom: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        }}
      >
        <Icon size={16} color="var(--brand, #8B5CF6)" />
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--brand, #8B5CF6)',
            letterSpacing: 0.3,
          }}
        >
          {title}
        </span>
      </div>

      {/* Body */}
      {error ? (
        <div
          style={{
            padding: '40px 8px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--err, #F87171)',
          }}
        >
          Unable to load.
        </div>
      ) : rows === null ? (
        <SkeletonRows count={limit} />
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: '40px 8px',
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--p2, rgba(220, 215, 240, 0.5))',
          }}
        >
          Nothing here yet.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map((row, i) => (
            <RailRow key={getKey(variant, row)} rank={i + 1} variant={variant} row={row} />
          ))}
        </ol>
      )}
    </motion.div>
  );
}

function getKey(variant: HomeRailVariant, row: TopEarner | TokenSummary): string {
  if (variant === 'top-earners') return (row as TopEarner).wallet;
  return (row as TokenSummary).address;
}

function RailRow({
  rank,
  variant,
  row,
}: {
  rank: number;
  variant: HomeRailVariant;
  row: TopEarner | TokenSummary;
}) {
  const isEarner = variant === 'top-earners';
  const earner = isEarner ? (row as TopEarner) : null;
  const token = !isEarner ? (row as TokenSummary) : null;

  const href = isEarner
    ? `/profile/${earner!.wallet}`
    : `/token/${token!.address}`;

  // Main / sub text
  let mainText: string;
  let subText: string;
  let rightValue: string;
  let rightSub: string | null = null;
  let imageUrl: string | undefined;
  let letter: string;
  let letterTint: string;

  if (isEarner && earner) {
    mainText = earner.displayName ?? shortAddr(earner.wallet);
    subText = earner.displayName ? shortAddr(earner.wallet) : '';
    rightValue = `${fmtMon(earner.earnedMon)} MON`;
    rightSub = `${earner.launchCount} launches`;
    letter = (earner.displayName ?? earner.wallet.slice(2, 3)).slice(0, 1).toUpperCase();
    letterTint = 'var(--brand, #8B5CF6)';
  } else if (token) {
    mainText = token.name;
    subText = token.symbol;
    rightValue =
      variant === 'hottest-24h'
        ? `${fmtMon(token.volume24hMon)} MON`
        : `${fmtMon(token.marketCapMon)} MON`;
    imageUrl = token.imageUrl;
    letter = (token.symbol || token.name || '?').slice(0, 1).toUpperCase();
    letterTint = 'var(--brand, #8B5CF6)';
  } else {
    mainText = '';
    subText = '';
    rightValue = '';
    letter = '?';
    letterTint = 'var(--brand, #8B5CF6)';
  }

  const medalBg = MEDAL[rank];

  return (
    <li>
      <Link
        href={href}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 4px',
          minHeight: 48,
          borderRadius: 8,
          textDecoration: 'none',
          color: 'inherit',
          transition: 'background 120ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            'var(--hover, rgba(139, 92, 246, 0.08))';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {/* Rank badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: medalBg ?? 'transparent',
            color: medalBg ? '#1A1535' : 'var(--p2, rgba(220, 215, 240, 0.5))',
            flexShrink: 0,
          }}
        >
          {rank}
        </span>

        {/* Avatar / token image */}
        <span
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--bg-chip, rgba(139, 92, 246, 0.12))',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {imageUrl ? (
            <Image src={imageUrl} alt={mainText} fill sizes="32px" style={{ objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: letterTint }}>{letter}</span>
          )}
        </span>

        {/* Main + sub */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--p1, #ECE9F8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {mainText}
          </span>
          {subText && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--p2, rgba(220, 215, 240, 0.5))',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subText}
            </span>
          )}
        </span>

        {/* Right-aligned value */}
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 2,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--p1, #ECE9F8)' }}>
            {rightValue}
          </span>
          {rightSub && (
            <span style={{ fontSize: 10, color: 'var(--p2, rgba(220, 215, 240, 0.5))' }}>
              {rightSub}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 4px',
            minHeight: 48,
          }}
        >
          <div className="skeleton" style={{ width: 24, height: 24, borderRadius: 999 }} />
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <div className="skeleton" style={{ height: 10, width: '60%', borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 8, width: '40%', borderRadius: 4 }} />
          </div>
          <div className="skeleton" style={{ height: 10, width: 56, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

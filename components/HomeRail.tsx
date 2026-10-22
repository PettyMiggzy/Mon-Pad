import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Trophy, GraduationCap, Flame } from 'lucide-react';
import { type TokenSummary } from '../lib/api';
import { listV3Tokens } from '../lib/chainV3';
import { MOCK_MODE } from '../lib/constants';
import { DEMO_BOARD } from '../lib/demo';
import { mockTokens } from '../lib/mocks';
import { fmtMon } from '../lib/format';

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
  'top-earners': { title: 'Most Raised', Icon: Trophy },
  'top-graduated': { title: 'Graduated', Icon: GraduationCap },
  'hottest-24h': { title: 'Hottest', Icon: Flame },
};

const MEDAL: Record<number, string> = {
  1: '#FCD34D', // gold
  2: '#C0C0C0', // silver
  3: '#CD7F32', // bronze
};

const cmpBigDesc = (a: string, b: string) => {
  const A = BigInt(a || '0'), B = BigInt(b || '0');
  return A > B ? -1 : A < B ? 1 : 0;
};

export default function HomeRail({ variant, limit = 8 }: Props) {
  const [rows, setRows] = useState<TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRows(null);

    (async () => {
      try {
        if (DEMO_BOARD || MOCK_MODE) {
          const demo = await mockTokens(variant === 'hottest-24h' ? 'trending' : variant === 'top-graduated' ? 'graduated' : undefined);
          let picked = [...demo];
          if (variant === 'hottest-24h') picked.sort((a, b) => cmpBigDesc(a.volume24hMon, b.volume24hMon));
          else if (variant === 'top-graduated') picked = picked.filter((t) => t.graduated);
          else picked.sort((a, b) => cmpBigDesc(a.monRaisedNet, b.monRaisedNet));
          if (cancelled) return;
          setRows(picked.slice(0, limit));
          return;
        }

        // All rails read straight from chain — no backend dependency, no 404s.
        const list = await listV3Tokens(60);
        if (!list.length) {
          const demo = await mockTokens();
          let picked = [...demo];
          if (variant === 'hottest-24h') picked.sort((a, b) => cmpBigDesc(a.volume24hMon, b.volume24hMon));
          else picked.sort((a, b) => cmpBigDesc(a.monRaisedNet, b.monRaisedNet));
          if (cancelled) return;
          setRows(picked.slice(0, limit));
          return;
        }
        let picked = list;
        if (variant === 'top-graduated') {
          picked = list.filter((t) => t.graduated).sort((a, b) => cmpBigDesc(a.priceWeiPerToken, b.priceWeiPerToken));
        } else if (variant === 'hottest-24h') {
          picked = [...list].sort((a, b) => b.progress - a.progress);
        } else {
          // "Most Raised" — proxy for top creator earnings (fees scale with raise).
          picked = [...list].sort((a, b) => cmpBigDesc(a.monRaisedNet, b.monRaisedNet));
        }
        picked = picked.slice(0, limit);

        const mapped: TokenSummary[] = picked.map((t) => ({
          address: t.token,
          name: t.name,
          symbol: t.symbol,
          imageUrl: undefined,
          creator: t.creator,
          marketCapMon: (BigInt(t.priceWeiPerToken) * 1_000_000_000n).toString(),
          volume24hMon: '0',
          monRaisedNet: t.monRaisedNet,
          graduated: t.graduated,
          createdAt: 0,
          sparkline: [],
        }));
        if (cancelled) return;
        setRows(mapped);

        // Best-effort logo enrichment (same-origin Supabase-backed route).
        try {
          const addrs = mapped.map((t) => t.address).join(',');
          if (addrs) {
            const metas = await fetch(`/api/token-meta?addresses=${addrs}`).then((r) => (r.ok ? r.json() : []));
            if (!cancelled && Array.isArray(metas) && metas.length) {
              const byAddr = new Map<string, string>(
                metas.filter((m: any) => m?.image_url).map((m: any) => [String(m.address).toLowerCase(), m.image_url as string]),
              );
              if (byAddr.size) setRows((prev) => (prev ? prev.map((t) => ({ ...t, imageUrl: byAddr.get(t.address.toLowerCase()) || t.imageUrl })) : prev));
            }
          }
        } catch { /* logos optional */ }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'Unable to load.');
      }
    })();

    return () => { cancelled = true; };
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
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--brand, #8B5CF6)', letterSpacing: 0.3 }}>
          {title}
        </span>
      </div>

      {/* Body */}
      {error ? (
        <div style={{ padding: '40px 8px', textAlign: 'center', fontSize: 13, color: 'var(--p2, rgba(220, 215, 240, 0.5))' }}>
          Nothing here yet.
        </div>
      ) : rows === null ? (
        <SkeletonRows count={limit} />
      ) : rows.length === 0 ? (
        <div style={{ padding: '40px 8px', textAlign: 'center', fontSize: 13, color: 'var(--p2, rgba(220, 215, 240, 0.5))' }}>
          Nothing here yet.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
          {rows.map((row, i) => (
            <RailRow key={row.address} rank={i + 1} variant={variant} token={row} />
          ))}
        </ol>
      )}
    </motion.div>
  );
}

function RailRow({ rank, variant, token }: { rank: number; variant: HomeRailVariant; token: TokenSummary }) {
  const mainText = token.name;
  const subText = token.symbol;
  const rightValue = variant === 'top-earners'
    ? `${fmtMon(token.monRaisedNet)} MON`
    : `${fmtMon(token.marketCapMon)} MON`;
  const rightSub = variant === 'top-earners' ? 'raised' : null;
  const imageUrl = token.imageUrl;
  const letter = (token.symbol || token.name || '?').slice(0, 1).toUpperCase();
  const medalBg = MEDAL[rank];

  return (
    <li>
      <Link
        href={`/token/${token.address}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', minHeight: 48, borderRadius: 8, textDecoration: 'none', color: 'inherit', transition: 'background 120ms ease' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--hover, rgba(139, 92, 246, 0.08))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Rank badge */}
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, borderRadius: 999, fontSize: 11, fontWeight: 700,
            background: medalBg ?? 'transparent',
            color: medalBg ? '#1A1535' : 'var(--p2, rgba(220, 215, 240, 0.5))',
            flexShrink: 0,
          }}
        >
          {rank}
        </span>

        {/* Token image / placeholder */}
        <span
          style={{
            position: 'relative', width: 32, height: 32, borderRadius: 8, overflow: 'hidden',
            background: 'var(--bg-chip, rgba(139, 92, 246, 0.12))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {imageUrl ? (
            <Image src={imageUrl} alt={mainText} fill sizes="32px" style={{ objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand, #8B5CF6)' }}>{letter}</span>
          )}
        </span>

        {/* Main + sub */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--p1, #ECE9F8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mainText}
          </span>
          {subText && (
            <span style={{ fontSize: 11, color: 'var(--p2, rgba(220, 215, 240, 0.5))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subText}
            </span>
          )}
        </span>

        {/* Right-aligned value */}
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--p1, #ECE9F8)' }}>{rightValue}</span>
          {rightSub && <span style={{ fontSize: 10, color: 'var(--p2, rgba(220, 215, 240, 0.5))' }}>{rightSub}</span>}
        </span>
      </Link>
    </li>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', minHeight: 48 }}>
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

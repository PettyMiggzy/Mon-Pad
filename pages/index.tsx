import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import LiveTicker from '@/components/LiveTicker';
import PromoBanner from '@/components/PromoBanner';
import MonshiBurnCounter from '@/components/MonshiBurnCounter';
import TokenGrid from '@/components/TokenGrid';
import HomeRail from '@/components/HomeRail';
import { type TokenSummary } from '@/lib/api';
import { listV3Tokens, getV3CardStats } from '@/lib/chainV3';
import { v3Configured } from '@/lib/constants';
import { fmtMon } from '@/lib/format';
import Head from 'next/head';
import { useRouter } from 'next/router';

type FilterKey = 'all' | 'trending' | 'new' | 'near-graduation' | 'graduated';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'For you' },
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'near-graduation', label: 'About to graduate' },
  { key: 'graduated', label: 'Graduated' },
];

export default function Home() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const configured = v3Configured();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const list = await listV3Tokens(120);
        if (cancelled) return;
        let rows = list;
        if (filter === 'graduated') rows = list.filter((t) => t.graduated);
        else if (filter === 'near-graduation') {
          rows = list.filter((t) => !t.graduated).sort((a, b) => b.progress - a.progress);
        } else if (filter === 'trending') {
          rows = [...list].sort((a, b) => b.progress - a.progress);
        } else if (filter === 'new') {
          rows = [...list]; // chain order ≈ newest first from factory
        }
        const mapped: TokenSummary[] = rows.map((t) => ({
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
        setTokens(mapped);
        setLoading(false);

        try {
          const addrs = mapped.map((t) => t.address).join(',');
          if (addrs) {
            const metas = await fetch(`/api/token-meta?addresses=${addrs}`).then((r) => (r.ok ? r.json() : []));
            if (!cancelled && Array.isArray(metas) && metas.length) {
              const byAddr = new Map<string, string>(
                metas.filter((m: any) => m?.image_url).map((m: any) => [String(m.address).toLowerCase(), m.image_url as string]),
              );
              if (byAddr.size) setTokens((prev) => prev.map((t) => ({ ...t, imageUrl: byAddr.get(t.address.toLowerCase()) || t.imageUrl })));
            }
          }
        } catch { /* logos optional */ }

        try {
          const curveByAddr = new Map(rows.map((t) => [t.token.toLowerCase(), t.curve]));
          const top = mapped.slice(0, 24);
          for (let i = 0; i < top.length && !cancelled; i += 4) {
            const batch = top.slice(i, i + 4);
            const results = await Promise.all(batch.map(async (t) => {
              const curve = curveByAddr.get(t.address.toLowerCase());
              if (!curve) return null;
              const s = await getV3CardStats(curve as any).catch(() => null);
              return s ? { address: t.address.toLowerCase(), s } : null;
            }));
            if (cancelled) break;
            const upd = new Map(results.filter(Boolean).map((r: any) => [r.address, r.s]));
            if (upd.size) setTokens((prev) => prev.map((t) => {
              const s = upd.get(t.address.toLowerCase());
              if (!s) return t;
              const volWei = (BigInt(Math.round(s.volMon * 1e6)) * 1_000_000_000_000n).toString();
              return { ...t, volume24hMon: volWei, sparkline: s.spark };
            }));
          }
        } catch { /* card stats optional */ }
      } catch {
        if (cancelled) return;
        setTokens([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [filter]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [tokens, query]);

  const king = useMemo(() => {
    const live = tokens.filter((t) => !t.graduated);
    if (!live.length) return null;
    return [...live].sort((a, b) => {
      try {
        const A = BigInt(a.monRaisedNet || '0');
        const B = BigInt(b.monRaisedNet || '0');
        return A > B ? -1 : A < B ? 1 : 0;
      } catch {
        return 0;
      }
    })[0];
  }, [tokens]);

  return (
    <>
      <Head>
        <title>Monpad — Fair Launch on Monad · powered by Monshi</title>
        <meta key="description" name="description" content="Monpad on Monad. Every trade burns Monshi. Creators earn fees forever. Live burn counter." />
        <meta key="og:title" property="og:title" content="Monpad — Fair Launch on Monad" />
        <meta key="og:description" property="og:description" content="Monpad on Monad. Every trade burns Monshi. Creators earn fees forever." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Monpad — Fair Launch on Monad" />
        <meta key="twitter:description" name="twitter:description" content="Monpad on Monad. Every trade burns Monshi. Creators earn fees forever." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      {/* Slim busy strip — pump.fun energy, Monshi stays the brand face */}
      <div
        style={{
          borderBottom: '1px solid var(--bd)',
          background:
            'linear-gradient(90deg, rgba(124,58,237,0.18) 0%, rgba(5,3,8,0.95) 40%, rgba(236,72,153,0.12) 100%)',
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: '0 auto',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/meshy/monshi-mascot.png"
            alt="Monshi"
            style={{
              width: 56,
              height: 56,
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 6px 16px rgba(124,58,237,0.5))',
            }}
          />
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  color: '#fff',
                  lineHeight: 1,
                }}
              >
                Monpad
              </span>
              <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600 }}>
                live board · every trade burns Monshi
              </span>
            </div>
          </div>
          <Link
            href="/create"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 16px',
              borderRadius: 8,
              background: 'var(--p, #A855F7)',
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
              textDecoration: 'none',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            + Create coin
          </Link>
        </div>
      </div>

      <LiveTicker maxItems={28} />

      <div style={{ paddingTop: 8 }}>
        <MonshiBurnCounter compact />
      </div>

      {!configured && (
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 12px 8px' }}>
          <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--bg-card)', color: 'var(--t3)', fontSize: 12 }}>
            Contracts not configured — set NEXT_PUBLIC_FACTORY_V3 / NEXT_PUBLIC_GRADUATOR_V3.
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 12px' }}>
        <PromoBanner />
      </div>

      {/* King of the hill */}
      {king && (
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '8px 12px 0' }}>
          <Link
            href={`/token/${king.address}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(252, 211, 77, 0.35)',
              background: 'linear-gradient(90deg, rgba(252,211,77,0.12), rgba(20,16,42,0.7))',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#FCD34D', textTransform: 'uppercase' }}>
              ★ King of the hill
            </span>
            <span style={{ fontWeight: 800, color: '#fff', fontSize: 14 }}>{king.name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--p)', background: 'rgba(168,85,247,0.15)', padding: '2px 6px', borderRadius: 4 }}>
              ${king.symbol}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#4ADE80', fontWeight: 700 }}>
              {fmtMon(king.monRaisedNet)} MON raised
            </span>
          </Link>
        </div>
      )}

      {/* Sticky filters + search — pump.fun board chrome */}
      <div
        ref={gridRef}
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 10,
          background: 'rgba(5, 3, 8, 0.92)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--bd)',
          marginTop: 8,
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: '0 auto',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1, minWidth: 0 }}>
            {FILTERS.map((f) => {
              const isActive = f.key === filter;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 999,
                    border: isActive ? '1px solid rgba(168,85,247,0.55)' : '1px solid transparent',
                    background: isActive ? 'rgba(168,85,247,0.2)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--t3)',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <input
            type="search"
            placeholder="Search by name / ticker / CA…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: 'min(280px, 100%)',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--bd)',
              background: 'rgba(20,16,42,0.8)',
              color: '#fff',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--t4)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {loading ? 'loading…' : `${visible.length} coins`}
          </span>
        </div>
      </div>

      {/* Busy board: dense grid + slim rails */}
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: '12px 12px 48px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 280px',
            gap: 12,
            alignItems: 'start',
          }}
          className="monpad-board"
        >
          <main>
            <TokenGrid tokens={visible} loading={loading} dense />
          </main>
          <aside
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            className="monpad-board-aside"
          >
            <HomeRail variant="hottest-24h" limit={10} />
            <HomeRail variant="top-graduated" limit={8} />
            <HomeRail variant="top-earners" limit={8} />
          </aside>
        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 1024px) {
          .monpad-board {
            grid-template-columns: 1fr !important;
          }
          .monpad-board-aside {
            order: -1;
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }
        }
        @media (max-width: 720px) {
          .monpad-board-aside {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}

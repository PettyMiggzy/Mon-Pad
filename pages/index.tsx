import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import LiveTicker from '@/components/LiveTicker';
import MonshiBurnCounter from '@/components/MonshiBurnCounter';
import TokenGrid from '@/components/TokenGrid';
import HomeRail from '@/components/HomeRail';
import { type TokenSummary } from '@/lib/api';
import { listV3Tokens, getV3CardStats } from '@/lib/chainV3';
import { v3Configured } from '@/lib/constants';
import { fmtMon } from '@/lib/format';
import Head from 'next/head';
import { useRouter } from 'next/router';

type FilterKey = 'all' | 'trending' | 'new' | 'hot';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'For you' },
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'hot', label: 'Hottest' },
];

export default function Home() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const configured = v3Configured();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const list = await listV3Tokens(120);
        if (cancelled) return;
        let rows = [...list];
        if (filter === 'trending' || filter === 'hot') {
          rows.sort((a, b) => b.progress - a.progress);
        }
        // "new" / "all" keep factory order (newest-first)
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
              if (byAddr.size) {
                setTokens((prev) => prev.map((t) => ({ ...t, imageUrl: byAddr.get(t.address.toLowerCase()) || t.imageUrl })));
              }
            }
          }
        } catch { /* optional */ }

        try {
          const curveByAddr = new Map(rows.map((t) => [t.token.toLowerCase(), t.curve]));
          const top = mapped.slice(0, 24);
          for (let i = 0; i < top.length && !cancelled; i += 4) {
            const batch = top.slice(i, i + 4);
            const results = await Promise.all(
              batch.map(async (t) => {
                const curve = curveByAddr.get(t.address.toLowerCase());
                if (!curve) return null;
                const s = await getV3CardStats(curve as any).catch(() => null);
                return s ? { address: t.address.toLowerCase(), s } : null;
              }),
            );
            if (cancelled) break;
            const upd = new Map(results.filter(Boolean).map((r: any) => [r.address, r.s]));
            if (upd.size) {
              setTokens((prev) =>
                prev.map((t) => {
                  const s = upd.get(t.address.toLowerCase());
                  if (!s) return t;
                  const volWei = (BigInt(Math.round(s.volMon * 1e6)) * 1_000_000_000_000n).toString();
                  return { ...t, volume24hMon: volWei, sparkline: s.spark };
                }),
              );
            }
          }
        } catch { /* optional */ }
      } catch {
        if (!cancelled) {
          setTokens([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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

  /** Highest volume / raise — "Monshi's Crown" (not King of the Hill) */
  const crown = useMemo(() => {
    if (!tokens.length) return null;
    return [...tokens].sort((a, b) => {
      try {
        const A = BigInt(a.volume24hMon || a.monRaisedNet || '0');
        const B = BigInt(b.volume24hMon || b.monRaisedNet || '0');
        return A > B ? -1 : A < B ? 1 : 0;
      } catch {
        return 0;
      }
    })[0];
  }, [tokens]);

  return (
    <>
      <Head>
        <title>Monpad — DEX launches on Monad · every trade burns Monshi</title>
        <meta
          key="description"
          name="description"
          content="Monpad on Monad. LP fees split 70% creator / 10% platform / 10% burn Monshi / 10% burn your token. Bots welcome."
        />
        <meta key="og:title" property="og:title" content="Monpad — burn Monshi on every trade" />
        <meta key="og:description" property="og:description" content="Busy DEX launchpad. Monshi mascot. 70/10/10/10 LP fees." />
        <meta key="og:url" property="og:url" content={canonical} />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      {/* Brand strip — Monshi + Monpad + create */}
      <div className="mp-brand-strip">
        <div className="mp-brand-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/meshy/monshi-mascot.png" alt="Monshi" className="mp-brand-mascot" />
          <div className="mp-brand-copy">
            <h1 className="mp-brand-title">Monpad</h1>
            <p className="mp-brand-sub">
              DEX launches · LP fees → <b>70%</b> creator · <b>10%</b> platform · <b>10%</b> burn Monshi · <b>10%</b> burn
              your token
            </p>
          </div>
          <Link href="/create" className="mp-create-btn">
            + Launch
          </Link>
        </div>
      </div>

      <LiveTicker maxItems={28} />

      <div style={{ paddingTop: 8 }}>
        <MonshiBurnCounter compact />
      </div>

      {!configured && (
        <div className="mp-shell" style={{ paddingBottom: 8 }}>
          <div className="mp-warn">Contracts not configured — set NEXT_PUBLIC_FACTORY_V3.</div>
        </div>
      )}

      {/* Monshi's Crown — volume lead (NOT King of the Hill) */}
      {crown && (
        <div className="mp-shell" style={{ paddingTop: 8 }}>
          <Link href={`/token/${crown.address}`} className="mp-crown">
            <span className="mp-crown-label">Monshi&apos;s Crown</span>
            <span className="mp-crown-name">{crown.name}</span>
            <span className="mp-crown-sym">${crown.symbol}</span>
            <span className="mp-crown-stat">{fmtMon(crown.volume24hMon || crown.monRaisedNet)} MON</span>
          </Link>
        </div>
      )}

      {/* Filters */}
      <div ref={gridRef} className="mp-filters">
        <div className="mp-filters-inner">
          <div className="mp-filter-tabs">
            {FILTERS.map((f) => {
              const active = f.key === filter;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={active ? 'mp-chip mp-chip-on' : 'mp-chip'}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <input
            type="search"
            className="mp-search"
            placeholder="Search name / ticker / CA…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="mp-count">{loading ? '…' : `${visible.length}`}</span>
        </div>
      </div>

      {/* Board */}
      <div className="mp-shell mp-board-wrap">
        <div className="mp-board">
          <main>
            <TokenGrid tokens={visible} loading={loading} dense />
          </main>
          <aside className="mp-aside">
            <HomeRail variant="hottest-24h" limit={10} />
            <HomeRail variant="top-earners" limit={8} />
          </aside>
        </div>
      </div>

      <style jsx global>{`
        .mp-brand-strip {
          border-bottom: 1px solid var(--bd);
          background:
            linear-gradient(105deg, rgba(181, 123, 255, 0.16) 0%, transparent 42%),
            linear-gradient(280deg, rgba(255, 77, 154, 0.1) 0%, transparent 38%),
            rgba(8, 5, 14, 0.9);
        }
        .mp-brand-inner {
          max-width: var(--max-w);
          margin: 0 auto;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .mp-brand-mascot {
          width: 64px;
          height: 64px;
          object-fit: contain;
          flex-shrink: 0;
          filter: drop-shadow(0 8px 20px rgba(181, 123, 255, 0.45));
          animation: mpFloat 5.5s ease-in-out infinite;
        }
        @keyframes mpFloat {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        .mp-brand-copy {
          flex: 1;
          min-width: 180px;
        }
        .mp-brand-title {
          font-family: var(--font-display);
          font-size: clamp(26px, 4vw, 34px);
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1;
          margin: 0;
          color: #fff;
        }
        .mp-brand-sub {
          margin: 6px 0 0;
          font-size: 12px;
          line-height: 1.45;
          color: var(--t3);
          max-width: 560px;
        }
        .mp-brand-sub b {
          color: var(--t2);
          font-weight: 700;
        }
        .mp-create-btn {
          display: inline-flex;
          align-items: center;
          padding: 11px 18px;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--p) 0%, var(--pink) 100%);
          color: #fff;
          font-weight: 800;
          font-size: 13;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-decoration: none;
          box-shadow: var(--glow-pink);
        }
        .mp-shell {
          max-width: var(--max-w);
          margin: 0 auto;
          padding-left: 12px;
          padding-right: 12px;
        }
        .mp-warn {
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--bd);
          background: var(--bg-card);
          color: var(--t3);
          font-size: 12px;
        }
        .mp-crown {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 77, 154, 0.35);
          background: linear-gradient(90deg, rgba(255, 77, 154, 0.14), rgba(18, 12, 32, 0.8));
          text-decoration: none;
          color: inherit;
        }
        .mp-crown-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--pink);
        }
        .mp-crown-name {
          font-weight: 800;
          font-size: 14px;
          color: #fff;
        }
        .mp-crown-sym {
          font-size: 11px;
          font-weight: 700;
          color: var(--p);
          background: rgba(181, 123, 255, 0.15);
          padding: 2px 7px;
          border-radius: 4px;
        }
        .mp-crown-stat {
          margin-left: auto;
          font-size: 12px;
          font-weight: 700;
          color: var(--green);
          font-family: var(--mono);
        }
        .mp-filters {
          position: sticky;
          top: var(--topbar-h, 58px);
          z-index: 10;
          margin-top: 8px;
          background: rgba(7, 5, 12, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--bd);
        }
        .mp-filters-inner {
          max-width: var(--max-w);
          margin: 0 auto;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .mp-filter-tabs {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          flex: 1;
          min-width: 0;
        }
        .mp-chip {
          padding: 7px 12px;
          border-radius: 999px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--t3);
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .mp-chip-on {
          border-color: rgba(181, 123, 255, 0.5);
          background: rgba(181, 123, 255, 0.18);
          color: #fff;
          font-weight: 800;
        }
        .mp-search {
          width: min(280px, 100%);
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--bd);
          background: rgba(18, 12, 32, 0.85);
          color: #fff;
          font-size: 13px;
          outline: none;
        }
        .mp-search:focus {
          border-color: rgba(181, 123, 255, 0.55);
        }
        .mp-count {
          font-size: 11px;
          color: var(--t4);
          font-weight: 700;
          font-family: var(--mono);
          min-width: 2ch;
        }
        .mp-board-wrap {
          padding-top: 12px;
          padding-bottom: 48px;
        }
        .mp-board {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          gap: 12px;
          align-items: start;
        }
        .mp-aside {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (max-width: 1024px) {
          .mp-board {
            grid-template-columns: 1fr;
          }
          .mp-aside {
            order: -1;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
        }
        @media (max-width: 640px) {
          .mp-aside {
            grid-template-columns: 1fr;
          }
          .mp-brand-sub {
            font-size: 11px;
          }
        }
      `}</style>
    </>
  );
}

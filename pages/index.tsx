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
        <title>Monpad — fair launches on Monad</title>
        <meta
          key="description"
          name="description"
          content="Monpad: fair token launches on Monad. Every trade burns Monshi."
        />
        <meta key="og:title" property="og:title" content="Monpad" />
        <meta key="og:description" property="og:description" content="Fair launches on Monad. Every trade burns Monshi." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="og:image" property="og:image" content="https://www.monpad.net/meshy/monshi-mascot.png" />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      {/* Hero — one composition: brand + line + CTA + Monshi */}
      <section className="mp-hero" aria-label="Monpad">
        <div className="mp-hero-glow" aria-hidden />
        <div className="mp-hero-inner">
          <div className="mp-hero-copy">
            <p className="mp-hero-kicker">Monad · launches</p>
            <h1 className="mp-hero-title">
              Mon<span className="mp-brand-accent">pad</span>
            </h1>
            <p className="mp-hero-sub">Fair launches on Monad. Every trade burns Monshi.</p>
            <div className="mp-hero-actions">
              <Link href="/create" className="mp-create-btn">
                Launch a token
              </Link>
              <a href="#board" className="mp-hero-secondary">
                Browse board
              </a>
            </div>
          </div>
          <div className="mp-hero-mascot-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/meshy/monshi-mascot.png"
              alt="Monshi"
              className="mp-hero-mascot"
              draggable={false}
            />
          </div>
        </div>
      </section>

      <LiveTicker maxItems={28} />

      <div className="mp-shell mp-strip-row">
        <MonshiBurnCounter compact />
        {crown ? (
          <Link href={`/token/${crown.address}`} className="mp-crown">
            <span className="mp-crown-label">Monshi&apos;s Crown</span>
            <span className="mp-crown-name">{crown.name}</span>
            <span className="mp-crown-sym">${crown.symbol}</span>
            <span className="mp-crown-stat">{fmtMon(crown.volume24hMon || crown.monRaisedNet)} MON</span>
          </Link>
        ) : null}
      </div>

      {!configured && (
        <div className="mp-shell" style={{ paddingBottom: 8 }}>
          <div className="mp-warn">Board is empty until the next factory goes live.</div>
        </div>
      )}

      <div ref={gridRef} id="board" className="mp-filters">
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
    </>
  );
}

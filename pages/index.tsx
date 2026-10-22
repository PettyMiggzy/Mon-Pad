import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import LiveTicker from '@/components/LiveTicker';
import MonshiBurnCounter from '@/components/MonshiBurnCounter';
import TokenGrid from '@/components/TokenGrid';
import HomeRail from '@/components/HomeRail';
import { type TokenSummary } from '@/lib/api';
import { listV3Tokens, getV3CardStats } from '@/lib/chainV3';
import { MOCK_MODE, v3Configured } from '@/lib/constants';
import { mockTokens } from '@/lib/mocks';
import { DEMO_BOARD, pickCrown } from '@/lib/demo';
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
  const [demo, setDemo] = useState(DEMO_BOARD || MOCK_MODE);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const configured = v3Configured();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        if (DEMO_BOARD || MOCK_MODE) {
          const mapped = await mockTokens(filter === 'all' ? undefined : filter);
          if (cancelled) return;
          setDemo(true);
          setTokens(mapped);
          setLoading(false);
          return;
        }

        const list = await listV3Tokens(120);
        if (cancelled) return;

        // Factory live but empty → still show demo so UI isn't blank during cutover.
        if (!list.length) {
          const mapped = await mockTokens(filter === 'all' ? undefined : filter);
          if (cancelled) return;
          setDemo(true);
          setTokens(mapped);
          setLoading(false);
          return;
        }

        setDemo(false);
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
          const mapped = await mockTokens().catch(() => []);
          setDemo(true);
          setTokens(mapped);
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

  const crown = useMemo(() => pickCrown(tokens), [tokens]);

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

      <section className="pad-stage" aria-label="Monpad">
        <img className="pad-stage-monshi" src="/meshy/monshi-mascot.png" alt="Monshi" />
        <div className="pad-stage-copy">
          <h1>
            You&apos;re smart.
            <br />
            Drive.
          </h1>
          <p>Fair launches on Monad. Every trade burns Monshi.</p>
          <div className="pad-stage-actions">
            <Link href="/create" className="mp-create-btn">
              Launch a token
            </Link>
            {crown ? (
              <Link href={`/token/${crown.address}`} className="pad-crown-chip">
                Crown ${crown.symbol}
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <LiveTicker maxItems={28} />

      <div className="pad-rail-wrap">
        <div className="pad-rail" aria-label="Tokens">
          {visible.slice(0, 12).map((t) => (
            <Link key={t.address} href={`/token/${t.address}`} className="pad-rail-card">
              <span
                className="pad-rail-av"
                style={t.imageUrl ? { backgroundImage: `url(${t.imageUrl})` } : undefined}
              >
                {t.imageUrl ? null : t.symbol.slice(0, 1)}
              </span>
              <span className="pad-rail-sym">${t.symbol}</span>
              <span className="pad-rail-name">{t.name}</span>
              <span className="pad-rail-stat">{fmtMon(t.volume24hMon || t.monRaisedNet)} MON</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mp-shell mp-strip-row">
        <MonshiBurnCounter compact />
      </div>

      {!configured && !demo && (
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

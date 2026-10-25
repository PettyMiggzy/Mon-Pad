import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import LiveTicker from '@/components/LiveTicker';
import HomeRail from '@/components/HomeRail';
import { Hero } from '@/components/hero3d/Hero';
import { WhyRow } from '@/components/home/WhyRow';
import { MostWanted } from '@/components/home/MostWanted';
import { TokenSkeleton, TokenTile } from '@/components/home/TokenTile';
import { FeeSplit } from '@/components/launch/FeeSplit';
import { type TokenSummary } from '@/lib/api';
import { listV3Tokens, getV3CardStats } from '@/lib/chainV3';
import { MOCK_MODE, v3Configured } from '@/lib/constants';
import { mockTokens } from '@/lib/mocks';
import { DEMO_BOARD, pickCrown } from '@/lib/demo';
import { v4Configured } from '@/lib/v4/config';
import { listV4Tokens } from '@/lib/v4/chain';
import V4Board from '@/components/v4/V4Board';
import { LaunchHero } from '@/components/home/LaunchHero';
import { FeaturedLaunches } from '@/components/home/FeaturedLaunches';
import { HowItWorks } from '@/components/home/HowItWorks';
import { PriceTape } from '@/components/home/PriceTape';
import Head from 'next/head';
import { useRouter } from 'next/router';

type FilterKey = 'trending' | 'new' | 'hot';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'hot', label: 'Market cap' },
];

export default function Home() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [filter, setFilter] = useState<FilterKey>('trending');
  const qParam = typeof router.query.q === 'string' ? router.query.q : '';
  const [query, setQuery] = useState(qParam);
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(DEMO_BOARD || MOCK_MODE);
  const configured = v3Configured();

  useEffect(() => {
    setQuery(qParam);
  }, [qParam]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        if (DEMO_BOARD || MOCK_MODE) {
          const mapped = await mockTokens(filter);
          if (cancelled) return;
          setDemo(true);
          setTokens(mapped);
          setLoading(false);
          return;
        }

        if (v4Configured()) {
          const v4 = await listV4Tokens(120);
          if (cancelled) return;
          setDemo(false);
          setTokens(v4);
          setLoading(false);
          try {
            const addrs = v4.map((t) => t.address).join(',');
            const metas = addrs ? await fetch(`/api/token-meta?addresses=${addrs}`).then((r) => (r.ok ? r.json() : [])) : [];
            if (!cancelled && Array.isArray(metas) && metas.length) {
              const byAddr = new Map<string, string>(metas.filter((m: any) => m?.image_url).map((m: any) => [String(m.address).toLowerCase(), m.image_url as string]));
              if (byAddr.size) setTokens((prev) => prev.map((t) => ({ ...t, imageUrl: byAddr.get(t.address.toLowerCase()) || t.imageUrl })));
            }
          } catch { /* optional */ }
          return;
        }

        const list = await listV3Tokens(120);
        if (cancelled) return;

        // Factory live but empty -> honest empty board (never fake tokens).
        if (!list.length) {
          if (cancelled) return;
          setDemo(false);
          setTokens([]);
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
          setDemo(false);
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

  const isV4 = v4Configured() && !demo;
  const mcapUsd = (t: TokenSummary) => Number(BigInt(t.marketCapMon || '0') / 10n ** 12n) / 1e6;
  const board = useMemo(() => {
    if (!isV4) return visible;
    const rows = [...visible];
    if (filter === 'new') return rows; // listV4Tokens is newest first
    return rows.sort((a, b) => mcapUsd(b) - mcapUsd(a));
  }, [visible, filter, isV4]);
  const totalMcapUsd = useMemo(() => tokens.reduce((a, t) => a + mcapUsd(t), 0), [tokens]);

  const crown = useMemo(() => pickCrown(tokens), [tokens]);

  const symbols = useMemo(() => visible.slice(0, 3).map((t) => t.symbol), [visible]);

  return (
    <>
      <Head>
        <title>MONPAD — launches on Monad</title>
        <meta
          key="description"
          name="description"
          content="MONPAD: fair token launches on Monad. Uniswap V3 from block one. Every trade burns Monshi."
        />
        <meta key="og:title" property="og:title" content="MONPAD" />
        <meta key="og:description" property="og:description" content="Fair launches on Monad. DEX from block one. Every trade burns Monshi." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="og:image" property="og:image" content="https://www.monpad.net/api/og" />
        <link key="canonical" rel="canonical" href={canonical} />
        <link rel="preload" as="image" href="/meshy/monshi-mascot.webp" fetchPriority="high" />
      </Head>

      {!isV4 && <LiveTicker maxItems={24} />}
      {!isV4 && <Hero symbols={symbols} />}

      {isV4 && (
        <div className="lh">
          <LaunchHero listed={loading ? null : tokens.length} totalMcapUsd={loading ? null : totalMcapUsd} />
          <FeaturedLaunches tokens={tokens} loading={loading} />
          <HowItWorks />
        </div>
      )}

      <div className="pad-wrap">
        {isV4 && <PriceTape tokens={tokens} />}
        {!isV4 && <WhyRow />}
        {!isV4 && <FeeSplit />}
        {!isV4 && <MostWanted token={crown} />}

        {demo && <div className="pad-empty">Demo board: these tokens are sample data, not real launches.</div>}

        <div id="board" className="pad-tabs">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={f.key === filter ? 'on' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
          <span className="pad-count">{loading ? '…' : visible.length}</span>
          {isV4 && <input className="pad-tab-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search coins, tickers, address" aria-label="Search coins" />}
        </div>

        {v4Configured() && !demo ? (
          <V4Board tokens={board} loading={loading} query={query} />
        ) : (
        <div className="pad-layout">
          <div className="pad-grid">
            {loading && visible.length === 0
              ? Array.from({ length: 6 }).map((_, i) => <TokenSkeleton key={i} />)
              : visible.map((token) => <TokenTile key={token.address} token={token} />)}
            {!loading && visible.length === 0 && (
              <div className="pad-empty">
                {query.trim() ? 'Nothing matches that search.' : configured ? 'No launches yet. Be the first.' : 'Launches open when the factory goes live.'}
              </div>
            )}
          </div>
          <aside className="pad-rail">
            <HomeRail variant="hottest-24h" limit={8} />
            <HomeRail variant="top-earners" limit={6} />
          </aside>
        </div>
        )}
      </div>
    </>
  );
}

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import LiveTicker from '@/components/LiveTicker';
import PromoBanner from '@/components/PromoBanner';
import TokenGrid from '@/components/TokenGrid';
import HomeRail from '@/components/HomeRail';
import { type TokenSummary } from '@/lib/api';
import { listV3Tokens, getV3CardStats } from '@/lib/chainV3';
import { v3Configured } from '@/lib/constants';
import Head from 'next/head';
import { useRouter } from 'next/router';

type FilterKey = 'all' | 'trending' | 'near-graduation' | 'graduated';

const FILTERS: { key: FilterKey; label: string; apiValue: string | undefined }[] = [
  { key: 'all', label: 'All', apiValue: undefined },
  { key: 'trending', label: 'Trending', apiValue: 'trending' },
  { key: 'near-graduation', label: 'Near Graduation', apiValue: 'near-graduation' },
  { key: 'graduated', label: 'Graduated', apiValue: 'graduated' },
];

export default function Home() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const configured = v3Configured();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const list = await listV3Tokens(60);
        if (cancelled) return;
        let rows = list;
        if (filter === 'graduated') rows = list.filter((t) => t.graduated);
        else if (filter === 'near-graduation') rows = list.filter((t) => !t.graduated).sort((a, b) => b.progress - a.progress);
        else if (filter === 'trending') rows = [...list].sort((a, b) => b.progress - a.progress);
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

        // Enrich cards with off-chain logos (same-origin Supabase-backed route; best-effort).
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
        } catch { /* logos are optional */ }

        // Enrich cards with volume + price sparkline (per-token recent trades; throttled + capped).
        try {
          const curveByAddr = new Map(rows.map((t) => [t.token.toLowerCase(), t.curve]));
          const top = mapped.slice(0, 8); // cap so we don't hammer the RPC (getLogs is 100-block-capped)
          for (let i = 0; i < top.length && !cancelled; i += 5) {
            const batch = top.slice(i, i + 5);
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

  const scrollToGrid = () => {
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <Head>
        <title>Mon-Pad — Fair Launch on Monad</title>
        <meta key="description" name="description" content="Fair token launches on Monad. 500 MON to launch, 260k to graduate. Creators earn fees on every trade." />
        <meta key="og:title" property="og:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta key="og:description" property="og:description" content="Fair token launches on Monad. 500 MON to launch, 260k to graduate. Creators earn fees on every trade." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta key="twitter:description" name="twitter:description" content="Fair token launches on Monad. 500 MON to launch, 260k to graduate. Creators earn fees on every trade." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      {/* Live trade ticker at the very top */}
      <LiveTicker />

      {/* Promo banner */}
      <div className="max-w-7xl mx-auto px-4">
        <PromoBanner />
      </div>

      {/* Compact app header — sell the creator upside (FOMO to launch) */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--p1, #ECE9F8)', margin: 0, lineHeight: 1.2 }}>
            Launch a coin. Earn forever.
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--p2, rgba(220, 215, 240, 0.7))' }}>
            Pocket fees on every trade + <span style={{ color: '#4ADE80', fontWeight: 700 }}>~$800</span> when your coin graduates. Liquidity locks itself.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={scrollToGrid}
            style={{
              display: 'inline-flex', alignItems: 'center', padding: '10px 16px', borderRadius: 10,
              background: 'transparent', color: 'var(--brand, #8B5CF6)', fontWeight: 700, fontSize: 14,
              border: '1px solid var(--bd, rgba(139, 92, 246, 0.3))', cursor: 'pointer',
            }}
          >
            Explore
          </button>
          <Link
            href="/create"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10,
              background: 'var(--brand, #8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14,
              textDecoration: 'none', boxShadow: '0 0 20px rgba(139, 92, 246, 0.35)',
            }}
          >
            + Create coin
          </Link>
        </div>

        {!configured && (
          <div style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bd, rgba(139, 92, 246, 0.15))', background: 'var(--bg-card, rgba(28, 24, 56, 0.6))', color: 'var(--p2, rgba(220, 215, 240, 0.7))', fontSize: 12 }}>
            ⚠️ Contracts not configured — set NEXT_PUBLIC_FACTORY_V3 / NEXT_PUBLIC_GRADUATOR_V3.
          </div>
        )}
      </motion.section>

      {/* Creator rewards — the bullish bit, to FOMO people into launching */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 12px' }}>
        {[
          { icon: '💸', t: 'Fees on every trade', d: 'You earn on every buy & sell your coin gets — claim anytime, forever.' },
          { icon: '🎓', t: '~$800 at graduation', d: '41,700 MON paid straight to you the moment your coin bonds.' },
          { icon: '🔒', t: 'Locked liquidity', d: 'LP auto-locks at graduation (rug-proof) — so buyers actually trust it.' },
        ].map((p) => (
          <div key={p.t} style={{ background: 'var(--bg-card, rgba(28,24,56,0.6))', border: '1px solid var(--bd, rgba(139,92,246,0.15))', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 18 }}>{p.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--p1,#ECE9F8)', marginTop: 4 }}>{p.t}</div>
            <div style={{ fontSize: 11, color: 'var(--p2, rgba(220,215,240,0.6))', marginTop: 2, lineHeight: 1.4 }}>{p.d}</div>
          </div>
        ))}
      </div>

      {/* Sticky filter tabs */}
      <div
        ref={gridRef}
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 10,
          background: 'var(--bg-strip, rgba(20, 16, 42, 0.85))',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: '0 16px',
            display: 'flex',
            gap: 24,
            overflowX: 'auto',
          }}
        >
          {FILTERS.map((f) => {
            const isActive = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  position: 'relative',
                  padding: '14px 4px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive
                    ? 'var(--brand, #8B5CF6)'
                    : 'var(--p2, rgba(220, 215, 240, 0.7))',
                  whiteSpace: 'nowrap',
                  transition: 'color 120ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color =
                      'var(--p1, #ECE9F8)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color =
                      'var(--p2, rgba(220, 215, 240, 0.7))';
                  }
                }}
              >
                {f.label}
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 2,
                      background: 'var(--brand, #8B5CF6)',
                      borderRadius: 2,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content: grid + rails */}
      <div
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '24px 16px 0',
        }}
      >
        <div
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6"
        >
          <main className="lg:col-span-2">
            <TokenGrid tokens={tokens} loading={loading} />
          </main>
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <HomeRail variant="hottest-24h" />
            <HomeRail variant="top-graduated" />
            <HomeRail variant="top-earners" />
          </aside>
        </div>
      </div>
    </>
  );
}

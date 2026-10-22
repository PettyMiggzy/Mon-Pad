import { useState, useEffect, useRef } from 'react';
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
          const top = mapped.slice(0, 12); // cap so we don't hammer the RPC (getLogs is 100-block-capped)
          // 3 cards at a time — each card's scan fans out its own concurrent chunk batch.
          for (let i = 0; i < top.length && !cancelled; i += 3) {
            const batch = top.slice(i, i + 3);
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
        <title>Monpad — Fair Launch on Monad · powered by Monchi</title>
        <meta key="description" name="description" content="Monpad on Monad. Every trade burns Monchi. Creators earn fees forever. Live burn counter." />
        <meta key="og:title" property="og:title" content="Monpad — Fair Launch on Monad" />
        <meta key="og:description" property="og:description" content="Monpad on Monad. Every trade burns Monchi. Creators earn fees forever." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Monpad — Fair Launch on Monad" />
        <meta key="twitter:description" name="twitter:description" content="Monpad on Monad. Every trade burns Monchi. Creators earn fees forever." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      {/* Full-bleed hero — Monpad brand + Monshi mascot (approved street cutout) */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        style={{
          position: 'relative',
          minHeight: 'min(92vh, 860px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          overflow: 'hidden',
          background:
            'radial-gradient(ellipse 80% 70% at 70% 40%, rgba(124,58,237,0.35) 0%, transparent 55%), linear-gradient(160deg, #1a0f2e 0%, #050308 55%, #0a0614 100%)',
        }}
      >
        {/* Soft full-bleed atmosphere (not a second competing subject) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/meshy/hero.png"
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 35%',
            opacity: 0.28,
            transform: 'scale(1.04)',
            animation: 'monpadHeroDrift 18s ease-in-out infinite alternate',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(5,3,8,0.92) 0%, rgba(5,3,8,0.55) 42%, rgba(5,3,8,0.25) 70%, rgba(5,3,8,0.55) 100%), linear-gradient(180deg, transparent 40%, var(--bg, #050308) 100%)',
          }}
        />

        {/* Monshi — pad mascot, dominant visual */}
        <motion.img
          src="/meshy/monshi-mascot.png"
          alt="Monshi — Monpad mascot"
          initial={{ opacity: 0, x: 36, y: 16 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.75, delay: 0.15 }}
          style={{
            position: 'absolute',
            right: 'max(-4vw, calc((100% - 1280px) / 2 - 24px))',
            bottom: 0,
            height: 'min(88vh, 780px)',
            width: 'auto',
            maxWidth: 'min(56vw, 560px)',
            objectFit: 'contain',
            objectPosition: 'bottom right',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 24px 60px rgba(124,58,237,0.45))',
            animation: 'monpadMonchiFloat 6s ease-in-out infinite',
            zIndex: 1,
          }}
          className="monpad-hero-monshi"
        />

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: 1280,
            width: '100%',
            margin: '0 auto',
            padding: 'clamp(24px, 6vh, 56px) 16px 28px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            style={{ maxWidth: 480 }}
          >
            <p
              style={{
                fontFamily: 'var(--font)',
                fontSize: 'clamp(42px, 9vw, 88px)',
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 0.95,
                color: '#fff',
                margin: 0,
                textShadow: '0 8px 40px rgba(0,0,0,0.45)',
              }}
            >
              Monpad
            </p>
            <p
              style={{
                marginTop: 14,
                maxWidth: 420,
                fontSize: 'clamp(15px, 2.4vw, 18px)',
                lineHeight: 1.45,
                color: 'var(--t2, #DDD7FE)',
              }}
            >
              Fair launches on Monad. Every trade burns Monshi.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
              <Link
                href="/create"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '12px 22px',
                  borderRadius: 10,
                  background: 'var(--p, #A855F7)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 15,
                  textDecoration: 'none',
                }}
              >
                Launch a coin
              </Link>
              <button
                type="button"
                onClick={scrollToGrid}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '12px 20px',
                  borderRadius: 10,
                  background: 'transparent',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 15,
                  border: '1px solid rgba(255,255,255,0.28)',
                  cursor: 'pointer',
                }}
              >
                Explore launches
              </button>
            </div>
          </motion.div>
        </div>
      </motion.section>

      <style jsx global>{`
        @keyframes monpadHeroDrift {
          from { transform: scale(1.04) translate3d(0, 0, 0); }
          to { transform: scale(1.08) translate3d(-1.5%, -1%, 0); }
        }
        @keyframes monpadMonchiFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @media (max-width: 720px) {
          .monpad-hero-monshi {
            max-width: 72vw !important;
            height: min(52vh, 420px) !important;
            opacity: 0.95;
            right: -8vw !important;
          }
        }
      `}</style>

      <LiveTicker />

      <div style={{ paddingTop: 8 }}>
        <MonshiBurnCounter />
      </div>

      {!configured && (
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 12px' }}>
          <div style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--bg-card)', color: 'var(--t3)', fontSize: 12 }}>
            Contracts not configured — set NEXT_PUBLIC_FACTORY_V3 / NEXT_PUBLIC_GRADUATOR_V3.
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4">
        <PromoBanner />
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

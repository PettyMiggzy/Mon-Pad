import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import LiveTicker from '@/components/LiveTicker';
import PromoBanner from '@/components/PromoBanner';
import TokenGrid from '@/components/TokenGrid';
import HomeRail from '@/components/HomeRail';
import { api, type TokenSummary } from '@/lib/api';
import { contractsConfigured } from '@/lib/constants';

type FilterKey = 'all' | 'trending' | 'near-graduation' | 'graduated';

const FILTERS: { key: FilterKey; label: string; apiValue: string | undefined }[] = [
  { key: 'all', label: 'All', apiValue: undefined },
  { key: 'trending', label: 'Trending', apiValue: 'trending' },
  { key: 'near-graduation', label: 'Near Graduation', apiValue: 'near-graduation' },
  { key: 'graduated', label: 'Graduated', apiValue: 'graduated' },
];

export default function Home() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const configured = contractsConfigured();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const apiValue = FILTERS.find((f) => f.key === filter)?.apiValue;

    api
      .listTokens(apiValue)
      .then((t) => {
        if (cancelled) return;
        setTokens(t);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTokens([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  const scrollToGrid = () => {
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      {/* Live trade ticker at the very top */}
      <LiveTicker />

      {/* Promo banner */}
      <div className="max-w-7xl mx-auto px-4">
        <PromoBanner />
      </div>

      {/* Hero strip */}
      <section
        style={{
          padding: '40px 16px',
          maxWidth: 720,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: 'var(--p1, #ECE9F8)',
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          Fair launch. Pure curve. Real money.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          style={{
            marginTop: 12,
            fontSize: 15,
            color: 'var(--p2, rgba(220, 215, 240, 0.7))',
          }}
        >
          100 MON to launch. 425k to graduate. Live on Monad.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
          style={{
            marginTop: 24,
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/create"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderRadius: 8,
              background: 'var(--brand, #8B5CF6)',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
              border: '1px solid var(--brand, #8B5CF6)',
            }}
          >
            Launch a token
          </Link>
          <button
            type="button"
            onClick={scrollToGrid}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--brand, #8B5CF6)',
              fontWeight: 700,
              fontSize: 14,
              border: '1px solid var(--brand, #8B5CF6)',
              cursor: 'pointer',
            }}
          >
            Explore tokens
          </button>
        </motion.div>

        {!configured && (
          <div
            style={{
              marginTop: 20,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--bd, rgba(139, 92, 246, 0.15))',
              background: 'var(--bg-card, rgba(28, 24, 56, 0.6))',
              color: 'var(--p2, rgba(220, 215, 240, 0.7))',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            ⚠️ Contract addresses not configured. Set NEXT_PUBLIC_FACTORY_V2,
            NEXT_PUBLIC_HUB, NEXT_PUBLIC_POOL_FACTORY, NEXT_PUBLIC_GRADUATOR in .env.local.
          </div>
        )}
      </section>

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

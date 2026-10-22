'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchMonshiBurnStats } from '@/lib/monshiBurn';

/** Format large token amounts compactly (e.g. 12.4M, 1.2B). */
function fmtBurn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Live Monchi (MONSHI) burn counter — FOMO strip.
 * Circulating supply ticks down as more MONSHI lands in the dead address;
 * total burned ticks up beside it. Polls on-chain every ~10s.
 */
export default function MonshiBurnCounter() {
  const [burned, setBurned] = useState(0);
  const [circulating, setCirculating] = useState(0);
  const [displayBurned, setDisplayBurned] = useState(0);
  const [displayCirc, setDisplayCirc] = useState(0);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevBurned = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchMonshiBurnStats(true);
        if (cancelled) return;
        setBurned(s.burnedWhole);
        setCirculating(s.circulatingWhole);
        setReady(true);
        if (prevBurned.current > 0 && s.burnedWhole > prevBurned.current + 1e-6) {
          setPulse(true);
          setTimeout(() => setPulse(false), 1200);
        }
        prevBurned.current = s.burnedWhole;
      } catch {
        /* keep last good reading */
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Smooth tick animation toward latest on-chain values.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const startB = displayBurned || burned;
    const startC = displayCirc || circulating;
    const t0 = performance.now();
    const dur = 900;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplayBurned(startB + (burned - startB) * ease);
      setDisplayCirc(startC + (circulating - startC) * ease);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate only when targets change
  }, [burned, circulating, ready]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      aria-live="polite"
      style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '0 16px 14px',
      }}
    >
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 14,
          border: '1px solid rgba(236, 72, 153, 0.35)',
          background:
            'linear-gradient(120deg, rgba(236,72,153,0.12) 0%, rgba(20,16,42,0.85) 45%, rgba(124,58,237,0.18) 100%)',
          padding: '14px 18px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: pulse ? '0 0 28px rgba(236,72,153,0.45)' : '0 0 18px rgba(236,72,153,0.15)',
          transition: 'box-shadow 0.4s ease',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--pink, #EC4899)',
            }}
          >
            Monchi burn · live
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily: 'var(--mono, ui-monospace, monospace)',
              fontSize: 'clamp(22px, 4vw, 34px)',
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {ready ? fmtBurn(displayBurned) : '…'}
            <span style={{ fontSize: '0.45em', fontWeight: 700, marginLeft: 8, color: 'var(--pink, #EC4899)' }}>
              MONSHI burned
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t3, #A1A1AA)' }}>
            Circulating ticks down as fees buy &amp; burn Monchi on every trade.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t4, #71717A)' }}>
            Circulating
          </div>
          <div
            style={{
              fontFamily: 'var(--mono, ui-monospace, monospace)',
              fontSize: 20,
              fontWeight: 700,
              color: pulse ? 'var(--pink, #EC4899)' : 'var(--t2, #DDD7FE)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'color 0.3s ease',
            }}
          >
            {ready ? fmtBurn(displayCirc) : '…'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

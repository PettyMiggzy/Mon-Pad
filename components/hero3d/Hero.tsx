import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import MonshiBurnCounter from '@/components/MonshiBurnCounter';
import { heroBus, noteBurn } from './bus';

const HeroCanvas = dynamic(() => import('./HeroCanvas'), { ssr: false });

type BoundaryProps = { children: ReactNode; fallback: ReactNode };
type BoundaryState = { failed: boolean };

class WebGLBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Poster() {
  return <img className="pad-hero-poster" src="/meshy/monshi-mascot.webp" alt="Monshi" fetchPriority="high" />;
}

type Props = { symbols: string[] };

export function Hero({ symbols }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  const [low, setLow] = useState(false);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      setReduced(motion.matches);
      setLow(narrow.matches);
    };
    apply();
    motion.addEventListener('change', apply);
    narrow.addEventListener('change', apply);
    return () => {
      motion.removeEventListener('change', apply);
      narrow.removeEventListener('change', apply);
    };
  }, []);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    let onScreen = true;
    const sync = () => setLive(onScreen && document.visibilityState === 'visible');
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.12 },
    );
    io.observe(node);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  useEffect(() => {
    const node = stage.current;
    if (!node || reduced) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)));
        node.style.transform = `translate3d(${progress * -18}px, ${progress * -12}px, 0) scale(${1 - progress * 0.18})`;
        node.style.opacity = String(1 - progress * 0.35);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [reduced]);

  return (
    <section className="pad-hero" aria-label="Monpad">
      <div className="pad-hero-stage" ref={stage}>
        {(!ready || reduced || low) && <Poster />}
        {!reduced && !low && (
          <WebGLBoundary fallback={<Poster />}>
            <HeroCanvas symbols={symbols} low={low} live={live} onReady={() => setReady(true)} />
          </WebGLBoundary>
        )}
      </div>
      <div className="pad-hero-copy">
        <p className="pad-kicker">Monad · 143</p>
        <h1>Launch fair. Burn Monshi.</h1>
        <p>Fair launches straight into a Uniswap V3 pool. On the DEX and DexScreener from block one.</p>
        <div className="pad-hero-actions">
          <Link
            href="/create"
            className="pad-launch"
            onPointerEnter={() => {
              heroBus.lookLaunch = true;
            }}
            onPointerLeave={() => {
              heroBus.lookLaunch = false;
            }}
          >
            + Launch
          </Link>
          <a href="#board" className="pad-ghost">
            The board
          </a>
        </div>
      </div>
      <div className="pad-hero-burn">
        <MonshiBurnCounter compact onBurn={() => noteBurn()} />
      </div>
    </section>
  );
}

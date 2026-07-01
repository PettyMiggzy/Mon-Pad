// components/V3TokenActivity.tsx
// Price chart + live trades feed for a V3 token, read straight from the curve's
// on-chain `Trade` events (no indexer required). Chart uses lightweight-charts
// (loaded client-side only to avoid SSR `window` access).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { getV3Trades, tradesToCandles, getV3Holders, type V3Trade, type V3Holder } from '@/lib/chainV3';
import { MONAD_EXPLORER } from '@/lib/constants';

const TIMEFRAMES: { label: string; sec: number }[] = [
  { label: '1m', sec: 60 },
  { label: '5m', sec: 300 },
  { label: '15m', sec: 900 },
  { label: '1h', sec: 3600 },
];

function shortAddr(a?: string) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '?'; }
function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function fmt(n: number, max = 4): string {
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export default function V3TokenActivity({ curve, symbol, token, refreshKey }: { curve?: Address; symbol?: string; token?: Address; refreshKey?: number }) {
  const [trades, setTrades] = useState<V3Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState(300);
  const [tab, setTab] = useState<'chart' | 'trades' | 'holders'>('chart');
  const [holders, setHolders] = useState<V3Holder[] | null>(null);

  // Lazy-load holders only when the tab is opened (the scan is heavier).
  useEffect(() => {
    if (tab !== 'holders' || !token) return;
    let cancelled = false;
    setHolders(null);
    getV3Holders(token, curve ? [curve] : [])
      .then((h) => { if (!cancelled) setHolders(h); })
      .catch(() => { if (!cancelled) setHolders([]); });
    return () => { cancelled = true; };
  }, [tab, token, curve, refreshKey]);

  useEffect(() => {
    if (!curve) return;
    let cancelled = false;
    let timer: any;
    const load = async () => {
      // Skip polling while the tab is hidden — no point hammering the RPC in the background.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const t = await getV3Trades(curve);
        if (!cancelled) { setTrades(t); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    };
    load();
    timer = setInterval(load, 20000); // poll for fresh trades (paused when tab hidden)
    return () => { cancelled = true; clearInterval(timer); };
    // refreshKey bumps after a trade → reload immediately instead of waiting for the poll.
  }, [curve, refreshKey]);

  const candles = useMemo(() => tradesToCandles(trades, tf), [trades, tf]);

  return (
    <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button onClick={() => setTab('chart')} style={tabStyle(tab === 'chart')}>Chart</button>
        <button onClick={() => setTab('trades')} style={tabStyle(tab === 'trades')}>Trades{trades.length ? ` (${trades.length})` : ''}</button>
        {token && <button onClick={() => setTab('holders')} style={tabStyle(tab === 'holders')}>Holders{holders ? ` (${holders.length})` : ''}</button>}
        <div style={{ flex: 1 }} />
        {tab === 'chart' && TIMEFRAMES.map((f) => (
          <button key={f.sec} onClick={() => setTf(f.sec)} style={tfStyle(tf === f.sec)}>{f.label}</button>
        ))}
      </div>

      {tab === 'holders' ? (
        <HoldersList holders={holders} symbol={symbol} />
      ) : loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading on-chain activity…</div>
      ) : trades.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No trades yet — be the first.</div>
      ) : tab === 'chart' ? (
        <Candles data={candles} />
      ) : (
        <TradesList trades={trades} symbol={symbol} />
      )}
    </div>
  );
}

function Candles({ data }: { data: { time: number; open: number; high: number; low: number; close: number; volume?: number }[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    let chart: any;
    let disposed = false;
    (async () => {
      try {
        const lwc: any = await import('lightweight-charts');
        if (disposed || !ref.current) return;
        chart = lwc.createChart(ref.current, {
          height: 380,
          width: ref.current.clientWidth || undefined,
          layout: { background: { color: 'transparent' }, textColor: '#9aa4b2', fontSize: 11 },
          grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
          // Fixed bar spacing so a handful of candles render at a normal width
          // instead of being stretched across the whole chart ("big as fuk").
          timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.08)', barSpacing: 10, minBarSpacing: 4, rightOffset: 8 },
          // Leave room at the bottom for the volume histogram (DexScreener style).
          rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.08, bottom: 0.26 } },
          crosshair: { mode: 1 },
        });
        // lightweight-charts v5: addSeries(CandlestickSeries, opts); fall back to v4 API.
        const opts = { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' };
        const series = (chart.addSeries && lwc.CandlestickSeries)
          ? chart.addSeries(lwc.CandlestickSeries, opts)
          : chart.addCandlestickSeries(opts);
        // Dedup + ascending by time (lightweight-charts throws otherwise).
        const seen = new Set<number>();
        const rows = data
          .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open))
          .sort((a, b) => a.time - b.time)
          .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)))
          .map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 }));
        series.setData(rows.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

        // Volume histogram pinned to the bottom 20% (green on up candles, red on down).
        try {
          const volOpts = { priceFormat: { type: 'volume' }, priceScaleId: 'vol' };
          const vol = (chart.addSeries && lwc.HistogramSeries)
            ? chart.addSeries(lwc.HistogramSeries, volOpts)
            : chart.addHistogramSeries(volOpts);
          chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          vol.setData(rows.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' })));
        } catch { /* volume overlay is best-effort */ }

        // Only fit-to-content when there's real history; otherwise keep the fixed
        // bar spacing (fitContent stretches 1–3 candles to fill the whole width).
        if (rows.length > 40) chart.timeScale().fitContent();
        else chart.timeScale().scrollToRealTime();
        const onResize = () => { if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth }); };
        onResize();
        window.addEventListener('resize', onResize);
        (chart as any)._onResize = onResize;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[chart] render failed', e);
      }
    })();
    return () => {
      disposed = true;
      if (chart) { try { window.removeEventListener('resize', (chart as any)._onResize); chart.remove(); } catch {} }
    };
  }, [data]);
  return <div ref={ref} style={{ width: '100%', height: 380 }} />;
}

function TradesList({ trades, symbol }: { trades: V3Trade[]; symbol?: string }) {
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 60px 44px', gap: 8, fontSize: 11, color: '#666', padding: '4px 6px', position: 'sticky', top: 0, background: '#16121f' }}>
        <span>Type</span><span>MON</span><span>{symbol || 'Tokens'}</span><span>By</span><span>Age</span>
      </div>
      {trades.slice(0, 100).map((t, i) => (
        <a key={`${t.txHash}-${i}`} href={`${MONAD_EXPLORER}/tx/${t.txHash}`} target="_blank" rel="noreferrer"
           style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 60px 44px', gap: 8, fontSize: 12, padding: '6px', textDecoration: 'none', color: '#ddd', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ color: t.isBuy ? '#4ADE80' : '#F87171', fontWeight: 600 }}>{t.isBuy ? 'BUY' : 'SELL'}</span>
          <span>{fmt(t.mon)}</span>
          <span>{fmt(t.tokens, 0)}</span>
          <span style={{ color: '#888' }}>{shortAddr(t.trader)}</span>
          <span style={{ color: '#666' }}>{ago(t.time)}</span>
        </a>
      ))}
    </div>
  );
}

function HoldersList({ holders, symbol }: { holders: V3Holder[] | null; symbol?: string }) {
  if (holders === null) return <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading holders…</div>;
  if (holders.length === 0) return <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No holders yet.</div>;
  return (
    <div style={{ maxHeight: 340, overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 90px 70px', gap: 8, fontSize: 11, color: '#666', padding: '4px 6px', position: 'sticky', top: 0, background: '#16121f' }}>
        <span>#</span><span>Holder</span><span style={{ textAlign: 'right' }}>{symbol || 'Tokens'}</span><span style={{ textAlign: 'right' }}>%</span>
      </div>
      {holders.map((h, i) => (
        <a key={h.address} href={`${MONAD_EXPLORER}/address/${h.address}`} target="_blank" rel="noreferrer"
           style={{ display: 'grid', gridTemplateColumns: '36px 1fr 90px 70px', gap: 8, fontSize: 12, padding: '6px', textDecoration: 'none', color: '#ddd', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ color: '#666' }}>{i + 1}</span>
          <span style={{ color: '#888' }}>{shortAddr(h.address)}</span>
          <span style={{ textAlign: 'right' }}>{fmt(Number(h.balance) / 1e18, 0)}</span>
          <span style={{ textAlign: 'right', color: 'var(--brand,#A78BFA)' }}>{h.pct.toFixed(2)}%</span>
        </a>
      ))}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return { padding: '6px 12px', background: active ? 'var(--brand,#A78BFA)' : 'rgba(255,255,255,0.04)', color: active ? '#000' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 };
}
function tfStyle(active: boolean): React.CSSProperties {
  return { padding: '4px 8px', background: active ? 'rgba(167,139,250,0.25)' : 'transparent', color: active ? 'var(--brand,#A78BFA)' : '#888', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: 'pointer', fontSize: 11 };
}

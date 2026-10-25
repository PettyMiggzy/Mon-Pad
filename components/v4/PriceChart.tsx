// Candlestick chart for a Monpad V4 token (USD per token). Data comes from /api/v1/candles.
import { useEffect, useRef, useState } from 'react';

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
const UP = '#3DFF9A';
const DOWN = '#FF5C7A';

export default function PriceChart({ poolId, symbol }: { poolId: string; symbol: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [tf, setTf] = useState<(typeof TFS)[number]>('5m');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [indexed, setIndexed] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const r = await fetch(`/api/v1/candles?pool=${poolId}&tf=${tf}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (dead) return;
        setCandles(j.candles || []); setIndexed(j.indexed !== false); setFailed(false);
      } catch { if (!dead) setFailed(true); }
    };
    setCandles(null);
    pull();
    const i = setInterval(pull, 20000);
    return () => { dead = true; clearInterval(i); };
  }, [poolId, tf]);

  useEffect(() => {
    if (!box.current || !candles || candles.length === 0) return;
    let chart: any; let dead = false; let onResize: (() => void) | null = null;
    (async () => {
      const lwc: any = await import('lightweight-charts');
      if (dead || !box.current) return;
      chart = lwc.createChart(box.current, {
        height: 340, width: box.current.clientWidth || undefined,
        layout: { background: { color: 'transparent' }, textColor: '#9B94B0', fontSize: 11 },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.08)', barSpacing: 10, minBarSpacing: 3, rightOffset: 6 },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.08, bottom: 0.24 } },
        crosshair: { mode: 1 },
      });
      // Token prices are tiny (e.g. $0.000003); give the axis enough decimals.
      const last = candles[candles.length - 1].close;
      const precision = last >= 1 ? 4 : Math.min(12, Math.max(4, Math.ceil(-Math.log10(last)) + 3));
      const series = chart.addSeries(lwc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
        priceFormat: { type: 'price', precision, minMove: Math.pow(10, -precision) },
      });
      series.setData(candles.map(({ time, open, high, low, close }) => ({ time: time as any, open, high, low, close })));
      const vol = chart.addSeries(lwc.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(candles.map((c) => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? 'rgba(61,255,154,0.35)' : 'rgba(255,92,122,0.35)' })));
      if (candles.length > 40) chart.timeScale().fitContent(); else chart.timeScale().scrollToRealTime();
      onResize = () => { if (box.current && chart) chart.applyOptions({ width: box.current.clientWidth }); };
      window.addEventListener('resize', onResize);
    })().catch(() => {});
    return () => { dead = true; if (onResize) window.removeEventListener('resize', onResize); if (chart) { try { chart.remove(); } catch { /* already gone */ } } };
  }, [candles]);

  const last = candles && candles.length ? candles[candles.length - 1] : null;
  return (
    <div className="v4-chart" style={{ padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: 14 }}>${symbol} / USD</b>
        <span style={{ display: 'flex', gap: 4 }}>
          {TFS.map((t) => <button key={t} type="button" onClick={() => setTf(t)} aria-pressed={tf === t} style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, cursor: 'pointer', color: '#fff', border: `1px solid ${tf === t ? 'rgba(131,110,249,0.9)' : 'rgba(255,255,255,0.15)'}`, background: tf === t ? 'rgba(131,110,249,0.25)' : 'transparent' }}>{t}</button>)}
        </span>
      </div>
      {candles && candles.length > 0 ? <div ref={box} style={{ width: '100%', height: 340 }} />
        : <div style={{ height: 340, display: 'grid', placeItems: 'center', color: '#9B94B0', fontSize: 13, textAlign: 'center', padding: 16 }}>
            {candles === null && !failed ? 'Loading chart…' : failed ? 'Chart data is unavailable right now. It will retry.' : indexed ? 'No trades yet. The chart starts with the first trade.' : 'Chart is warming up. It appears a few minutes after the first trade.'}
          </div>}
      {last && <div style={{ marginTop: 6, fontSize: 11, color: '#777' }}>Candles from GeckoTerminal. Last close ${last.close < 0.01 ? last.close.toExponential(3) : last.close.toFixed(4)}</div>}
    </div>
  );
}

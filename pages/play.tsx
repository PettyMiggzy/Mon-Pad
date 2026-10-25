import { useEffect, useState } from 'react';
import Head from 'next/head';

type Row = { player: string; milk: number; best: number; races: number };
const MEDAL = ['#FFD23D', '#C9CFDA', '#E0955A'];

export default function PlayPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    fetch('/api/game/leaderboard').then((r) => (r.ok ? r.json() : { rows: [] })).then((j) => setRows(j.rows || [])).catch(() => setRows([]));
  }, []);
  return (
    <div className="pl">
      <Head><title>Monshi Kart | MONPAD</title></Head>
      <div className="pl-grid">
        <aside className="pl-side">
          <h1>Monshi Kart</h1>
          <p style={{ color: 'var(--t3)', margin: 0 }}>Race, collect milk, upgrade your kart.</p>
          <div className="pl-card">
            <b>How it works</b>
            <ul>
              <li>Finish races to earn milk.</li>
              <li>Spend milk in the garage on karts, power-ups and upgrades.</li>
              <li>Dodge the hazards, grab the green candles.</li>
            </ul>
          </div>
          <div className="pl-card pl-keys-card">
            <b>Controls</b>
            <div className="pl-keys">
              <span><kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd></span><em>Steer</em>
              <span><kbd>SPACE</kbd></span><em>Zap</em>
              <span><kbd>N</kbd></span><em>Nitro</em>
            </div>
            <p style={{ color: 'var(--t3)', fontSize: 13, margin: '8px 0 0' }}>On a phone, tap and drag.</p>
          </div>
        </aside>
        <div className="pl-frame"><iframe src="/games/munchy-kart/index.html?embed=1" title="Monshi Kart" allow="autoplay; fullscreen" /></div>
        <div className="pl-lb">
          <div style={{ padding: '14px 16px', fontWeight: 800 }}>Leaderboard</div>
          <table>
            <thead><tr><th>#</th><th>Player</th><th>Best</th><th>Milk</th></tr></thead>
            <tbody>
              {(rows || []).map((r, i) => (
                <tr key={r.player}>
                  <td>{i < 3 ? <span className="pl-medal" style={{ background: MEDAL[i] }}>{i + 1}</span> : i + 1}</td>
                  <td>{r.player}</td><td>{r.best.toLocaleString()}</td><td>{r.milk.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows !== null && rows.length === 0 && <div style={{ padding: 18, color: 'var(--t3)' }}>No scores yet. Be the first on the board.</div>}
          {rows === null && <div style={{ padding: 18, color: 'var(--t3)' }}>Loading…</div>}
        </div>
      </div>
    </div>
  );
}

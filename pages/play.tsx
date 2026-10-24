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
      <Head><title>Munchy Kart | MONPAD</title></Head>
      <h1>Munchy Kart</h1>
      <p style={{ color: 'var(--t3)', margin: '0 0 14px' }}>Race, earn milk, spend it in the garage. Pick a kart in the garage, then race or drive.</p>
      <div className="pl-frame"><iframe src="/games/munchy-kart/index.html" title="Munchy Kart" allow="autoplay; fullscreen" /></div>
      <div className="pl-lb">
        <div style={{ padding: '14px 16px', fontWeight: 800 }}>Leaderboard</div>
        <table>
          <thead><tr><th>#</th><th>Player</th><th>Best</th><th>Milk</th><th>Races</th></tr></thead>
          <tbody>
            {(rows || []).map((r, i) => (
              <tr key={r.player}>
                <td>{i < 3 ? <span className="pl-medal" style={{ background: MEDAL[i] }}>{i + 1}</span> : i + 1}</td>
                <td>{r.player}</td><td>{r.best.toLocaleString()}</td><td>{r.milk.toLocaleString()}</td><td>{r.races.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows !== null && rows.length === 0 && <div style={{ padding: 18, color: 'var(--t3)' }}>No scores yet. Be the first on the board.</div>}
        {rows === null && <div style={{ padding: 18, color: 'var(--t3)' }}>Loading…</div>}
      </div>
    </div>
  );
}

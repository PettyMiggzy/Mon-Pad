// pages/launch.tsx — "Bonding Orrery" (special link: /launch)
// A living 3D solar system of the pad: every token orbits a central Mon-Pad star,
// bonding progress pulls it inward + speeds it up, graduation flings it to a green
// ring. Click any body to open its token page. Search / filter chips / leaderboard
// make thousands of tokens navigable. Live tokens blended with demo bodies so the
// bay looks alive in preview.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatEther } from 'viem';
import { listV3Tokens } from '@/lib/chainV3';
import type { Rocket, OrreryFilter } from '@/components/LaunchBay3D';

function Loading() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>MON-PAD · BONDING ORRERY</div>
        <div style={{ marginTop: 8, color: '#7c6aa8' }}>waking Monshi…</div>
      </div>
    </div>
  );
}

const LaunchBay3D = dynamic(() => import('@/components/LaunchBay3D'), { ssr: false, loading: () => <Loading /> });

// Procedural demo bodies so the orrery reads as a living galaxy in preview even
// before there's much on-chain activity. Deterministic (no Math.random at module
// scope issues) — seeded from index. These have no address, so they're ambient
// (not clickable). Real tokens are blended in front and ARE clickable.
function demoBodies(n: number): Rocket[] {
  const out: Rocket[] = [];
  for (let i = 0; i < n; i++) {
    const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const p = Math.abs(r);
    const graduated = i % 17 === 0;
    const boosted = i % 29 === 0;
    out.push({
      name: `Demo ${i}`, symbol: `D${i}`, address: '',
      progress: graduated ? 1 : Math.min(0.98, 0.05 + p * 0.9),
      graduated, boosted,
      mcMon: 500 + Math.abs((Math.cos(i * 7.13) * 9000)),
    });
  }
  return out;
}

const CHIPS: { key: OrreryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trending', label: 'Trending' },
  { key: 'boosted', label: 'Boosted' },
  { key: 'neargrad', label: 'Near-grad' },
  { key: 'graduated', label: 'Graduated' },
];

function score(t: Rocket) { return (t.boosted ? 3 : 0) + (!t.graduated && t.progress >= 0.9 ? 2 : 0) + t.progress + (t.graduated ? 0.5 : 0); }
function fmtMon(n?: number) {
  if (!n) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export default function LaunchPage() {
  const [rockets, setRockets] = useState<Rocket[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OrreryFilter>('all');
  const [hovered, setHovered] = useState<Rocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    listV3Tokens(300)
      .then((toks) => {
        if (cancelled) return;
        const real: Rocket[] = toks.map((t) => {
          let mcMon = 0;
          try { mcMon = Number(formatEther(BigInt(t.priceWeiPerToken))) * 1e9; } catch { mcMon = 0; }
          return { name: t.name, symbol: t.symbol, address: t.token, progress: t.progress, graduated: t.graduated, mcMon };
        });
        // Mark the highest-progress live token as boosted so the gold state shows.
        let topIdx = -1, topP = -1;
        real.forEach((r, i) => { if (!r.graduated && r.progress > topP) { topP = r.progress; topIdx = i; } });
        if (topIdx >= 0) real[topIdx].boosted = true;
        // Blend demo bodies behind the real ones so the bay is populated.
        const pad = real.length < 140 ? demoBodies(160 - real.length) : [];
        setRockets([...real, ...pad]);
      })
      .catch(() => { if (!cancelled) setRockets(demoBodies(160)); });
    return () => { cancelled = true; };
  }, []);

  const list = rockets || [];
  const counts = useMemo(() => ({
    fueling: list.filter((t) => !t.graduated).length,
    near: list.filter((t) => !t.graduated && t.progress >= 0.9).length,
    grad: list.filter((t) => t.graduated).length,
    boost: list.filter((t) => t.boosted).length,
  }), [list]);

  const trendCut = useMemo(() => {
    const s = list.map(score).sort((a, b) => b - a);
    return s[Math.floor(s.length * 0.25)] ?? 0;
  }, [list]);

  const leaderboard = useMemo(() => {
    const q = query.toLowerCase();
    return list
      .filter((t) => {
        if (q && !(t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.address?.toLowerCase().includes(q))) return false;
        if (filter === 'boosted') return t.boosted;
        if (filter === 'neargrad') return !t.graduated && t.progress >= 0.9;
        if (filter === 'graduated') return t.graduated;
        if (filter === 'trending') return score(t) >= trendCut;
        return true;
      })
      .map((t) => ({ t, s: score(t) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 18)
      .map((x) => x.t);
  }, [list, query, filter, trendCut]);

  const open = (a?: string) => { if (a) window.location.href = `/token/${a}`; };

  return (
    <>
      <Head>
        <title>Bonding Orrery (3D) | Mon-Pad</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        {rockets ? <LaunchBay3D rockets={rockets} query={query} filter={filter} onHover={setHovered} /> : <Loading />}

        {/* Title */}
        <div style={{ position: 'absolute', top: 16, left: 18, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 21, fontWeight: 900, color: '#fff', letterSpacing: 0.5, textShadow: '0 0 16px rgba(139,92,246,0.8)' }}>
              MON-PAD <span style={{ color: '#a78bfa' }}>BONDING ORRERY</span>
            </span>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#000', background: '#a78bfa', padding: '2px 7px', borderRadius: 999, letterSpacing: 1 }}>3D</span>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: '#9aa4b2' }}>drag to orbit · scroll to zoom · click a body to open it</div>
        </div>

        {/* Search + chips */}
        <div style={{ position: 'absolute', top: 62, left: 18, display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name / symbol / address…"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(139,92,246,0.45)',
              background: 'rgba(10,6,20,0.75)', color: '#fff', fontSize: 13, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                style={{
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${filter === c.key ? '#a78bfa' : 'rgba(139,92,246,0.3)'}`,
                  background: filter === c.key ? 'rgba(139,92,246,0.35)' : 'rgba(10,6,20,0.6)',
                  color: filter === c.key ? '#fff' : '#c4b5fd',
                }}
              >{c.label}</button>
            ))}
          </div>
        </div>

        {/* Live cohort counts */}
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 14, background: 'rgba(10,6,20,0.6)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '7px 14px', fontSize: 12, color: '#cbd5e1' }}>
          <span>🟣 Fueling <b style={{ color: '#fff' }}>{counts.fueling}</b></span>
          <span>🟠 Near-grad <b style={{ color: '#fff' }}>{counts.near}</b></span>
          <span>🟢 Graduated <b style={{ color: '#fff' }}>{counts.grad}</b></span>
          <span>⭐ Boosted <b style={{ color: '#fff' }}>{counts.boost}</b></span>
        </div>

        {/* Leaderboard */}
        <div style={{ position: 'absolute', top: 62, right: 18, width: 240, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', background: 'rgba(10,6,20,0.6)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: 0.5 }}>TOP {leaderboard.length}</div>
          {leaderboard.map((t, i) => {
            const col = t.boosted ? '#FFD700' : t.graduated ? '#4ADE80' : '#A78BFA';
            return (
              <div
                key={(t.address || t.symbol) + i}
                onClick={() => open(t.address)}
                onMouseEnter={() => setHovered(t)}
                onMouseLeave={() => setHovered(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', borderRadius: 8, cursor: t.address ? 'pointer' : 'default', color: '#e5e7eb' }}
                onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(139,92,246,0.18)'; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span style={{ width: 16, color: '#7c6aa8', fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: col, boxShadow: `0 0 8px ${col}`, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.boosted ? '🚀 ' : ''}${t.symbol}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa4b2' }}>
                  {t.graduated ? 'LAUNCHED' : `${Math.round(t.progress * 100)}%`}
                </span>
              </div>
            );
          })}
          {leaderboard.length === 0 && <div style={{ fontSize: 12, color: '#7c6aa8' }}>no matches</div>}
        </div>

        {/* Hovered chip */}
        {hovered && (
          <div style={{ position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)', background: 'rgba(10,6,20,0.85)', border: `1px solid ${hovered.boosted ? '#FFD700' : hovered.graduated ? '#4ADE80' : '#A78BFA'}`, borderRadius: 10, padding: '8px 14px', color: '#fff', fontSize: 13, boxShadow: '0 0 16px rgba(139,92,246,0.5)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <b>{hovered.boosted ? '🚀 ' : ''}${hovered.symbol}</b>
            <span style={{ color: '#9aa4b2' }}>{hovered.graduated ? 'LAUNCHED' : `${Math.round(hovered.progress * 100)}% bonded`}</span>
            <span style={{ color: '#9aa4b2' }}>· {fmtMon(hovered.mcMon)} MON mc</span>
            {hovered.address && <span style={{ color: '#c4b5fd' }}>· click to open</span>}
          </div>
        )}

        {/* Legend */}
        <div style={{ position: 'absolute', bottom: 16, left: 18, fontSize: 12, color: '#cbd5e1', background: 'rgba(10,6,20,0.6)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '8px 12px', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 800, color: '#fff', marginBottom: 2 }}>Reading the orrery</div>
          <div>🟣 closer to Monshi = closer to graduation</div>
          <div>🟡 gold = boosted / about to bond</div>
          <div>🟢 green ring = graduated to DEX</div>
        </div>

        {/* Back link */}
        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px' }}>
          ← Back to Mon-Pad
        </Link>
      </div>
    </>
  );
}

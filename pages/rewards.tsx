// pages/rewards.tsx — "Monshi Rewards": daily streak check-in, referrals, leaderboard,
// and a MONSHI holding multiplier. The retention + virality engine — earn points,
// climb the board, hold MONSHI to multiply, season airdrop. (Points are off-chain
// rewards, not yield.)

import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useSignMessage } from 'wagmi';

type Status = {
  wallet: string; points: number; streak: number; checkedInToday: boolean;
  refCount: number; referredBy: string | null; monshi: number; tier: string; multiplier: number; rank: number;
};
type Row = { wallet: string; points: number; streak: number };

const TIER_COLORS: Record<string, string> = { Diamond: '#7dd3fc', Gold: '#FFD700', Silver: '#cbd5e1', Bronze: '#d19a66', Member: '#a78bfa' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => n.toLocaleString('en-US');
const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 14 };

export default function RewardsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [board, setBoard] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refTried, setRefTried] = useState(false);

  const load = useCallback(async () => {
    if (!address) { setSt(null); return; }
    try {
      const r = await fetch(`/api/rewards?wallet=${address}`);
      if (r.ok) setSt(await r.json());
    } catch { /* ignore */ }
  }, [address]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch('/api/rewards?leaderboard=1').then((r) => r.ok ? r.json() : []).then(setBoard).catch(() => {}); }, [st?.points]);

  // Apply an incoming referral once (?ref=0x…), after the user has a status row.
  // The referee signs to prove wallet ownership (server rejects unsigned refers);
  // refTried gates it to a single attempt so a declined signature can't re-prompt.
  useEffect(() => {
    const ref = (router.query.ref as string) || '';
    if (refTried || !address || !st || st.referredBy || !/^0x[0-9a-fA-F]{40}$/.test(ref) || ref.toLowerCase() === address.toLowerCase()) return;
    setRefTried(true);
    (async () => {
      try {
        const signature = await signMessageAsync({ account: address, message: `Mon-Pad Rewards: refer ${ref.toLowerCase()}` });
        const r = await fetch('/api/rewards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refer', wallet: address, code: ref, signature }) });
        if (r.ok) { setMsg('🎉 Referral applied — +250 points!'); load(); }
      } catch { /* user declined the signature */ }
    })();
  }, [address, st, router.query.ref, load, refTried, signMessageAsync]);

  async function checkIn() {
    if (!address || busy) return;
    setBusy(true); setMsg(null);
    try {
      const d = new Date().toISOString().slice(0, 10);
      const signature = await signMessageAsync({ account: address, message: `Mon-Pad Rewards: daily check-in ${d}` });
      const r = await fetch('/api/rewards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'checkin', wallet: address, signature }) });
      const j = await r.json();
      if (r.ok) { setMsg(`🔥 +${fmt(j.earned)} points! Day ${j.streak} streak.`); load(); }
      else setMsg(j.error === 'already checked in today' ? '✅ Already checked in today — come back tomorrow.' : `Error: ${j.error}`);
    } catch { setMsg('Check-in cancelled.'); }
    setBusy(false);
  }

  const refLink = address ? `${typeof window !== 'undefined' ? window.location.origin : 'https://www.monpad.net'}/rewards?ref=${address}` : '';
  function copyRef() { if (!refLink) return; navigator.clipboard?.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }

  const tierColor = st ? (TIER_COLORS[st.tier] || '#a78bfa') : '#a78bfa';

  return (
    <>
      <Head>
        <title>Monshi Rewards | Mon-Pad</title>
        <meta name="description" content="Earn Monshi Rewards on Mon-Pad — daily streaks, referrals, leaderboard. Hold MONSHI to multiply your points toward the season airdrop." />
      </Head>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 64px', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Monshi <span style={{ color: '#a78bfa' }}>Rewards</span></h1>
          <p style={{ color: '#9aa4b2', marginTop: 6, fontSize: 14 }}>Check in daily, invite friends, climb the board. <b style={{ color: '#c4b5fd' }}>Hold MONSHI to multiply everything.</b> Points convert to the Season 1 airdrop.</p>
        </div>

        {!address ? (
          <div style={{ ...card, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎁</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Connect your wallet to start earning</div>
            <div style={{ color: '#9aa4b2', marginTop: 6, fontSize: 13 }}>Use the Connect button up top.</div>
          </div>
        ) : (
          <>
            {/* Top stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
              <Stat label="Your points" value={st ? fmt(st.points) : '—'} big />
              <Stat label="Rank" value={st ? `#${fmt(st.rank)}` : '—'} />
              <Stat label="Streak" value={st ? `🔥 ${st.streak}d` : '—'} />
              <Stat label="Tier" value={st ? st.tier : '—'} color={tierColor} sub={st ? `${st.multiplier}× points` : undefined} />
            </div>

            {/* Check-in */}
            <div style={{ ...card, padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Daily check-in</div>
                <div style={{ color: '#9aa4b2', fontSize: 13, marginTop: 2 }}>
                  {st ? <>Base {100} × <b style={{ color: tierColor }}>{st.multiplier}×</b> tier × streak bonus. Miss a day and the streak resets.</> : 'Loading…'}
                </div>
              </div>
              <button
                onClick={checkIn}
                disabled={busy || (st?.checkedInToday ?? false)}
                style={{
                  padding: '12px 22px', borderRadius: 10, fontWeight: 800, fontSize: 15, border: 'none',
                  cursor: busy || st?.checkedInToday ? 'default' : 'pointer',
                  background: st?.checkedInToday ? 'rgba(74,222,128,0.2)' : '#8B5CF6',
                  color: st?.checkedInToday ? '#4ADE80' : '#fff', opacity: busy ? 0.6 : 1,
                }}
              >
                {st?.checkedInToday ? '✅ Checked in' : busy ? 'Signing…' : '🔥 Check in (free)'}
              </button>
            </div>
            {msg && <div style={{ ...card, padding: '10px 14px', marginBottom: 16, fontSize: 14, borderColor: 'rgba(167,139,250,0.5)' }}>{msg}</div>}

            {/* Referral + Multiplier */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={{ ...card, padding: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Invite friends</div>
                <div style={{ color: '#9aa4b2', fontSize: 13, margin: '4px 0 12px' }}>You get <b style={{ color: '#fff' }}>+500</b>, they get <b style={{ color: '#fff' }}>+250</b>. Referrals: <b style={{ color: '#fff' }}>{st?.refCount ?? 0}</b></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input readOnly value={refLink} style={{ flex: 1, padding: '9px 10px', borderRadius: 8, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(0,0,0,0.3)', color: '#c4b5fd', fontSize: 12 }} />
                  <button onClick={copyRef} style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: '#8B5CF6', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              </div>
              <div style={{ ...card, padding: 18 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Hold MONSHI → earn faster</div>
                <div style={{ color: '#9aa4b2', fontSize: 13, marginTop: 4, marginBottom: 10 }}>You hold <b style={{ color: '#fff' }}>{st ? fmt(Math.floor(st.monshi)) : '—'}</b> MONSHI ({st?.tier})</div>
                {[['Diamond', '5M+', '3×'], ['Gold', '1M+', '2×'], ['Silver', '250K+', '1.5×'], ['Bronze', '100K+', '1.25×']].map(([t, need, mult]) => (
                  <div key={t} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: st?.tier === t ? TIER_COLORS[t] : '#9aa4b2', fontWeight: st?.tier === t ? 800 : 400 }}>
                    <span>{t} <span style={{ color: '#6b7280' }}>({need})</span></span><span>{mult}</span>
                  </div>
                ))}
                <Link href="/swap" style={{ display: 'block', textAlign: 'center', marginTop: 12, background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.5)', color: '#fff', textDecoration: 'none', padding: 10, borderRadius: 8, fontWeight: 700 }}>Get MONSHI →</Link>
              </div>
            </div>
          </>
        )}

        {/* Leaderboard */}
        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>🏆 Leaderboard</div>
          {board.length === 0 ? (
            <div style={{ color: '#9aa4b2', fontSize: 13 }}>No one has earned yet — be first.</div>
          ) : (
            board.map((r, i) => {
              const me = address && r.wallet.toLowerCase() === address.toLowerCase();
              return (
                <div key={r.wallet} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', background: me ? 'rgba(139,92,246,0.12)' : 'transparent', borderRadius: 8 }}>
                  <span style={{ width: 30, color: i < 3 ? '#FFD700' : '#7c6aa8', fontWeight: 800 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: me ? '#fff' : '#cbd5e1' }}>{short(r.wallet)}{me ? ' (you)' : ''}</span>
                  <span style={{ color: '#9aa4b2', fontSize: 12 }}>🔥{r.streak}</span>
                  <span style={{ fontWeight: 800 }}>{fmt(r.points)}</span>
                </div>
              );
            })
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#6b7280' }}>
          Points are non-transferable rewards and convert to the Season 1 MONSHI airdrop. Not financial advice; not yield.
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub, color, big }: { label: string; value: string; sub?: string; color?: string; big?: boolean }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#9aa4b2', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: big ? 30 : 22, fontWeight: 900, marginTop: 2, color: color || '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9aa4b2', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

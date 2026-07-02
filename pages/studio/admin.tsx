// pages/studio/admin.tsx — Monshi Studio revenue dashboard (admins only).
// Shows the money side of the AI resale: MON in, credits sold vs burned, provider
// cost, and the margin multiple that must stay >= 3x for the model to work.
// Gated twice: client hides it from non-admins, /api/studio/stats enforces it.

import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { isAdmin } from '@/lib/constants';

type Stats = {
  monUsd: number;
  revenue: { monIn: number; grossUsd: number; monIn24h: number; monIn7d: number; accessUnlocks: number; creditTopups: number; creditsSold: number };
  usage: { totalCalls: number; calls24h: number; calls7d: number; creditsSpent: number; providerCostUsd: number; revenueRecognizedUsd: number; marginUsd: number; marginMultiple: number | null };
  liability: { creditsOutstanding: number; creditsOutstandingUsd: number };
  accounts: { total: number; paid: number };
  byMode: { mode: string; calls: number; credits: number; revenueUsd: number; costUsd: number }[];
};

const card: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 14 };
const fmt = (n: number) => n.toLocaleString('en-US');
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const dayStr = () => new Date().toISOString().slice(0, 10);

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ ...card, padding: 16, flex: '1 1 160px', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: '#9aa4b2' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: accent || '#fff', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#7c6aa8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function StudioAdminPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const admin = isAdmin(address);

  async function getSig(): Promise<string> {
    if (!address) throw new Error('connect wallet');
    const key = `studio-sig:${address.toLowerCase()}:${dayStr()}`;
    const cached = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    if (cached) return cached;
    const sig = await signMessageAsync({ account: address, message: `Mon-Pad Studio: ${address.toLowerCase()} ${dayStr()}` });
    localStorage.setItem(key, sig);
    return sig;
  }

  const load = useCallback(async () => {
    if (!address || !admin || busy) return;
    setBusy(true); setErr(null);
    try {
      const signature = await getSig();
      const r = await fetch('/api/studio/stats', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed to load stats');
      setStats(j);
    } catch (e: any) { setErr(String(e?.message || 'error').slice(0, 160)); }
    setBusy(false);
  }, [address, admin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (admin) load(); }, [admin, load]);

  const mm = stats?.usage.marginMultiple;
  const marginAccent = mm == null ? '#9aa4b2' : mm >= 3 ? '#4ADE80' : mm >= 1 ? '#f59e0b' : '#f87171';

  return (
    <>
      <Head><title>Studio Admin | Mon-Pad</title><meta name="robots" content="noindex" /></Head>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 40px', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Monshi <span style={{ color: '#a78bfa' }}>Studio</span> · Revenue</h1>
          <Link href="/studio" style={{ marginLeft: 'auto', fontSize: 13, color: '#a78bfa' }}>← Studio</Link>
          {admin && <button onClick={load} disabled={busy} style={{ ...card, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: busy ? 0.5 : 1 }}>{busy ? '…' : '↻ Refresh'}</button>}
        </div>

        {!address ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9aa4b2' }}>Connect your admin wallet.</div>
        ) : !admin ? (
          <div style={{ ...card, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
            <b>Admins only</b>
            <div style={{ color: '#9aa4b2', fontSize: 13, marginTop: 6 }}>This wallet isn't on the admin list.</div>
          </div>
        ) : err ? (
          <div style={{ ...card, padding: 24, textAlign: 'center', color: '#f87171' }}>{err}</div>
        ) : !stats ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: '#9aa4b2' }}>loading…</div>
        ) : (
          <>
            {/* Money in */}
            <div style={{ fontSize: 12, color: '#7c6aa8', textTransform: 'uppercase', letterSpacing: 1, margin: '4px 0 8px' }}>Money in</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="MON collected" value={fmt(stats.revenue.monIn)} sub={`≈ ${usd(stats.revenue.grossUsd)} @ $${stats.monUsd}/MON`} accent="#4ADE80" />
              <Kpi label="MON · 24h" value={fmt(stats.revenue.monIn24h)} />
              <Kpi label="MON · 7d" value={fmt(stats.revenue.monIn7d)} />
              <Kpi label="Access unlocks" value={fmt(stats.revenue.accessUnlocks)} sub={`${fmt(stats.revenue.creditTopups)} credit top-ups`} />
            </div>

            {/* Margin */}
            <div style={{ fontSize: 12, color: '#7c6aa8', textTransform: 'uppercase', letterSpacing: 1, margin: '4px 0 8px' }}>Margin (AI resale)</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="Margin multiple" value={mm == null ? '—' : `${mm.toFixed(1)}x`} sub="target ≥ 3x" accent={marginAccent} />
              <Kpi label="Revenue recognized" value={usd(stats.usage.revenueRecognizedUsd)} sub="credits burned × $0.01" />
              <Kpi label="Provider cost" value={usd(stats.usage.providerCostUsd)} sub="worst-case model spend" accent="#f59e0b" />
              <Kpi label="Gross margin" value={usd(stats.usage.marginUsd)} accent={stats.usage.marginUsd >= 0 ? '#4ADE80' : '#f87171'} />
            </div>

            {/* Usage + liability */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="AI calls" value={fmt(stats.usage.totalCalls)} sub={`${fmt(stats.usage.calls24h)} today · ${fmt(stats.usage.calls7d)} / 7d`} />
              <Kpi label="Credits sold" value={fmt(stats.revenue.creditsSold)} />
              <Kpi label="Credits burned" value={fmt(stats.usage.creditsSpent)} />
              <Kpi label="Credits outstanding" value={fmt(stats.liability.creditsOutstanding)} sub={`${usd(stats.liability.creditsOutstandingUsd)} liability`} accent="#c4b5fd" />
              <Kpi label="Accounts" value={fmt(stats.accounts.total)} sub={`${fmt(stats.accounts.paid)} paid`} />
            </div>

            {/* Per-mode */}
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>By mode</div>
              {stats.byMode.length === 0 ? (
                <div style={{ color: '#9aa4b2', fontSize: 13 }}>No usage yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 460 }}>
                    <thead>
                      <tr style={{ color: '#9aa4b2', textAlign: 'right' }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Mode</th>
                        <th style={{ padding: '4px 8px' }}>Calls</th>
                        <th style={{ padding: '4px 8px' }}>Credits</th>
                        <th style={{ padding: '4px 8px' }}>Revenue</th>
                        <th style={{ padding: '4px 8px' }}>Cost</th>
                        <th style={{ padding: '4px 8px' }}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byMode.map((m) => {
                        const margin = m.costUsd > 0 ? m.revenueUsd / m.costUsd : null;
                        return (
                          <tr key={m.mode} style={{ borderTop: '1px solid rgba(139,92,246,0.15)', textAlign: 'right' }}>
                            <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{m.mode}</td>
                            <td style={{ padding: '6px 8px' }}>{fmt(m.calls)}</td>
                            <td style={{ padding: '6px 8px' }}>{fmt(m.credits)}</td>
                            <td style={{ padding: '6px 8px', color: '#4ADE80' }}>{usd(m.revenueUsd)}</td>
                            <td style={{ padding: '6px 8px', color: '#f59e0b' }}>{usd(m.costUsd)}</td>
                            <td style={{ padding: '6px 8px', color: margin == null ? '#9aa4b2' : margin >= 3 ? '#4ADE80' : '#f59e0b' }}>{margin == null ? '—' : `${margin.toFixed(1)}x`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#7c6aa8', marginTop: 10 }}>
                Revenue = credits burned × $0.01. Cost = worst-case provider spend (server-capped max_tokens). The free holder lane shows revenue $0 by design — it's the acquisition cost the paid tiers subsidize.
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

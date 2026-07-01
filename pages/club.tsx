// pages/club.tsx — "Monshi Club" (gated members lounge, special link: /club)
// Gate reads your on-chain MONSHI balance. Hold the entry threshold (or hit Preview)
// → the camera drops you inside Monshi's inner ring, where perk stations orbit the
// idol. Clicking a station opens its panel. Perks are mock data for now (visual
// preview to show the team); wiring them to real data/txs is the next step.

import dynamic from 'next/dynamic';
import Head from 'next/head';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { MONSHI_TOKEN } from '@/lib/constants';
import { tokenAbi } from '@/lib/abis';
import type { Station } from '@/components/ClubDeck3D';

const ClubDeck3D = dynamic(() => import('@/components/ClubDeck3D'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#a78bfa', background: '#05030c', fontFamily: 'system-ui' }}>
      entering the club…
    </div>
  ),
});

const ZERO = '0x0000000000000000000000000000000000000000';
const ENTRY = 100_000; // MONSHI required to enter
const TIERS = [
  { name: 'Diamond', min: 5_000_000, color: '#7dd3fc' },
  { name: 'Gold', min: 1_000_000, color: '#FFD700' },
  { name: 'Silver', min: 250_000, color: '#cbd5e1' },
  { name: 'Bronze', min: 100_000, color: '#d19a66' },
];

const STATIONS: Station[] = [
  { key: 'launch', icon: '🛰️', title: 'Launch Dock', sub: 'New tokens, 60s early', color: '#8B5CF6' },
  { key: 'alpha', icon: '📡', title: 'Alpha Feed', sub: 'Whale buys · pre-grad', color: '#22d3ee' },
  { key: 'boost', icon: '🔥', title: 'Boost Altar', sub: 'Spend MONSHI to trend', color: '#FFD700' },
  { key: 'vault', icon: '🎟️', title: 'Vault', sub: 'Rebates · free boosts', color: '#4ADE80' },
];

const NEW_TOKENS = [
  { n: 'Laser Cat', s: 'LSR', pfp: 16, prog: 8, secs: 42 },
  { n: 'Banana Gang', s: 'NANA', pfp: 15, prog: 5, secs: 51 },
  { n: 'Botcat', s: 'BOTC', pfp: 4, prog: 12, secs: 19 },
  { n: 'Arch Mage', s: 'MAGE', pfp: 6, prog: 3, secs: 58 },
];
const ALPHA = [
  '🐋 0x9f…a2 bought $4,210 of $PEPE',
  '🎓 $BULL about to graduate — 96%',
  '🔥 $NANA trending +182% (15m)',
  '🐋 0x12…7c bought $1,900 of $LION',
  '🆕 New mint: Diamond Hands ($DMND)',
];

const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`);
const card = { background: 'rgba(12,8,22,0.9)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 12 };

function Panel({ k, onClose }: { k: string; onClose: () => void }) {
  const titles: Record<string, string> = { launch: '🛰️ Launch Dock', alpha: '📡 Alpha Feed', boost: '🔥 Boost Altar', vault: '🎟️ Vault' };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'system-ui' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(440px, 92vw)', maxHeight: '80vh', overflowY: 'auto', padding: 18, color: '#fff', boxShadow: '0 0 40px rgba(139,92,246,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>{titles[k]}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9aa4b2', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {k === 'launch' && (
          <>
            <div style={{ fontSize: 12, color: '#c4b5fd', marginBottom: 10 }}>Members see & ape new mints before the public feed.</div>
            {NEW_TOKENS.map((t) => (
              <div key={t.s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/mock/pfp${String(t.pfp).padStart(2, '0')}.png`} alt={t.s} width={38} height={38} style={{ borderRadius: 8 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{t.n} <span style={{ color: '#888' }}>${t.s}</span></div>
                  <div style={{ fontSize: 11, color: '#f59e0b' }}>⏳ public in {t.secs}s · {t.prog}% bonded</div>
                </div>
                <button style={{ marginLeft: 'auto', ...card, border: '1px solid #8B5CF6', color: '#fff', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Ape</button>
              </div>
            ))}
          </>
        )}

        {k === 'alpha' && (
          <>
            <div style={{ fontSize: 12, color: '#c4b5fd', marginBottom: 10 }}>Signals members get before the public trending group.</div>
            {ALPHA.map((line, i) => (
              <div key={i} style={{ padding: '9px 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 14 }}>{line}</div>
            ))}
          </>
        )}

        {k === 'boost' && (
          <>
            <div style={{ fontSize: 12, color: '#c4b5fd', marginBottom: 10 }}>Spend MONSHI to force-trend a token. 🔥 70% burned · 30% treasury.</div>
            {[{ t: '5M MONSHI', d: '48 hours' }, { t: '10M MONSHI', d: '5 days' }, { t: 'Custom', d: 'your amount' }].map((b) => (
              <button key={b.t} style={{ width: '100%', ...card, border: '1px solid #FFD700', color: '#fff', padding: '12px', borderRadius: 10, cursor: 'pointer', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{b.t}</span><span style={{ color: '#9aa4b2' }}>{b.d}</span>
              </button>
            ))}
          </>
        )}

        {k === 'vault' && (
          <>
            <div style={{ fontSize: 12, color: '#c4b5fd', marginBottom: 10 }}>Your member rewards.</div>
            {[['Fee rebate available', '12.4 MON'], ['Free boosts remaining', '2'], ['Discount tier', '15% off create/trade']].map(([a, b]) => (
              <div key={a} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 14 }}>
                <span style={{ color: '#9aa4b2' }}>{a}</span><b>{b}</b>
              </div>
            ))}
            <button style={{ width: '100%', ...card, border: '1px solid #4ADE80', color: '#fff', padding: '12px', borderRadius: 10, cursor: 'pointer', marginTop: 10, fontWeight: 800 }}>Claim rebate</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ClubPage() {
  const { address } = useAccount();
  const [preview, setPreview] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);

  const { data: balRaw } = useReadContract({
    address: MONSHI_TOKEN as `0x${string}`,
    abi: tokenAbi as any,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balance = balRaw ? Number(formatUnits(balRaw as bigint, 18)) : 0;
  const tier = useMemo(() => TIERS.find((t) => balance >= t.min) || null, [balance]);
  const isMember = !!tier;
  const inside = isMember || preview;
  const shownTier = tier || TIERS[0]; // preview → show Diamond

  return (
    <>
      <Head>
        <title>Monshi Club | Mon-Pad</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ position: 'fixed', inset: 0, top: 56, background: '#05030c', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
        {inside ? (
          <>
            <ClubDeck3D stations={STATIONS} onOpen={setPanel} />

            {/* Title */}
            <div style={{ position: 'absolute', top: 14, left: 18, pointerEvents: 'none' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', textShadow: '0 0 16px rgba(139,92,246,0.8)' }}>
                MONSHI <span style={{ color: '#a78bfa' }}>CLUB</span>
                {preview && !isMember && <span style={{ fontSize: 10, fontWeight: 800, color: '#000', background: '#a78bfa', padding: '2px 7px', borderRadius: 999, marginLeft: 8 }}>PREVIEW</span>}
              </div>
              <div style={{ marginTop: 5, fontSize: 12, color: '#9aa4b2' }}>drag to look around · click a station to open it</div>
            </div>

            {/* Member badge */}
            <div style={{ position: 'absolute', top: 14, right: 18, display: 'flex', alignItems: 'center', gap: 10, ...card, padding: '8px 12px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/monshi-chibi.webp" alt="Monshi" width={34} height={34} style={{ borderRadius: 8 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: shownTier.color }}>{shownTier.name} Member</div>
                <div style={{ fontSize: 11, color: '#9aa4b2' }}>{fmtK(balance)} MONSHI held</div>
              </div>
            </div>

            {panel && <Panel k={panel} onClose={() => setPanel(null)} />}
          </>
        ) : (
          // ── GATE ────────────────────────────────────────────────────────────
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 20 }}>
            <div style={{ ...card, width: 'min(420px, 94vw)', padding: 26, textAlign: 'center', color: '#fff', boxShadow: '0 0 50px rgba(139,92,246,0.35)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/monshi-statue.png" alt="Monshi" style={{ height: 160, width: 'auto', margin: '0 auto 8px', filter: 'drop-shadow(0 0 24px rgba(139,92,246,0.7))' }} />
              <div style={{ fontSize: 22, fontWeight: 900 }}>MONSHI <span style={{ color: '#a78bfa' }}>CLUB</span></div>
              <div style={{ fontSize: 13, color: '#c4b5fd', margin: '6px 0 16px' }}>🔒 Members only — hold <b>{fmtK(ENTRY)} MONSHI</b> to enter.</div>

              {!address ? (
                <div style={{ fontSize: 13, color: '#9aa4b2', marginBottom: 14 }}>Connect your wallet (top-right) to check access.</div>
              ) : (
                <div style={{ fontSize: 13, color: '#9aa4b2', marginBottom: 14 }}>
                  You hold <b style={{ color: '#fff' }}>{fmtK(balance)}</b> MONSHI — need {fmtK(ENTRY - balance)} more.
                </div>
              )}

              <Link href={`/swap?from=${ZERO}&to=${MONSHI_TOKEN}`} style={{ display: 'block', background: '#8B5CF6', color: '#fff', textDecoration: 'none', padding: '12px', borderRadius: 10, fontWeight: 800, marginBottom: 10 }}>
                Buy MONSHI →
              </Link>
              <button onClick={() => setPreview(true)} style={{ width: '100%', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.5)', color: '#fff', padding: '11px', borderRadius: 10, cursor: 'pointer', fontWeight: 700 }}>
                👁 Preview inside (demo)
              </button>

              {/* tier ladder */}
              <div style={{ marginTop: 18, fontSize: 12, color: '#9aa4b2' }}>
                {TIERS.slice().reverse().map((t) => (
                  <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: t.color, fontWeight: 700 }}>{t.name}</span><span>{fmtK(t.min)} MONSHI</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <Link href="/" style={{ position: 'absolute', bottom: 16, right: 18, fontSize: 13, fontWeight: 700, color: '#fff', textDecoration: 'none', background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, padding: '8px 14px', zIndex: 60 }}>
          ← Back to Mon-Pad
        </Link>
      </div>
    </>
  );
}

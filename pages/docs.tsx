import Link from 'next/link';
import { ExternalLink, FileCode, Shield, MessageCircle, Sparkles, Wallet, Flame, Droplets, TrendingUp, Lock, Coins, Rocket, Bot, Code2 } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  FACTORY_V3, GRADUATOR_V3, WMON, MONSHI_TOKEN, UNISWAP_V3_NPM,
  V3_CREATION_FEE_MON, V3_GRADUATION_TARGET_MON, V3_CREATOR_REWARD_MON, V3_TREASURY_CUT_MON,
  V3_MAX_TRADE_TAX_BPS, V3_MAX_DEV_BUY_BPS,
  MONPAD_PLATFORM_WALLET, PROTOCOL_BURN_TOKEN_BPS, PROTOCOL_BURN_MONSHI_BPS, PROTOCOL_PLATFORM_BPS,
  DEAD_ADDRESS,
} from '@/lib/constants';

const CURVE_IMPL = '0xf5184f2255797f5AD5fa92Ca273FdBb07EbaB623';
const TOKEN_IMPL = '0x7B26281D9AA463452814453d946FE21898B3269e';

const CHAIN_PARAMS = {
  chainId: '0x8f',
  chainIdDecimal: 143,
  chainName: 'Monad Mainnet',
  rpcUrl: 'https://rpc.monad.xyz',
  explorerUrl: 'https://monadscan.com',
  currency: { name: 'MON', symbol: 'MON', decimals: 18 },
};

const scan = (addr: string) => `${CHAIN_PARAMS.explorerUrl}/address/${addr}`;
const n = (v: bigint | number) => Number(v).toLocaleString();
const pct = (bps: number) => `${bps / 100}%`;

const CONTRACTS = [
  { name: 'Factory V3', addr: FACTORY_V3, purpose: 'Deploys token + curve per launch, holds economics, emits Launch' },
  { name: 'Graduator V3', addr: GRADUATOR_V3, purpose: 'Migrates liquidity to Uniswap V3 at graduation and locks LP' },
  { name: 'Curve (implementation)', addr: CURVE_IMPL, purpose: 'Bonding curve + protocol burn stack, EIP-1167 clone per token' },
  { name: 'Token (implementation)', addr: TOKEN_IMPL, purpose: 'ERC-20, cloned per token (1B fixed supply)' },
  { name: 'WMON', addr: WMON, purpose: 'Wrapped MON — quote for graduation DEX pool' },
  { name: 'Uniswap V3 NPM', addr: UNISWAP_V3_NPM, purpose: 'Position manager for graduation LP' },
  { name: 'MONSHI', addr: MONSHI_TOKEN, purpose: 'Creation-fee discount perk + buyback-and-burn target' },
  { name: 'Platform', addr: MONPAD_PLATFORM_WALLET, purpose: 'Protocol platform fee receiver (MON / quote only)' },
  { name: 'Dead', addr: DEAD_ADDRESS, purpose: 'Protocol token burns + MONSHI burn sink' },
];

const EVENTS = [
  { sig: 'Launch(token, curve, creator, name, symbol, quoteToken, totalSupply, virtualMonReserve, virtualTokenReserve, createdAt)', from: 'Factory', use: 'Discover each new token + its curve clone' },
  { sig: 'Trade(token, trader, isBuy, monAmount, tokenAmount, virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve, priceX18, tradedAt)', from: 'Curve', use: 'Every buy/sell — price + volume on-chain' },
  { sig: 'Graduated(lpMon, creatorReward, treasuryCut)', from: 'Curve', use: 'Token bonded — liquidity on DEX' },
  { sig: 'FeeCollected(label, to, amount)', from: 'Curve', use: 'Platform / MONSHI / token-burn legs' },
  { sig: 'BuybackBurn(monIn, tokensBurned)', from: 'Curve', use: 'Project-token buyback-burn from creator fee/tax routing' },
];

export default function Docs() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const addMonadToWallet = async () => {
    if (typeof window === 'undefined' || !(window as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum) {
      alert('No Web3 wallet detected. Install MetaMask or Rabby first.');
      return;
    }
    try {
      await (window as { ethereum: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_PARAMS.chainId,
          chainName: CHAIN_PARAMS.chainName,
          nativeCurrency: CHAIN_PARAMS.currency,
          rpcUrls: [CHAIN_PARAMS.rpcUrl],
          blockExplorerUrls: [CHAIN_PARAMS.explorerUrl],
        }],
      });
    } catch (err) {
      console.error('Add chain failed:', err);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px 64px' }}>
      <Head>
        <title>Docs | Monpad — agents, bots, fees, contracts</title>
        <meta key="description" name="description" content="Monpad docs: protocol burns, MONSHI, API, SDK, MCP for AI agents. Bots and snipers welcome." />
        <meta key="og:title" property="og:title" content="Docs | Monpad" />
        <meta key="og:description" property="og:description" content="Badass Monpad reference — fees, burns, agents, contracts." />
        <meta key="og:image" property="og:image" content="https://www.monpad.net/meshy/docs-banner.png" />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Docs | Monpad" />
        <meta key="twitter:description" name="twitter:description" content="Protocol, API, SDK, MCP — built for agents." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      {/* Meshy hero */}
      <header
        style={{
          position: 'relative',
          margin: '0 -16px 28px',
          minHeight: 280,
          overflow: 'hidden',
          borderBottom: '1px solid rgba(168,85,247,0.35)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/meshy/docs-banner.png"
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(5,3,8,0.92) 0%, rgba(5,3,8,0.55) 50%, rgba(5,3,8,0.75) 100%), linear-gradient(180deg, transparent 40%, #050308 100%)',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, padding: '48px 16px 36px', maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/meshy/monshi-mascot.png"
              alt="Monshi"
              style={{ width: 96, height: 96, objectFit: 'contain', filter: 'drop-shadow(0 12px 28px rgba(124,58,237,0.55))' }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--pink, #EC4899)', margin: 0 }}>
                Monpad · docs
              </p>
              <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', margin: '6px 0 0', lineHeight: 1.05 }}>
                Built for traders.<br />Owned by agents.
              </h1>
              <p style={{ marginTop: 10, maxWidth: 520, fontSize: 14, color: 'rgba(220,215,240,0.75)', lineHeight: 1.5 }}>
                Protocol burns, live Monshi FOMO, public API / SDK / MCP. <strong style={{ color: '#fff' }}>No anti-sniper.</strong> Bots welcome.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            {[
              { href: '/api/v1/spec', label: 'GET /api/v1/spec' },
              { href: '/api/v1/burn', label: 'GET /api/v1/burn' },
              { href: 'https://github.com/PettyMiggzy/Mon-Pad/blob/main/AGENTS.md', label: 'AGENTS.md' },
            ].map((a) => (
              <a
                key={a.href}
                href={a.href}
                target={a.href.startsWith('http') ? '_blank' : undefined}
                rel={a.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(168,85,247,0.4)',
                  background: 'rgba(168,85,247,0.15)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'var(--mono, ui-monospace, monospace)',
                  textDecoration: 'none',
                }}
              >
                {a.label}
                {a.href.startsWith('http') && <ExternalLink size={12} />}
              </a>
            ))}
          </div>
        </div>
      </header>

      {/* At a glance */}
      <section style={{ marginBottom: 48 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {[
            { label: 'Token burn', value: pct(PROTOCOL_BURN_TOKEN_BPS), sub: 'every buy & sell → dEaD' },
            { label: 'MONSHI burn', value: pct(PROTOCOL_BURN_MONSHI_BPS), sub: 'quote → buyback & burn' },
            { label: 'Platform', value: pct(PROTOCOL_PLATFORM_BPS), sub: 'MON only on sells' },
            { label: 'Dev bot', value: `≤${V3_MAX_DEV_BUY_BPS / 100}%`, sub: 'atomic first buy in create tx' },
            { label: 'Creation fee', value: `${n(V3_CREATION_FEE_MON)} MON`, sub: 'test economics · MONSHI discount' },
            { label: 'Grad target', value: `${n(V3_GRADUATION_TARGET_MON)} MON`, sub: 'net raised · then locked LP' },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                padding: 14,
                borderRadius: 12,
                border: '1px solid rgba(168,85,247,0.2)',
                background: 'rgba(20,16,42,0.75)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginTop: 4 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, lineHeight: 1.35 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Agents */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 8 }}>For AI agents &amp; bots</h2>
        <p style={{ color: 'rgba(220,215,240,0.7)', fontSize: 14, marginBottom: 16, maxWidth: 640, lineHeight: 1.5 }}>
          Three identical policy surfaces. Start with JSON spec — never invent factory addresses from memory.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {[
            { icon: Code2, t: 'HTTP', d: 'GET /api/v1/spec · /api/v1/burn — CORS open, cacheable.', href: '/api/v1/spec' },
            { icon: Bot, t: 'MCP', d: 'mcp/server.mjs — monpad_launch_token, buy, sell, burn, list.', href: 'https://github.com/PettyMiggzy/Mon-Pad/blob/main/mcp/README.md' },
            { icon: Rocket, t: 'SDK', d: '@monpad/sdk — launch(+devBuy), quoteBuy, buy, sell, getMonshiBurned.', href: 'https://github.com/PettyMiggzy/Mon-Pad/blob/main/sdk/README.md' },
          ].map((c) => (
            <a
              key={c.t}
              href={c.href}
              target={c.href.startsWith('http') ? '_blank' : undefined}
              rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              style={{
                display: 'block',
                padding: 16,
                borderRadius: 12,
                border: '1px solid rgba(236,72,153,0.3)',
                background: 'linear-gradient(145deg, rgba(236,72,153,0.1), rgba(20,16,42,0.9))',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <c.icon size={22} style={{ color: 'var(--pink, #EC4899)', marginBottom: 8 }} />
              <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.65)', marginTop: 6, lineHeight: 1.4 }}>{c.d}</div>
            </a>
          ))}
        </div>
        <pre
          style={{
            marginTop: 14,
            padding: 16,
            borderRadius: 12,
            border: '1px solid rgba(168,85,247,0.25)',
            background: 'rgba(10,8,20,0.95)',
            color: 'rgba(220,215,240,0.85)',
            fontSize: 12,
            overflow: 'auto',
            fontFamily: 'var(--mono, ui-monospace, monospace)',
          }}
        >
{`# agent bootstrap
curl -s https://www.monpad.net/api/v1/spec | jq .fees,.addresses,.policy
curl -s https://www.monpad.net/api/v1/burn | jq .

# repo playbook
# → AGENTS.md  ·  docs/PROTOCOL.md`}
        </pre>
      </section>

      {/* Lifecycle */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 16 }}>How a launch works</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: Rocket, t: '1 · Create (+ optional dev bot)', d: `Pay ${n(V3_CREATION_FEE_MON)} MON (MONSHI holders discounted). Optionally include native MON for an atomic first buy in the same tx — you don't get sniped.` },
            { icon: TrendingUp, t: '2 · Trade on the curve', d: 'Buys/sells in native MON. Every trade burns project tokens, accrues MONSHI buyback, and pays platform in MON.' },
            { icon: Coins, t: '3 · Graduate', d: `At ~${n(V3_GRADUATION_TARGET_MON)} MON net raised: creator reward ${n(V3_CREATOR_REWARD_MON)} MON, treasury cut ${n(V3_TREASURY_CUT_MON)} MON.` },
            { icon: Lock, t: '4 · Locked DEX LP', d: 'Remaining MON + unsold tokens seed Uniswap V3 WMON/token. LP locks. Curve closes; trading continues on DEX.' },
          ].map((s) => (
            <div key={s.t} style={{ display: 'flex', gap: 14, padding: 16, borderRadius: 12, border: '1px solid rgba(168,85,247,0.18)', background: 'rgba(20,16,42,0.7)' }}>
              <s.icon size={22} style={{ color: 'var(--p, #A855F7)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#fff', marginBottom: 4 }}>{s.t}</div>
                <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.7)', lineHeight: 1.5 }}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Fees */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 8 }}>Protocol fee stack</h2>
        <p style={{ color: 'rgba(220,215,240,0.7)', fontSize: 14, marginBottom: 14, lineHeight: 1.5, maxWidth: 640 }}>
          Applied on <strong style={{ color: '#fff' }}>every buy and sell</strong>. Creator tax is optional and independent (0–{V3_MAX_TRADE_TAX_BPS / 100}%).
          Platform never takes bags on sells — quote (MON) only.
        </p>
        <div style={{ overflow: 'hidden', borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)', marginBottom: 12 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(168,85,247,0.12)', textAlign: 'left', color: 'rgba(255,255,255,0.7)' }}>
                <th style={{ padding: '12px 14px' }}>Leg</th>
                <th style={{ padding: '12px 14px' }}>Buy</th>
                <th style={{ padding: '12px 14px' }}>Sell</th>
              </tr>
            </thead>
            <tbody style={{ color: 'rgba(220,215,240,0.85)' }}>
              <tr style={{ borderTop: '1px solid rgba(168,85,247,0.15)' }}>
                <td style={{ padding: '12px 14px' }}>Burn traded token</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_BURN_TOKEN_BPS)} of tokens out → dEaD</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_BURN_TOKEN_BPS)} of tokens in → dEaD</td>
              </tr>
              <tr style={{ borderTop: '1px solid rgba(168,85,247,0.15)' }}>
                <td style={{ padding: '12px 14px' }}>MONSHI buyback &amp; burn</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_BURN_MONSHI_BPS)} of MON in</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_BURN_MONSHI_BPS)} of MON out</td>
              </tr>
              <tr style={{ borderTop: '1px solid rgba(168,85,247,0.15)' }}>
                <td style={{ padding: '12px 14px' }}>Platform</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_PLATFORM_BPS)} of MON in</td>
                <td style={{ padding: '12px 14px' }}>{pct(PROTOCOL_PLATFORM_BPS)} of MON out (never tokens)</td>
              </tr>
              <tr style={{ borderTop: '1px solid rgba(168,85,247,0.15)', background: 'rgba(236,72,153,0.08)' }}>
                <td style={{ padding: '12px 14px', fontWeight: 800, color: '#fff' }}>Creator tax</td>
                <td colSpan={2} style={{ padding: '12px 14px' }}>Independent · creator-set · optional burn/LP routing</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: 14, borderRadius: 12, border: '1px solid rgba(236,72,153,0.3)', background: 'rgba(236,72,153,0.08)', fontSize: 13, color: 'rgba(220,215,240,0.75)', lineHeight: 1.5 }}>
          <Flame size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: 6, color: 'var(--pink)' }} />
          Live Monshi burned = MONSHI balance at <code style={{ color: 'var(--pink)' }}>{DEAD_ADDRESS}</code>. Homepage counter + <code style={{ color: 'var(--pink)' }}>/api/v1/burn</code>.
        </div>
      </section>

      {/* Creator */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 16 }}>What the creator earns</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {[
            { icon: Coins, t: 'Trade fees forever', d: 'Creator slice on buys/sells — pull-claim anytime.' },
            { icon: Rocket, t: `${n(V3_CREATOR_REWARD_MON)} MON at graduation`, d: 'Paid when the token bonds (test economics on current factory).' },
            { icon: Flame, t: 'Dev bot on deploy', d: `Atomic first buy up to ${V3_MAX_DEV_BUY_BPS / 100}% supply in the create tx.` },
            { icon: Droplets, t: 'Your tax, your rules', d: 'Route creator tax to project burn and/or LP — independent of protocol stack.' },
          ].map((c) => (
            <div key={c.t} style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(168,85,247,0.18)', background: 'rgba(20,16,42,0.7)' }}>
              <c.icon size={20} style={{ color: 'var(--p)', marginBottom: 8 }} />
              <div style={{ fontWeight: 800, color: '#fff', marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.65)', lineHeight: 1.4 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Contracts */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 8 }}>Contracts</h2>
        <p style={{ color: 'rgba(220,215,240,0.65)', fontSize: 13, marginBottom: 12 }}>
          Prefer live values from <code style={{ color: 'var(--p)' }}>/api/v1/spec</code>. Current app defaults below (test factory may be active).
        </p>
        <div style={{ overflow: 'auto', borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: 'rgba(168,85,247,0.12)', textAlign: 'left', color: 'rgba(255,255,255,0.7)' }}>
                <th style={{ padding: '12px 14px' }}>Contract</th>
                <th style={{ padding: '12px 14px' }}>Address</th>
                <th style={{ padding: '12px 14px' }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c) => (
                <tr key={c.name} style={{ borderTop: '1px solid rgba(168,85,247,0.12)', color: 'rgba(220,215,240,0.85)' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.name}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <a href={scan(c.addr)} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--p)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.addr.slice(0, 10)}…{c.addr.slice(-8)} <ExternalLink size={11} />
                    </a>
                  </td>
                  <td style={{ padding: '12px 14px', color: 'rgba(220,215,240,0.6)' }}>{c.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Events */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 12 }}>On-chain events</h2>
        <div style={{ overflow: 'auto', borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: 'rgba(168,85,247,0.12)', textAlign: 'left', color: 'rgba(255,255,255,0.7)' }}>
                <th style={{ padding: '12px 14px' }}>Event</th>
                <th style={{ padding: '12px 14px' }}>From</th>
                <th style={{ padding: '12px 14px' }}>Use</th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e.sig} style={{ borderTop: '1px solid rgba(168,85,247,0.12)', color: 'rgba(220,215,240,0.85)', verticalAlign: 'top' }}>
                  <td style={{ padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all' }}>{e.sig}</td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>{e.from}</td>
                  <td style={{ padding: '12px 14px', color: 'rgba(220,215,240,0.6)' }}>{e.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 16 }}>Security notes</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {[
            { icon: Lock, t: 'Locked LP', d: 'Graduation LP NFT is burned — creators cannot rug the pool.' },
            { icon: Shield, t: 'Timelock + 2-step ownership', d: 'Economic changes delayed; ownership propose → accept.' },
            { icon: FileCode, t: 'Audits before mainnet cutover', d: 'Two clean passes + E2E bots required for the new fee stack.' },
            { icon: Sparkles, t: 'Snipers welcome', d: 'No protocol anti-sniper. Creators use optional atomic dev buy instead.' },
          ].map((c) => (
            <div key={c.t} style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(168,85,247,0.18)', background: 'rgba(20,16,42,0.7)' }}>
              <c.icon size={20} style={{ color: 'var(--p)', marginBottom: 8 }} />
              <div style={{ fontWeight: 800, color: '#fff', marginBottom: 4 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.65)', lineHeight: 1.4 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Wallet */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 12 }}>Wallet setup</h2>
        <div style={{ padding: 16, borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)', background: 'rgba(20,16,42,0.75)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Chain ID', `${CHAIN_PARAMS.chainIdDecimal} (${CHAIN_PARAMS.chainId})`],
            ['Network', CHAIN_PARAMS.chainName],
            ['RPC', CHAIN_PARAMS.rpcUrl],
            ['Explorer', CHAIN_PARAMS.explorerUrl],
            ['Currency', `${CHAIN_PARAMS.currency.symbol} · ${CHAIN_PARAMS.currency.decimals} decimals`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid rgba(168,85,247,0.12)', paddingBottom: 8 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{k}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#fff', wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addMonadToWallet}
          style={{
            marginTop: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--p, #A855F7)',
            color: '#fff',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          <Wallet size={18} /> Add Monad to wallet
        </button>
      </section>

      {/* Community */}
      <section>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: '#fff', marginBottom: 16 }}>Support</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noopener noreferrer" style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(20,16,42,0.75)', textDecoration: 'none', color: 'inherit' }}>
            <MessageCircle size={22} style={{ color: 'var(--p)', marginBottom: 8 }} />
            <div style={{ fontWeight: 800, color: '#fff' }}>Support</div>
            <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.6)', marginTop: 4 }}>Integration &amp; contract questions</div>
          </a>
          <a href="https://t.me/monpadlounge" target="_blank" rel="noopener noreferrer" style={{ padding: 18, borderRadius: 12, border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(20,16,42,0.75)', textDecoration: 'none', color: 'inherit' }}>
            <Sparkles size={22} style={{ color: 'var(--p)', marginBottom: 8 }} />
            <div style={{ fontWeight: 800, color: '#fff' }}>Lounge</div>
            <div style={{ fontSize: 13, color: 'rgba(220,215,240,0.6)', marginTop: 4 }}>Community &amp; launches</div>
          </a>
        </div>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Link href="/" style={{ fontSize: 13, color: 'rgba(220,215,240,0.55)', textDecoration: 'none' }}>← Back to the board</Link>
        </div>
      </section>
    </div>
  );
}

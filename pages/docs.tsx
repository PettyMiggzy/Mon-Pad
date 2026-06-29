import Link from 'next/link';
import { ExternalLink, FileCode, Shield, MessageCircle, Sparkles, Wallet, Flame, Droplets, TrendingUp, Lock, Coins, Rocket } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  FACTORY_V3, GRADUATOR_V3, WMON, MONSHI_TOKEN, UNISWAP_V3_NPM,
  V3_CREATION_FEE_MON, V3_GRADUATION_TARGET_MON, V3_CREATOR_REWARD_MON, V3_TREASURY_CUT_MON,
  V3_MAX_TRADE_TAX_BPS, V3_MAX_DEV_BUY_BPS,
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

const CONTRACTS = [
  { name: 'Factory V3', addr: FACTORY_V3, purpose: 'Deploys a token + curve per launch, holds economics, emits Launch' },
  { name: 'Graduator V3', addr: GRADUATOR_V3, purpose: 'Migrates liquidity to a Uniswap V3 pool at graduation and burns the LP NFT' },
  { name: 'Curve (implementation)', addr: CURVE_IMPL, purpose: 'Bonding-curve logic, cloned (EIP-1167) per token, emits Trade' },
  { name: 'Token (implementation)', addr: TOKEN_IMPL, purpose: 'ERC-20, cloned per token (1B fixed supply)' },
  { name: 'WMON', addr: WMON, purpose: 'Wrapped MON — quote token for the graduation DEX pool' },
  { name: 'Uniswap V3 NPM', addr: UNISWAP_V3_NPM, purpose: 'Position manager used to seed + lock graduation liquidity' },
  { name: 'MONSHI', addr: MONSHI_TOKEN, purpose: 'Holder discount on creation fee + buyback-and-burn target' },
];

const EVENTS = [
  { sig: 'Launch(token, curve, creator, name, symbol, quoteToken, totalSupply, virtualMonReserve, virtualTokenReserve, createdAt)', from: 'Factory', use: 'Discover each new token + its curve clone' },
  { sig: 'Trade(token, trader, isBuy, monAmount, tokenAmount, virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve, priceX18, tradedAt)', from: 'Curve', use: 'Every buy/sell — price + volume fully derivable on-chain' },
  { sig: 'Graduated(lpMon, creatorReward, treasuryCut)', from: 'Curve', use: 'Token bonded — liquidity migrated to the DEX pool' },
  { sig: 'BuybackBurn(monIn, tokensBurned)', from: 'Curve', use: 'Buyback-and-burn of the project token executed' },
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
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Head>
        <title>Docs | Mon-Pad</title>
        <meta key="description" name="description" content="Mon-Pad documentation: full tokenomics, fees, bonding-curve math, graduation, buyback/burn, deployed contracts, and on-chain integration on Monad." />
        <meta key="og:title" property="og:title" content="Docs | Mon-Pad" />
        <meta key="og:description" property="og:description" content="Full Mon-Pad reference: economics, fees, curve math, graduation, contracts." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Docs | Mon-Pad" />
        <meta key="twitter:description" name="twitter:description" content="Full Mon-Pad reference." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      {/* Hero */}
      <header className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Mon-Pad Documentation</h1>
        <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          The complete reference: economics, fees, the bonding curve, graduation, buyback &amp; burn,
          deployed contracts, and on-chain integration. Native <span className="text-white">MON</span> on
          Monad mainnet (chainId 143).
        </p>
        <p className="text-xs text-white/40 mt-3">USD figures are approximate (shown at ~$0.02/MON) and move with the MON price.</p>
      </header>

      {/* At a glance */}
      <section className="mb-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Creation fee', value: `${n(V3_CREATION_FEE_MON)} MON`, sub: '≈ $10 · 50% off for MONSHI holders' },
            { label: 'Graduation target', value: `${n(V3_GRADUATION_TARGET_MON)} MON`, sub: '≈ $5,000 raised (net of fees)' },
            { label: 'Creator reward', value: `${n(V3_CREATOR_REWARD_MON)} MON`, sub: '≈ $800 paid at graduation' },
            { label: 'Total supply', value: '1,000,000,000', sub: 'Fixed at mint · 18 decimals' },
          ].map((c) => (
            <div key={c.label} className="bg-card border border-border rounded-2xl p-4">
              <div className="text-[11px] text-white/50 uppercase tracking-wide mb-1">{c.label}</div>
              <div className="text-lg md:text-xl font-bold text-white leading-tight">{c.value}</div>
              <div className="text-[11px] text-white/50 mt-1 leading-snug">{c.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Lifecycle */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">How a launch works</h2>
        <div className="space-y-3">
          {[
            { icon: Rocket, t: '1 · Create', d: `Pay ${n(V3_CREATION_FEE_MON)} MON (MONSHI holders pay half). 100 MON is seeded straight into your curve as real exit-liquidity buffer; the rest accrues to the treasury. A fresh ERC-20 + bonding-curve clone are deployed and a Launch event fires.` },
            { icon: TrendingUp, t: '2 · Trade on the curve', d: 'Anyone buys/sells against the constant-product curve in native MON. Price rises as supply sells. No listing, no LP to seed — the curve is the market until graduation.' },
            { icon: Coins, t: '3 · Graduate', d: `Once ~${n(V3_GRADUATION_TARGET_MON)} MON (net) has been raised, the token bonds: the creator is paid ${n(V3_CREATOR_REWARD_MON)} MON (≈$800), the treasury takes ${n(V3_TREASURY_CUT_MON)} MON (≈$200).` },
            { icon: Lock, t: '4 · DEX + locked liquidity', d: 'All remaining raised MON + every unsold token seed a Uniswap V3 WMON/token pool, and the LP NFT is burned — liquidity is locked forever. The curve closes; trading continues on the DEX.' },
          ].map((s) => (
            <div key={s.t} className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4">
              <s.icon className="text-brand-purple flex-shrink-0 mt-0.5" size={24} />
              <div>
                <h3 className="text-base font-semibold text-white mb-1">{s.t}</h3>
                <p className="text-sm text-white/70 leading-relaxed">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tokenomics */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Supply &amp; distribution</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          The <strong className="text-white">entire 1,000,000,000 supply sits on the bonding curve</strong> — there is no
          pre-mine or team allocation. Tokens sell along the curve until the graduation target is hit; whatever is still
          unsold at that moment (plus all raised MON) becomes the locked DEX liquidity. The split isn&apos;t a fixed
          percentage — it falls out of the curve math, landing at roughly <strong className="text-white">~74% sold / ~26% to LP</strong>,
          so the DEX opens at about the curve&apos;s final price (no graduation pump-and-dump gap).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">On the curve</div>
            <div className="text-2xl font-bold text-white">100%</div>
            <div className="text-xs text-white/50 mt-1">All 1B starts on the curve, sold for native MON</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Sold by graduation</div>
            <div className="text-2xl font-bold text-white">~74.5%</div>
            <div className="text-xs text-white/50 mt-1">~745M tokens bought along the way</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Into locked LP</div>
            <div className="text-2xl font-bold text-white">~25.5%</div>
            <div className="text-xs text-white/50 mt-1">~255M unsold tokens seed the DEX pool, LP burned</div>
          </div>
        </div>
      </section>

      {/* Fees */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Fees &amp; taxes</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Every trade pays a fixed <strong className="text-white">2% base fee</strong>. On top of that, a creator can add an
          optional per-trade <strong className="text-white">tax (0–{V3_MAX_TRADE_TAX_BPS / 100}%)</strong> that funds their own
          token&apos;s buyback/burn and LP. The tax stacks on the base fee — it is not part of it.
        </p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Base fee (always)</th>
                <th className="px-4 py-3 font-semibold">Buy</th>
                <th className="px-4 py-3 font-semibold">Sell</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              <tr className="border-t border-border"><td className="px-4 py-3">Creator</td><td className="px-4 py-3">1%</td><td className="px-4 py-3">0.5%</td></tr>
              <tr className="border-t border-border"><td className="px-4 py-3">Platform</td><td className="px-4 py-3">1% (buffer)</td><td className="px-4 py-3">1%</td></tr>
              <tr className="border-t border-border"><td className="px-4 py-3">MONSHI buyback &amp; burn</td><td className="px-4 py-3">—</td><td className="px-4 py-3">0.5%</td></tr>
              <tr className="border-t border-border bg-white/5"><td className="px-4 py-3 font-semibold text-white">Total base</td><td className="px-4 py-3 font-semibold text-white">2%</td><td className="px-4 py-3 font-semibold text-white">2%</td></tr>
            </tbody>
          </table>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-base font-semibold text-white mb-2">Optional creator tax (0–{V3_MAX_TRADE_TAX_BPS / 100}%)</h3>
          <p className="text-sm text-white/70 leading-relaxed">
            Charged on top of the 2% base, on both buys and sells, and routed to your token&apos;s
            <strong className="text-white"> buyback &amp; burn</strong> and/or <strong className="text-white">graduation LP</strong>.
            The first 2% of tax is yours in full; on any tax <strong className="text-white">above 2%</strong>, 25% of that excess
            is skimmed to <strong className="text-white">buy &amp; burn MONSHI</strong>. Example — a 5% tax (3% burn / 2% LP) on a
            100 MON buy: 2 MON base + 5 MON tax (93 MON buys tokens); of the 5 MON tax, 0.75 → MONSHI, ~2.55 → buyback-burn,
            ~1.70 → LP. Total cost to the trader: 7%.
          </p>
        </div>
      </section>

      {/* Creator earnings */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">What the creator earns</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <Coins className="text-brand-purple mb-2" size={24} />
            <h3 className="text-base font-semibold text-white mb-1">Trade fees, forever</h3>
            <p className="text-sm text-white/70 leading-relaxed">You earn the creator slice of every buy (1%) and sell (0.5%) — on the curve and after graduation. Claimable any time (pull-pattern, so a non-receiving wallet can never brick trading).</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <Rocket className="text-brand-purple mb-2" size={24} />
            <h3 className="text-base font-semibold text-white mb-1">{n(V3_CREATOR_REWARD_MON)} MON at graduation</h3>
            <p className="text-sm text-white/70 leading-relaxed">≈ $800 paid straight to you the moment your token bonds — on top of the fees you&apos;ve already collected.</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <Flame className="text-brand-purple mb-2" size={24} />
            <h3 className="text-base font-semibold text-white mb-1">Buyback &amp; burn</h3>
            <p className="text-sm text-white/70 leading-relaxed">Route your dev fee and/or per-trade tax to automatically buy your token off its own curve and send it to the dead address — permanent, on-chain supply reduction (tracked as <code className="text-brand-purple">totalBurnedTokens</code>).</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <Droplets className="text-brand-purple mb-2" size={24} />
            <h3 className="text-base font-semibold text-white mb-1">Add to LP</h3>
            <p className="text-sm text-white/70 leading-relaxed">Reserve part of your fee/tax to deepen the graduation liquidity pool — stronger floor, more trust.</p>
          </div>
        </div>
        <p className="text-sm text-white/60 leading-relaxed mt-4">
          <strong className="text-white">Dev buy (optional):</strong> at launch you can buy up to {V3_MAX_DEV_BUY_BPS / 100}% of
          supply <em>fee-free</em> to seed your own position. All of these are editable by the creator after launch.
        </p>
      </section>

      {/* Curve math */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Bonding-curve math</h2>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          Constant-product (x·y=k) with virtual reserves, calibrated nad.fun-style so early buyers can&apos;t scoop the
          supply at near-zero cost:
        </p>
        <pre className="bg-card border border-border rounded-2xl p-5 text-sm text-white/80 overflow-x-auto font-mono">
{`k = (virtualMON + realMON) · effectiveTokenReserve

buy(ΔMON):  tokensOut = effTok − k / (virtualMON + realMON + ΔMON_net)
sell(ΔTOK): monOut    = (virtualMON + realMON) − k / (effTok + ΔTOK)

virtualMON          = ${n(V3_GRADUATION_TARGET_MON)} · 9/13 = 180,000 MON
virtualToken        = 1,260,000,000
totalSupply         = 1,000,000,000      (entire supply on the curve)
realMON (at launch) = 100 MON            (creation-fee buffer = instant exit liquidity)
graduationTarget    = ${n(V3_GRADUATION_TARGET_MON)} MON net of fees`}
        </pre>
        <p className="text-sm text-white/60 leading-relaxed mt-4">
          <code className="text-brand-purple">priceX18</code> and post-trade reserves are emitted on every <code className="text-brand-purple">Trade</code>,
          so price/marketcap are 100% on-chain derivable with no oracle. The flat 180,000 MON virtual reserve keeps the first
          ~$100 of buys to a small share of supply and opens the DEX at ≈ the curve&apos;s final price.
        </p>
      </section>

      {/* MONSHI */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">MONSHI integration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-base font-semibold text-white mb-1">Holder discount</h3>
            <p className="text-sm text-white/70 leading-relaxed">Hold ≥ 1,000,000 MONSHI and your creation fee is cut 50% (250 MON instead of 500). Read live on-chain via <code className="text-brand-purple">creationFeeFor(address)</code>.</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-base font-semibold text-white mb-1">Buyback &amp; burn</h3>
            <p className="text-sm text-white/70 leading-relaxed">0.5% of every sell, plus 25% of any creator tax above 2%, accrues to buy &amp; burn MONSHI — every launch on the pad feeds the MONSHI ecosystem.</p>
          </div>
        </div>
      </section>

      {/* Deployed contracts */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Deployed contracts</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Live on Monad mainnet (chainId 143), source-verified. Per-token curve + token contracts are EIP-1167 minimal-proxy
          clones of the implementations below.
        </p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Contract</th>
                <th className="px-4 py-3 font-semibold">Address</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {CONTRACTS.map((c) => (
                <tr key={c.name} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="px-4 py-3">
                    <a href={scan(c.addr)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-brand-purple inline-flex items-center gap-1 break-all">
                      {c.addr.slice(0, 10)}…{c.addr.slice(-8)} <ExternalLink size={11} />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-white/70">{c.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* On-chain integration */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">On-chain integration</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          There is <strong className="text-white">no required indexer or API</strong> — the app reads everything directly from
          chain. For your own tooling (bots, scanners, DexScreener-style charts), watch these events:
        </p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-4 py-3 font-semibold">From</th>
                <th className="px-4 py-3 font-semibold">Use</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {EVENTS.map((e) => (
                <tr key={e.sig} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-mono text-[11px] leading-relaxed break-all">{e.sig}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{e.from}</td>
                  <td className="px-4 py-3 text-white/70">{e.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-base text-white/70 leading-relaxed mb-3">Reading live curve state (wagmi/viem + the ABIs in <code className="px-2 py-1 rounded bg-card border border-border font-mono text-xs text-brand-purple">lib/abis/</code>):</p>
        <pre className="bg-card border border-border rounded-2xl p-5 text-sm text-white/80 overflow-x-auto font-mono">
{`import { listV3Tokens, getV3Trades } from '@/lib/chainV3';

// All launches (newest first) straight from the factory
const tokens = await listV3Tokens(60);

// A token's trade history from its curve's Trade logs (no indexer)
const trades = await getV3Trades(curveAddress);

// Curve reserves / price for a token (read on the curve clone)
//   getCurveReserves() -> (virtualMon, virtualToken, realMon, realToken)
//   priceWeiPerToken(), progressBps(), creationFeeFor(address)`}
        </pre>
      </section>

      {/* Security & governance */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Security &amp; governance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <Lock className="text-brand-purple flex-shrink-0" size={26} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Locked liquidity</h3>
                <p className="text-sm text-white/60 leading-relaxed">At graduation the LP NFT is burned — creators can never withdraw the pool. They only ever earn trading fees.</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <Shield className="text-brand-purple flex-shrink-0" size={26} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Timelock + 2-step ownership</h3>
                <p className="text-sm text-white/60 leading-relaxed">Economic parameters change only through a 24h timelock; ownership transfers are 2-step (propose → accept). Pull-pattern payouts and reentrancy guards throughout.</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <FileCode className="text-brand-purple flex-shrink-0" size={26} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Verified source</h3>
                <p className="text-sm text-white/60 leading-relaxed">All contracts are source-verified on the Monad explorer — read every line from the address table above.</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <Sparkles className="text-brand-purple flex-shrink-0" size={26} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Anti-snipe curve</h3>
                <p className="text-sm text-white/60 leading-relaxed">The 180,000 MON virtual reserve flattens the early curve so the first buyers can&apos;t corner supply cheaply — fairer launches.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Wallet setup */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-white mb-6">Wallet setup</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Add Monad Mainnet to your wallet with the params below, or one-click via your installed provider.
        </p>
        <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <span className="text-white/60 text-sm">Chain ID</span>
            <span className="font-mono text-sm text-white">{CHAIN_PARAMS.chainIdDecimal} ({CHAIN_PARAMS.chainId})</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <span className="text-white/60 text-sm">Network name</span>
            <span className="font-mono text-sm text-white">{CHAIN_PARAMS.chainName}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <span className="text-white/60 text-sm">RPC URL</span>
            <span className="font-mono text-sm text-white break-all">{CHAIN_PARAMS.rpcUrl}</span>
          </div>
          <div className="flex justify-between gap-4 border-b border-border pb-3">
            <span className="text-white/60 text-sm">Block explorer</span>
            <span className="font-mono text-sm text-white break-all">{CHAIN_PARAMS.explorerUrl}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/60 text-sm">Currency</span>
            <span className="font-mono text-sm text-white">{CHAIN_PARAMS.currency.symbol} ({CHAIN_PARAMS.currency.decimals} decimals)</span>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={addMonadToWallet}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-purple hover:bg-brand-purple/90 text-white font-semibold transition-colors"
          >
            <Wallet size={18} /> Add Monad to wallet
          </button>
        </div>
      </section>

      {/* Support & community */}
      <section className="mb-8">
        <h2 className="text-3xl font-bold text-white mb-6">Support &amp; community</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noopener noreferrer" className="bg-card border border-border hover:border-brand-purple/50 rounded-2xl p-6 transition-colors group">
            <div className="flex items-start gap-4">
              <MessageCircle className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-brand-purple transition-colors">Support</h3>
                <p className="text-sm text-white/60 leading-relaxed">Technical questions, integration help, contract questions.</p>
                <div className="text-xs text-brand-purple mt-2 inline-flex items-center gap-1">t.me/MonshiUtilitySupport <ExternalLink size={12} /></div>
              </div>
            </div>
          </a>
          <a href="https://t.me/monpadlounge" target="_blank" rel="noopener noreferrer" className="bg-card border border-border hover:border-brand-purple/50 rounded-2xl p-6 transition-colors group">
            <div className="flex items-start gap-4">
              <Sparkles className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-brand-purple transition-colors">Lounge</h3>
                <p className="text-sm text-white/60 leading-relaxed">Community chat, launch discussion, general talk.</p>
                <div className="text-xs text-brand-purple mt-2 inline-flex items-center gap-1">t.me/monpadlounge <ExternalLink size={12} /></div>
              </div>
            </div>
          </a>
        </div>
        <div className="mt-6 text-center">
          <Link href="/how-it-works" className="text-sm text-white/60 hover:text-brand-purple transition-colors">← Back to How it works</Link>
        </div>
      </section>
    </div>
  );
}

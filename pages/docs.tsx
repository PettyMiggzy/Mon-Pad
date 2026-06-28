import Link from 'next/link';
import { ExternalLink, FileCode, Shield, MessageCircle, Sparkles, Wallet } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const CHAIN_PARAMS = {
  chainId: '0x8f',
  chainIdDecimal: 143,
  chainName: 'Monad Mainnet',
  rpcUrl: 'https://rpc.monad.xyz',
  explorerUrl: 'https://monadscan.com',
  currency: { name: 'MON', symbol: 'MON', decimals: 18 },
};

const CONTRACTS = [
  { name: 'Factory V2', envVar: 'NEXT_PUBLIC_FACTORY_V2', purpose: 'Deploys new token + curve pairs' },
  { name: 'Curve template', envVar: 'NEXT_PUBLIC_CURVE_TEMPLATE', purpose: 'Bonding curve logic, cloned per token' },
  { name: 'Staking', envVar: 'NEXT_PUBLIC_STAKING', purpose: 'Lock-based reward distribution' },
  { name: 'Treasury wallet', envVar: 'NEXT_PUBLIC_TREASURY_WALLET', purpose: 'Receives platform fees and creation buffer' },
  { name: 'Buyback wallet', envVar: 'NEXT_PUBLIC_BUYBACK_WALLET', purpose: 'MONSHI buyback execution' },
  { name: 'Platform wallet', envVar: 'NEXT_PUBLIC_PLATFORM_WALLET', purpose: 'Operational expenses' },
];

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/tokens', purpose: 'List tokens (filter/sort/paginate)' },
  { method: 'GET', path: '/api/tokens/:address', purpose: 'Token detail + curve state' },
  { method: 'GET', path: '/api/tokens/:address/trades', purpose: 'Recent trades for a token' },
  { method: 'GET', path: '/api/tokens/:address/holders', purpose: 'Holder list with balances' },
  { method: 'GET', path: '/api/stats', purpose: 'Global platform stats (volume, count)' },
  { method: 'GET', path: '/api/ticker', purpose: 'Live ticker payload (recent trades, top gainers)' },
  { method: 'GET', path: '/api/health', purpose: 'Indexer health and chain head' },
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
      {/* Hero */}
      <header className="text-center mb-16">
        <Head>
        <title>Docs | Mon-Pad</title>
        <meta key="description" name="description" content="Mon-Pad developer docs: contract addresses, ABIs, integration guides, and API reference for builders on Monad." />
        <meta key="og:title" property="og:title" content="Docs | Mon-Pad" />
        <meta key="og:description" property="og:description" content="Mon-Pad developer docs: contracts, ABIs, integration guides." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Docs | Mon-Pad" />
        <meta key="twitter:description" name="twitter:description" content="Mon-Pad developer docs." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Mon-Pad Documentation</h1>
        <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          Contracts, APIs, and integration details for developers and serious traders.
        </p>
      </header>

      {/* Section 1: Deployed Contracts */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Deployed contracts</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Addresses are env-driven and rendered live from the public build. Source on GitHub.
        </p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Contract</th>
                <th className="px-4 py-3 font-semibold">Env var</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {CONTRACTS.map((c) => (
                <tr key={c.envVar} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-purple">{c.envVar}</td>
                  <td className="px-4 py-3 text-white/70">{c.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Tokenomics */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Tokenomics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Total supply</div>
            <div className="text-2xl font-bold text-white">1,000,000,000</div>
            <div className="text-xs text-white/50 mt-1">Fixed at mint, no further issuance</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Curve allocation</div>
            <div className="text-2xl font-bold text-white">800,000,000</div>
            <div className="text-xs text-white/50 mt-1">80% sold via bonding curve</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Graduation LP</div>
            <div className="text-2xl font-bold text-white">200,000,000</div>
            <div className="text-xs text-white/50 mt-1">20% reserved for Uniswap V3 LP, locked permanently</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Decimals</div>
            <div className="text-2xl font-bold text-white">18</div>
            <div className="text-xs text-white/50 mt-1">ERC-20 standard</div>
          </div>
        </div>
      </section>

      {/* Section 3: Curve Math */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Curve math</h2>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          The bonding curve uses constant-product math with virtual reserves:
        </p>
        <pre className="bg-card border border-border rounded-2xl p-5 text-sm text-white/80 overflow-x-auto font-mono">
{`(virtualMON + realMON) * tokenReserve = k

buyPrice(ΔMON) = tokenReserve - k / (virtualMON + realMON + ΔMON)
sellPrice(ΔTOK) = (virtualMON + realMON) - k / (tokenReserve + ΔTOK)

virtualMON = 180,000 MON  (anti-snipe; gradTarget * 9/13)
virtualToken = 1,260,000,000
tokenSupply = 1,000,000,000  (entire supply on the curve)
graduationTarget = 260,000 MON net of fees  (~$5,000)`}
        </pre>
        <p className="text-sm text-white/60 leading-relaxed mt-4">
          Virtual reserves mean the first buyer doesn&apos;t get the whole supply at near-zero cost. The curve starts at a realistic price and rises smoothly toward graduation.
        </p>
      </section>

      {/* Section 4: API Endpoints */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">API endpoints</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Indexer base URL: <code className="px-2 py-1 rounded bg-card border border-border font-mono text-xs text-brand-purple">NEXT_PUBLIC_API_BASE</code>
        </p>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 font-semibold">Endpoint</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              {API_ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs text-brand-purple">{e.method}</td>
                  <td className="px-4 py-3 font-mono text-xs">{e.path}</td>
                  <td className="px-4 py-3 text-white/70">{e.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5: Frontend Integration */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Frontend integration</h2>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          Use the typed API client in <code className="px-2 py-1 rounded bg-card border border-border font-mono text-xs text-brand-purple">lib/api.ts</code> for safe, normalized access:
        </p>
        <pre className="bg-card border border-border rounded-2xl p-5 text-sm text-white/80 overflow-x-auto font-mono">
{`import { api } from '@/lib/api';

// List trending tokens
const tokens = await api.listTokens({ limit: 20, sort: 'trending' });

// Get one token + curve state
const detail = await api.getToken(tokenAddress);

// Stream recent trades
const trades = await api.getTrades(tokenAddress, { limit: 50 });`}
        </pre>
        <p className="text-sm text-white/60 leading-relaxed mt-4">
          For on-chain reads (curve state, balances), use wagmi hooks with the ABIs in <code className="px-2 py-1 rounded bg-card border border-border font-mono text-xs text-brand-purple">lib/abis/</code>.
        </p>
      </section>

      {/* Section 6: Wallet Setup */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Wallet setup</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Add Monad Mainnet to your wallet using the params below, or click the button to do it via your installed Web3 provider.
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

      {/* Section 7: Contract Source & Audit */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Contract source &amp; audit</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <FileCode className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Source</h3>
                <p className="text-sm text-white/60 leading-relaxed mb-3">
                  Solidity contracts, deployment scripts, and tests are on GitHub.
                </p>
                {/* TODO: replace with actual repo URL once public */}
                <span className="text-xs text-white/40 italic">Repo link coming with public launch</span>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <Shield className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Audit</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  Reviewed by Claude Code across three rounds. Notes covered curve math, fee accounting, graduation atomicity, and stake-lock semantics.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 8: Support & Community */}
      <section className="mt-16 mb-8">
        <h2 className="text-3xl font-bold text-white mb-6">Support &amp; community</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="https://t.me/MonshiUtilitySupport"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border border-border hover:border-brand-purple/50 rounded-2xl p-6 transition-colors group"
          >
            <div className="flex items-start gap-4">
              <MessageCircle className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-brand-purple transition-colors">Support</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  Technical questions, integration issues, contract help.
                </p>
                <div className="text-xs text-brand-purple mt-2 inline-flex items-center gap-1">t.me/MonshiUtilitySupport <ExternalLink size={12} /></div>
              </div>
            </div>
          </a>
          <a
            href="https://t.me/monpadlounge"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border border-border hover:border-brand-purple/50 rounded-2xl p-6 transition-colors group"
          >
            <div className="flex items-start gap-4">
              <Sparkles className="text-brand-purple flex-shrink-0" size={28} />
              <div>
                <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-brand-purple transition-colors">Lounge</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  Community chat, launch discussions, and general talk.
                </p>
                <div className="text-xs text-brand-purple mt-2 inline-flex items-center gap-1">t.me/monpadlounge <ExternalLink size={12} /></div>
              </div>
            </div>
          </a>
        </div>
        <div className="mt-6 text-center">
          <Link href="/how-it-works" className="text-sm text-white/60 hover:text-brand-purple transition-colors">
            ← Back to How it works
          </Link>
        </div>
      </section>
    </div>
  );
}

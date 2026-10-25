import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { AlertTriangle, Bot, BookOpen, Bug, Coins, FileCode2, Layers, Rocket, Shield, Wallet, Zap } from 'lucide-react';
import { CodeBlock, CopyButton } from '@/components/ui/CopyButton';
import { feePct, LP_FEE_SLICES } from '@/lib/fees';
import { HOOK_V4, LAUNCHER_V4, ROUTER_V4 } from '@/lib/v4/config';
import { MONAD_EXPLORER, MONSHI_TOKEN } from '@/lib/constants';

/* Public documentation. Contract addresses come from the same env the site uses, so this page never drifts from what is live. */

const ZERO = '0x0000000000000000000000000000000000000000';
const CONTRACTS: [string, string, string][] = [
  ['Launcher', LAUNCHER_V4 === ZERO ? '0x2d55391d4170C7cAF9eE53Cf8BAD00748452ec84' : LAUNCHER_V4, 'Launches coins, holds the locked liquidity, splits fees.'],
  ['Hook', HOOK_V4 === ZERO ? '0xaff86Dd6e66df26b971767959e854e12b5f7a080' : HOOK_V4, 'Sets the fee on every swap, inside the pool.'],
  ['Router', ROUTER_V4 === ZERO ? '0xC20A50750a75d2d8FFF47E63003636C3CF0bb18c' : ROUTER_V4, 'Buy and sell with MON or USDC in one transaction.'],
  ['USDC', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', 'The quote asset of every pool.'],
  ['Uniswap V4 PoolManager', '0x188d586ddcf52439676ca21a244753fa19f9ea8e', 'Where the pools live.'],
  ['MONSHI', MONSHI_TOKEN, 'Bought and burned from fees.'],
];

const SECTIONS = [
  { id: 'start', label: 'Start here', icon: Zap },
  { id: 'launch', label: 'How a launch works', icon: Rocket },
  { id: 'fees', label: 'Fees', icon: Coins },
  { id: 'trading', label: 'Trading', icon: Layers },
  { id: 'ai', label: 'Use your AI', icon: Bot },
  { id: 'bots', label: 'Bots & developers', icon: FileCode2 },
  { id: 'contracts', label: 'Contracts', icon: BookOpen },
  { id: 'security', label: 'Security & risks', icon: Shield },
  { id: 'wallet', label: 'Wallet setup', icon: Wallet },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 text-2xl md:text-3xl font-bold text-white mt-14 mb-4">{children}</h2>;
}
const P = ({ children }: { children: React.ReactNode }) => <p className="text-white/75 leading-relaxed mb-4">{children}</p>;
const Ic = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.9em] text-purple-200">{children}</code>;
const Btn = ({ href, children, ghost = false }: { href: string; children: React.ReactNode; ghost?: boolean }) => (
  <Link href={href} className={`inline-flex items-center justify-center rounded-xl px-5 py-3 font-semibold text-white ${ghost ? 'bg-white/10 border border-white/15' : 'bg-purple-600 hover:bg-purple-500'}`}>{children}</Link>
);

function AddMonad() {
  const [msg, setMsg] = useState('');
  async function add() {
    const eth = (window as any).ethereum;
    if (!eth) { setMsg('No wallet found in this browser. Use the values below.'); return; }
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x8f', chainName: 'Monad Mainnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://rpc.monad.xyz'], blockExplorerUrls: [MONAD_EXPLORER] }] });
      setMsg('Monad added.');
    } catch (e: any) { setMsg(e?.code === 4001 ? 'Cancelled.' : 'Your wallet could not add it. Use the values below.'); }
  }
  return (
    <div className="mb-4 flex items-center gap-3 flex-wrap">
      <button type="button" onClick={add} className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-3 font-semibold text-white">Add Monad to my wallet</button>
      {msg && <span className="text-white/70 text-sm">{msg}</span>}
    </div>
  );
}

export default function Docs() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <Head>
        <title>Docs | Monpad</title>
        <meta key="description" name="description" content="How Monpad works: free launches on Uniswap V4 with locked liquidity, pay in MON, fees, trading, AI in one click, bots and contract addresses." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      <header className="mb-8">
        <div className="text-sm text-white/55 mb-2">Documentation</div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">Monpad, explained</h1>
        <p className="text-white/70 max-w-3xl leading-relaxed">Launch a coin, trade it, or plug in your AI. Most things here are one click.</p>
      </header>

      <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/5 p-4 mb-8 flex gap-3">
        <AlertTriangle className="shrink-0 mt-0.5" size={20} />
        <div className="text-white/80 text-sm leading-relaxed">
          <b className="text-white">Status.</b> Live on Monad mainnet. The contracts are verified and were reviewed in-house against a fork of mainnet. They have not had an outside audit yet. Only use money you can afford to lose. See <a href="#security" className="underline">Security &amp; risks</a>.
        </div>
      </div>

      <button className="md:hidden mb-4 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left text-white" onClick={() => setOpen(!open)}>
        {open ? 'Hide sections' : 'Jump to a section'}
      </button>

      <div className="md:grid md:grid-cols-[220px_1fr] md:gap-10">
        <nav className={`${open ? 'block' : 'hidden'} md:block md:sticky md:top-24 md:self-start mb-8 md:mb-0`}>
          <ul className="space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`#${id}`} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white">
                  <Icon size={15} /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <H2 id="start">Start here</H2>
          <P>Monpad is a fair launchpad on Monad. A coin goes straight into a Uniswap V4 pool on the first block. There is no bonding curve, no waiting period and no creation fee. The liquidity is locked from the start.</P>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white mb-1">I want to launch a coin</h3>
              <p className="text-white/65 text-sm mb-3">Name, ticker, picture. One transaction, paid in MON.</p>
              <Btn href="/create">Launch a coin</Btn>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white mb-1">I want to buy or sell</h3>
              <p className="text-white/65 text-sm mb-3">Pay with MON or USDC. We convert for you.</p>
              <Btn href="/#board">See the coins</Btn>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white mb-1">I want to use my AI</h3>
              <p className="text-white/65 text-sm mb-3">Add one link to Claude, ChatGPT, Cursor or VS Code.</p>
              <Btn href="/ai">Connect my AI</Btn>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white mb-1">I need a wallet on Monad</h3>
              <p className="text-white/65 text-sm mb-3">One click adds the network to your wallet.</p>
              <a href="#wallet" className="inline-flex rounded-xl bg-white/10 border border-white/15 px-5 py-3 font-semibold text-white">Set up my wallet</a>
            </div>
          </div>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><b className="text-white">Plain coin.</b> A standard token with a fixed supply of 1 billion. No token tax, no mint, no owner and no blacklist. It works with every wallet and app.</li>
            <li><b className="text-white">Locked liquidity.</b> The launcher holds the pool position and has no way to take it out.</li>
            <li><b className="text-white">Open to bots.</b> No sniper protection, delay or whitelist. Bots and AI agents are welcome.</li>
          </ul>

          <H2 id="launch">How a launch works</H2>
          <P>One transaction does all of this:</P>
          <ol className="list-decimal pl-5 space-y-2 text-white/75 mb-4">
            <li>Creates the token (1 billion supply, all held by the launcher).</li>
            <li>Opens the Uniswap V4 pool, the coin against USDC, with the Monpad hook.</li>
            <li>Puts the whole supply in one single-sided position at the starting price.</li>
            <li>Optionally buys for you first (the <b className="text-white">dev buy</b>), before anyone else can. It is capped at 5% of supply.</li>
          </ol>
          <P>You can pay in MON. The launcher swaps what it needs to USDC inside the same transaction. There is <b className="text-white">no creation fee</b>. You choose a <b className="text-white">creator tax</b> from 0% to 5% at launch. It is fixed forever; see Fees.</P>

          <H2 id="fees">Fees</H2>
          <P>Every swap pays <b className="text-white">1% plus the creator tax</b>, so between 1% and 6%. The hook sets this inside the pool on every swap, so no router or app can skip it.</P>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm text-left border border-white/10 rounded-xl overflow-hidden">
              <thead className="bg-white/5 text-white/80"><tr><th className="p-3">Share of the base 1%</th><th className="p-3">Goes to</th></tr></thead>
              <tbody className="text-white/75 divide-y divide-white/10">
                <tr><td className="p-3">{feePct(LP_FEE_SLICES[0].bps)}</td><td className="p-3">The creator, claimable any time</td></tr>
                <tr><td className="p-3">{feePct(LP_FEE_SLICES[1].bps)}</td><td className="p-3">The platform</td></tr>
                <tr><td className="p-3">{feePct(LP_FEE_SLICES[2].bps)}</td><td className="p-3">Buys and burns MONSHI</td></tr>
                <tr><td className="p-3">{feePct(LP_FEE_SLICES[3].bps)}</td><td className="p-3">Buys and burns the launched coin</td></tr>
              </tbody>
            </table>
          </div>
          <P><b className="text-white">Creator tax.</b> Anything above the base 1% is the creator tax. It is not paid to anyone. All of it buys and burns the coin, so a higher tax means a faster burn.</P>
          <P><b className="text-white">Collecting.</b> The token page has a <Ic>Collect fees</Ic> button that anyone can press. It splits what the pool has earned. Creators then claim their share from the same page.</P>

          <H2 id="trading">Trading</H2>
          <P>Every coin page has a trade box and a chart. Choose <Ic>MON</Ic> or <Ic>USDC</Ic>, type an amount, press Buy. Pick MON and the router converts to USDC and back inside the same transaction.</P>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><b className="text-white">Slippage.</b> The trade box sets a minimum-out from a live quote (default 1%). If the price moves past it, the trade fails and you keep your money.</li>
            <li><b className="text-white">Price impact.</b> The depth panel shows what a trade of each size would cost. New coins start thin on the sell side.</li>
            <li><b className="text-white">Total fee.</b> Shown on the coin page. A creator tax raises it.</li>
            <li><b className="text-white">Gas.</b> Keep a little MON for gas. The Max button leaves some behind.</li>
          </ul>

          <H2 id="ai">Use your AI</H2>
          <P>Add one link and ask in plain English. The AI can look up coins and prepare a buy, sell or launch. It never touches your wallet: it hands you a link and you confirm.</P>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Btn href="/ai">One-click setup</Btn>
            <CopyButton text="https://www.monpad.net/api/mcp" label="Copy connector link" />
          </div>

          <H2 id="bots">Bots &amp; developers</H2>
          <P>Everything is on-chain, so bots can trade without any Monpad service. Pools are Uniswap V4 pools with a dynamic fee and the Monpad hook. Use the router for MON or USDC swaps in one call:</P>
          <CodeBlock>{`buyWithMon(key, minTokensOut, minUsdcOut, deadline, monUsdcLimit, tokenPoolLimit)   // payable
sellToMon(key, tokensIn, minMonOut, minUsdcOut, deadline, tokenLimit, monLimit)
buyWithUsdc(key, usdcIn, minTokensOut, deadline, limit)
sellToUsdc(key, tokensIn, minUsdcOut, deadline, limit)`}</CodeBlock>
          <P><Ic>key</Ic> is the pool key: <Ic>currency0/currency1</Ic> are USDC and the coin, sorted by address; <Ic>fee</Ic> is <Ic>0x800000</Ic> (dynamic); <Ic>tickSpacing</Ic> is <Ic>200</Ic>; <Ic>hooks</Ic> is the hook address below. Pass <Ic>0</Ic> for a price limit to use the default. Always set a real minimum-out.</P>
          <CodeBlock>{`const key = {
  currency0: usdc < token ? usdc : token,
  currency1: usdc < token ? token : usdc,
  fee: 0x800000,
  tickSpacing: 200,
  hooks: HOOK,
};
await wallet.writeContract({
  address: ROUTER, abi, functionName: 'buyWithMon',
  args: [key, minTokensOut, 0n, BigInt(Math.floor(Date.now() / 1000) + 600), 0n, 0n],
  value: parseEther('5'),
});`}</CodeBlock>
          <P>Read the list of coins from the launcher (<Ic>tokenCount</Ic>, <Ic>allTokens(i)</Ic>, <Ic>launches(token)</Ic>) and follow trades with the <Ic>Swap</Ic> event on the PoolManager, filtered by pool id. Public RPCs limit <Ic>eth_getLogs</Ic> to 100 blocks, so use your own node for history. Candles for any coin are at <Ic>/api/v1/candles?pool=&lt;poolId&gt;&amp;tf=5m</Ic>.</P>
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4">
            <div className="p-3"><Ic>GET /api/v1/spec</Ic><div className="text-white/60 text-sm mt-1">Fees, split and contract addresses as JSON.</div></div>
            <div className="p-3"><Ic>GET /api/v1/burn</Ic><div className="text-white/60 text-sm mt-1">Live MONSHI burned.</div></div>
            <div className="p-3"><Ic>GET /api/v1/candles</Ic><div className="text-white/60 text-sm mt-1">Price candles for a pool (1m to 1d).</div></div>
            <div className="p-3"><Ic>POST /api/mcp</Ic><div className="text-white/60 text-sm mt-1">The AI connector (MCP over HTTP).</div></div>
          </div>
          <P>A TypeScript SDK and a self-hosted MCP server for bots with their own wallet are being rebuilt for these contracts. Until they are back, use the router calls above.</P>

          <H2 id="contracts">Contracts</H2>
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4">
            {CONTRACTS.map(([name, addr, body]) => (
              <div key={name} className="p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white font-semibold">{name}</div>
                  <div className="text-white/55 text-sm">{body}</div>
                  <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" className="text-purple-300 text-sm break-all underline">{addr}</a>
                </div>
                <CopyButton text={addr} label="Copy address" />
              </div>
            ))}
          </div>
          <P>The three Monpad contracts are verified on Sourcify, so you can read the source and ABI there.</P>

          <H2 id="security">Security &amp; risks</H2>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><Bug className="inline mr-1" size={14} /><b className="text-white">No outside audit yet.</b> The contracts were tested against a fork of Monad mainnet and reviewed in-house. An independent audit has not been done.</li>
            <li><b className="text-white">Owner powers are small and visible.</b> The owner can pause new launches and change the platform wallet, the MONSHI wallet and the creation fee. The owner cannot touch locked liquidity or anyone&apos;s coins or USDC.</li>
            <li><b className="text-white">USDC can be frozen.</b> USDC is issued by Circle, who can pause it or blacklist an address. If that happens, trades in USDC pools can fail.</li>
            <li><b className="text-white">Fee collection needs a caller.</b> Splits and buybacks run when someone presses Collect fees. Anyone can press it.</li>
            <li><b className="text-white">Protocol fee.</b> Uniswap governance can switch on a protocol fee for pools. That would take a slice before the fee reaches Monpad.</li>
            <li><b className="text-white">Memecoins are risky.</b> Coins can go to zero. Locked liquidity does not protect the price. Nothing here is financial advice.</li>
          </ul>

          <H2 id="wallet">Wallet setup</H2>
          <AddMonad />
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4 text-sm">
            {[['Network name', 'Monad Mainnet'], ['Chain ID', '143'], ['RPC URL', 'https://rpc.monad.xyz'], ['Currency', 'MON'], ['Explorer', 'https://monadscan.com']].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 p-3"><span className="text-white/60">{k}</span><span className="flex items-center gap-3"><span className="text-white break-all text-right">{v}</span><CopyButton text={v} label="Copy" /></span></div>
            ))}
          </div>
          <P>Questions? Ask in the community Telegram. Never share your seed phrase or private key with anyone, including anyone who says they are Monpad support.</P>
        </main>
      </div>
    </div>
  );
}

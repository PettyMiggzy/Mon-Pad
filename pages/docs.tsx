import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { AlertTriangle, Bot, BookOpen, Code2, Coins, Flame, Layers, Lock, MessageCircle, Rocket, Shield, Terminal, Wallet } from 'lucide-react';

/* Public documentation. Deliberately contains no wallet addresses: platform and treasury wallets are
   readable on-chain from the verified contracts, and contract addresses are published here at launch. */

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'launch', label: 'How a launch works', icon: Rocket },
  { id: 'fees', label: 'Fees', icon: Coins },
  { id: 'trading', label: 'Trading', icon: Layers },
  { id: 'chat', label: 'Launch by chat', icon: MessageCircle },
  { id: 'agents', label: 'AI & MCP', icon: Bot },
  { id: 'sdk', label: 'SDK', icon: Code2 },
  { id: 'api', label: 'HTTP API', icon: Terminal },
  { id: 'events', label: 'On-chain data', icon: Flame },
  { id: 'security', label: 'Security & risks', icon: Shield },
  { id: 'wallet', label: 'Wallet setup', icon: Wallet },
];

const MCP_TOOLS: [string, 'read' | 'write', string][] = [
  ['monpad_list_launches', 'read', 'Recent launches, newest first.'],
  ['monpad_get_token', 'read', 'Price in USDC, liquidity, creator tax and approximate volume for one token.'],
  ['monpad_trending', 'read', 'Tokens ranked by swap volume over a recent window.'],
  ['monpad_get_spec', 'read', 'Fee policy, safety limits and contract readiness.'],
  ['monpad_get_monshi_burn', 'read', 'Live MONSHI burn counter.'],
  ['monpad_launch_token', 'write', 'Launch a token. The creation fee and an optional dev buy are paid in USDC. Dry run by default.'],
  ['monpad_buy', 'write', 'Buy with USDC. Requires a minimum-out. Dry run by default.'],
  ['monpad_buy_with_mon', 'write', 'Buy with native MON, swapped to USDC on the way. Requires a minimum-out. Dry run by default.'],
  ['monpad_sell', 'write', 'Sell for USDC. Requires a minimum-out. Dry run by default.'],
  ['monpad_sell_for_mon', 'write', 'Sell for native MON, via USDC. Requires a minimum-out. Dry run by default.'],
];

const SDK_METHODS: [string, string][] = [
  ['createMonpad({ rpcUrl?, walletClient?, addresses?, maxUsdcPerTx?, maxMonPerTx? })', 'Create a client. Read methods need no wallet. Writes need a wallet client. The USDC address is read from the launcher.'],
  ['monpad.listLaunches({ limit })', 'Recent launches with creator, creator tax, pool id, name and symbol.'],
  ['monpad.getToken(token)', 'Price in USDC, liquidity, total swap fee, creator tax and approximate USDC volume for one token.'],
  ['monpad.quoteBuy(token, usdcIn)', 'Simulates a buy and returns the expected tokens out and a slippage-adjusted minimum.'],
  ['monpad.buy(token, usdcIn, { slippageBps?, minTokensOut?, simulate? })', 'Approves the router for exactly usdcIn, then buys. Reverts if you would receive less than minTokensOut.'],
  ['monpad.buyWithMon(token, monIn, { minTokensOut?, minUsdcOut?, simulate? })', 'Buys with native MON: MON to USDC on the MON/USDC pool, then USDC to the token, in one transaction.'],
  ['monpad.sell(token, tokensIn, { slippageBps?, minUsdcOut?, simulate? })', 'Sells tokens for USDC, with the same protections. Handles the token approval if needed.'],
  ['monpad.sellForMon(token, tokensIn, { minMonOut?, minUsdcOut?, simulate? })', 'Sells tokens and pays out native MON, via USDC.'],
  ['monpad.launch({ name, symbol, creatorTaxBps?, devBuyUsdc?, salt?, simulate? })', 'Deploys the token and its pool in one transaction. Creation fee and dev buy are paid in USDC. Creator tax 0 to 500 bps.'],
  ['monpad.creatorEarnings(address)', 'USDC and token fees a creator can claim.'],
  ['monpad.claim(asset) / monpad.harvest(token)', 'Claim creator earnings in USDC or in a token, or trigger the fee split for a pool. Anyone can call harvest.'],
  ['monpad.quoteHealth()', 'Whether USDC is paused, or has blacklisted the launcher, router or pool manager.'],
  ['monpad.getMonshiBurned()', 'MONSHI held at the dead address.'],
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="scroll-mt-24 text-2xl md:text-3xl font-bold text-white mt-14 mb-4">{children}</h2>;
}
const P = ({ children }: { children: React.ReactNode }) => <p className="text-white/75 leading-relaxed mb-4">{children}</p>;
const Code = ({ children }: { children: string }) => (
  <pre className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/90 overflow-x-auto mb-4"><code>{children}</code></pre>
);
const Ic = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.9em] text-purple-200">{children}</code>;

export default function Docs() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <Head>
        <title>Docs | Monpad</title>
        <meta key="description" name="description" content="How Monpad works: launches on Uniswap V4 with an enforced creator tax, fees, trading, launch by chat, AI and MCP, the SDK and the HTTP API." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>

      <header className="mb-8">
        <div className="text-sm text-white/55 mb-2">Documentation</div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">Build on and trade with Monpad</h1>
        <p className="text-white/70 max-w-3xl leading-relaxed">
          Everything you need to launch a token, trade it, or plug a bot or an AI into Monpad on Monad.
        </p>
      </header>

      <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/5 p-4 mb-8 flex gap-3">
        <AlertTriangle className="shrink-0 mt-0.5" size={20} />
        <div className="text-white/80 text-sm leading-relaxed">
          <b className="text-white">Status.</b> The launch contracts have been tested on a fork of Monad mainnet and are going through an independent security review. This page describes how they work. Verified contract addresses are published here and on Monadscan at mainnet launch. Nothing on this page is financial advice.
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
          <H2 id="overview">Overview</H2>
          <P>Monpad is a launchpad on Monad. A token launches straight into a Uniswap V4 pool, paired with USDC, from the first block. There is no bonding curve and no waiting period. The pool is on the DEX from the moment the launch transaction lands.</P>
          <P>The pool uses a Monpad hook, a small contract that runs on every swap. The hook sets the swap fee and enforces the creator&apos;s tax inside the pool itself. Because the rule lives in the pool, every router, aggregator and bot pays the same fee, and no one can route around it.</P>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><b className="text-white">Plain token.</b> A standard ERC-20 with a fixed supply of 1 billion. No token tax, no mint, no owner, no blacklist and no anti-sniper code. It works everywhere a normal token does.</li>
            <li><b className="text-white">Locked liquidity.</b> The launcher holds the pool position and has no function that removes liquidity.</li>
            <li><b className="text-white">Open to bots.</b> There is no sniper protection, delay or whitelist. Bots and AI agents are first-class users.</li>
          </ul>

          <H2 id="launch">How a launch works</H2>
          <P>A launch is one transaction to the launcher contract:</P>
          <ol className="list-decimal pl-5 space-y-2 text-white/75 mb-4">
            <li>Deploys the token (1 billion supply, held entirely by the launcher).</li>
            <li>Creates the Uniswap V4 pool, USDC against the token, using the Monpad hook.</li>
            <li>Places the whole supply in one single-sided position at the starting price.</li>
            <li>Optionally spends your <b className="text-white">dev buy</b> in the same transaction, so you buy before anyone else can. The dev buy is capped at 5% of supply.</li>
          </ol>
          <P>You pay a flat creation fee in USDC, which the launch form shows before you confirm, plus any dev buy, also in USDC. The launcher pulls the USDC, so your wallet approves it first. Gas is paid in MON. A launch costs far less gas than a classic launcher, roughly 950k gas in our tests.</P>
          <P>You choose a <b className="text-white">creator tax</b> from 0% to 5% at launch. It is fixed forever. See Fees for what it does.</P>
          <Code>{`launch(name, symbol, salt, creatorTaxBps, quoteDevBuy)   // pulls creation fee + dev buy in USDC`}</Code>

          <H2 id="fees">Fees</H2>
          <P>Every swap in a Monpad pool pays <b className="text-white">1% plus the creator tax</b>, so between 1% and 6% in total. The hook sets this on every swap. Anyone can trigger the split by calling <Ic>harvest(token)</Ic>.</P>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm text-left border border-white/10 rounded-xl overflow-hidden">
              <thead className="bg-white/5 text-white/80"><tr><th className="p-3">Share of the base 1%</th><th className="p-3">Goes to</th></tr></thead>
              <tbody className="text-white/75 divide-y divide-white/10">
                <tr><td className="p-3">70%</td><td className="p-3">The creator, claimable at any time</td></tr>
                <tr><td className="p-3">10%</td><td className="p-3">The platform</td></tr>
                <tr><td className="p-3">10%</td><td className="p-3">Sent to the MONSHI burn wallet, converted to MONSHI and burned by the team</td></tr>
                <tr><td className="p-3">10%</td><td className="p-3">Buys and burns the launched token</td></tr>
              </tbody>
            </table>
          </div>
          <P><b className="text-white">Creator tax.</b> Anything above the base 1% is the creator tax. It is not paid to the creator or the platform. All of it buys and burns the launched token, so it can only reduce supply. The creator cannot take it out or change it later. The total fee is always shown before you trade.</P>
          <P><b className="text-white">Paid in USDC.</b> The fee on the USDC side of a swap is collected in USDC, and so are the creator payout and the platform share. The token-burn share is held in USDC until the buyback swaps it into the launched token. The MONSHI share is credited, in USDC, to a Monpad burn wallet.</P>
          <P><b className="text-white">Fees paid in the token.</b> On the token side of a swap, the creator and platform keep their 70% and 10%, and the two burn shares are burned directly in the token, 20% in total.</P>
          <P><b className="text-white">Buyback and burn.</b> Anyone can run the token buyback. It only executes when the pool price is close to a reference price the hook samples before swaps, which makes it hard to manipulate. The MONSHI share is different: the contract does not swap it. The team collects it from the burn wallet, buys MONSHI and burns it by hand, and the burns can be checked on-chain at the dead address.</P>

          <H2 id="trading">Trading</H2>
          <P>Tokens trade in the Uniswap V4 pool like any other pair, against USDC. On monpad.net, every token page has a trade box and a chart. Bots and aggregators can swap in the pool directly. The fee is charged either way.</P>
          <P>If you hold MON instead of USDC, the Monpad router can swap it for you in the same transaction: MON to USDC on the hookless MON/USDC pool, then USDC to the token. Selling works the same way in reverse. You pay the MON/USDC pool&apos;s own fee on that extra hop, and the router lets you set a minimum-out on the whole trade and on the MON/USDC leg.</P>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><b className="text-white">You need USDC to launch.</b> The creation fee and dev buy are USDC. MON is only needed for gas, or to buy through the MON route.</li>
            <li><b className="text-white">Always set a minimum out.</b> Prices move between quote and execution. Monpad&apos;s tools require a minimum-out on buys and sells.</li>
            <li><b className="text-white">Check the total fee.</b> A creator tax raises the fee up to 6%. It is shown on the token page.</li>
            <li><b className="text-white">Other pools can exist.</b> Anyone can create another pool for the same token elsewhere. Liquidity locked in Monpad&apos;s pool stays there, but volume can move.</li>
          </ul>

          <H2 id="chat">Launch by chat</H2>
          <P>Open <Link href="/chat" className="underline text-purple-300">Chat</Link> and describe your coin in a sentence. Monpad drafts the name, ticker, logo and a 3D character, and shows you the result. You confirm and sign the launch from your own wallet. Nothing is deployed until you approve the transaction.</P>
          <P>Launched tokens can get a living 3D character that reacts to the chart. Character generation uses credits that are covered by the creation fee.</P>

          <H2 id="agents">AI &amp; MCP</H2>
          <P>Monpad speaks the Model Context Protocol, so Claude, Cursor and other MCP-compatible assistants can read the market and, if you allow it, trade and launch. The server runs on your own machine. Your key stays there.</P>
          <Code>{`{
  "mcpServers": {
    "monpad": {
      "command": "npx",
      "args": ["-y", "@monpad/mcp"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_PRIVATE_KEY": "<a small burner wallet>"
      }
    }
  }
}`}</Code>
          <div className="overflow-x-auto mb-4 rounded-xl border border-white/10">
            {MCP_TOOLS.map(([name, kind, body]) => (
              <div key={name} className="flex items-start justify-between gap-4 p-3 border-b border-white/10 last:border-0">
                <div><Ic>{name}</Ic><div className="text-white/60 text-sm mt-1">{body}</div></div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${kind === 'write' ? 'bg-red-500/20 text-red-200' : 'bg-green-500/20 text-green-200'}`}>{kind}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4 text-white/75 text-sm leading-relaxed">
            <b className="text-white">Safety built in.</b> Write tools are dry runs unless you turn that off. Spend limits apply per transaction and per day, in USDC (<Ic>MAX_USDC_PER_TX</Ic>, <Ic>MAX_USDC_PER_DAY</Ic>) and separately in MON for the MON routes (<Ic>MAX_MON_PER_TX</Ic>, <Ic>MAX_MON_PER_DAY</Ic>). Buys and sells need a minimum-out. Use a separate burner wallet funded with only what you can afford to lose. Never give an AI your main wallet key, and read what it is about to do before you approve a trade.
          </div>
          <P><b className="text-white">Availability.</b> The MCP package is published at mainnet launch, together with the contract addresses.</P>

          <H2 id="sdk">SDK</H2>
          <P><Ic>@monpad/sdk</Ic> is a TypeScript library built on viem for traders, bots and apps. It wraps the launcher and the router, simulates before it sends, and requires a minimum-out on every trade.</P>
          <Code>{`npm i @monpad/sdk viem`}</Code>
          <Code>{`import { createWalletClient, http, parseUnits, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createMonpad } from '@monpad/sdk';

const walletClient = createWalletClient({
  account: privateKeyToAccount(process.env.MONPAD_PRIVATE_KEY as \`0x\${string}\`),
  chain: { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } } },
  transport: http('https://rpc.monad.xyz'),
});
const monpad = createMonpad({ walletClient });

// Read
const { launches } = await monpad.listLaunches({ limit: 10 });
const token = launches[0].token;

// Quote, then buy with 25 USDC (USDC has 6 decimals). simulate defaults to true: pass false to send.
const q = await monpad.quoteBuy(token, parseUnits('25', 6));
await monpad.buy(token, parseUnits('25', 6), { slippageBps: 200, simulate: false });

// Or buy with MON: it is swapped to USDC on the way
await monpad.buyWithMon(token, parseEther('0.5'), { simulate: false });

// Launch with a 2% creator tax and a 50 USDC dev buy (the creation fee is added on top)
await monpad.launch({ name: 'Example', symbol: 'EX', creatorTaxBps: 200, devBuyUsdc: parseUnits('50', 6), simulate: false });`}</Code>
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4">
            {SDK_METHODS.map(([sig, body]) => (
              <div key={sig} className="p-3"><code className="text-purple-200 text-sm break-words">{sig}</code><div className="text-white/60 text-sm mt-1">{body}</div></div>
            ))}
          </div>
          <P>Every write method defaults to <Ic>simulate: true</Ic>, which runs the transaction against the chain without sending it, and checks that USDC is not paused or blacklisting your wallet. Errors are typed, for example slippage exceeded, deadline passed, or unknown token.</P>
          <P><b className="text-white">Availability.</b> SDK v0.2 for the V4 launcher is published at mainnet launch, together with the contract addresses.</P>

          <H2 id="api">HTTP API</H2>
          <P>Read-only JSON, open to any origin, for bots, dashboards and AI agents.</P>
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4">
            <div className="p-3"><Ic>GET /api/v1/spec</Ic><div className="text-white/60 text-sm mt-1">Fee policy, chain and the current state of the contracts.</div></div>
            <div className="p-3"><Ic>GET /api/v1/burn</Ic><div className="text-white/60 text-sm mt-1">Live MONSHI burned, circulating and total supply.</div></div>
          </div>
          <Code>{`curl https://www.monpad.net/api/v1/burn`}</Code>

          <H2 id="events">On-chain data</H2>
          <P>Everything is readable on-chain, including the platform address, creator earnings and every swap. Read it from the verified contracts on Monadscan once they are published.</P>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><b className="text-white">Launches.</b> The launcher emits an event for every launch with the token, creator, creator tax and pool id, and keeps a list you can read by index.</li>
            <li><b className="text-white">Swaps.</b> Uniswap V4 emits <Ic>Swap</Ic> from the pool manager. Filter by the pool id to follow one token.</li>
            <li><b className="text-white">Fees.</b> The hook exposes the live fee for a pool. The launcher exposes claimable balances and the reserves waiting to burn.</li>
          </ul>

          <H2 id="security">Security &amp; risks</H2>
          <ul className="list-disc pl-5 space-y-2 text-white/75 mb-4">
            <li><Lock className="inline mr-1" size={14} /><b className="text-white">Not yet audited.</b> The contracts are tested on a fork of Monad mainnet. They go live only after an independent audit.</li>
            <li><b className="text-white">Admin powers are limited and visible.</b> The owner can pause new launches and change the platform address, the MONSHI wallet and the creation fee. The owner has no function to withdraw user funds or remove liquidity. Ownership belongs in a multisig.</li>
            <li><b className="text-white">USDC is a dependency.</b> USDC is issued by Circle, which can pause it or blacklist an address. If USDC is paused, or blacklists the launcher, the router or the pool manager, launches, trades and fee claims in USDC stop until Circle lifts it. A blacklisted wallet cannot send or receive USDC. Monpad&apos;s tools check for this before they send.</li>
            <li><b className="text-white">Harvests and buybacks need a caller.</b> They run when someone calls them. Monpad runs a bot, and anyone can call harvest or the token buyback.</li>
            <li><b className="text-white">Protocol fees.</b> Uniswap governance can switch on a protocol fee for pools. That would take a slice before the fee reaches Monpad.</li>
            <li><b className="text-white">The MONSHI burn is manual.</b> Nothing on-chain forces the MONSHI share to be burned. It is paid to a wallet the owner sets, and the team burns it. Trust it only as far as you trust that wallet&apos;s published burns.</li>
            <li><b className="text-white">Memecoins are risky.</b> Tokens can go to zero, and liquidity being locked does not protect the price.</li>
          </ul>

          <H2 id="wallet">Wallet setup</H2>
          <P>Add Monad mainnet to any EVM wallet:</P>
          <div className="rounded-xl border border-white/10 divide-y divide-white/10 mb-4 text-sm">
            {[['Network name', 'Monad Mainnet'], ['Chain ID', '143'], ['RPC URL', 'https://rpc.monad.xyz'], ['Currency', 'MON (gas). Trades and launch fees use USDC.'], ['Explorer', 'https://monadscan.com']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 p-3"><span className="text-white/60">{k}</span><span className="text-white break-all text-right">{v}</span></div>
            ))}
          </div>
          <P>Questions? Ask in the community Telegram or on X. Please never share your seed phrase or private key with anyone, including anyone claiming to be Monpad support.</P>
        </main>
      </div>
    </div>
  );
}

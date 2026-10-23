import Link from 'next/link';
import { LP_FEE_SPLIT_COPY } from '@/lib/fees';
import Head from 'next/head';
import { ArrowRight, Shield, Coins, TrendingUp, Lock, Sparkles, MessageCircle, BookOpen } from 'lucide-react';

const FAQ = [
  {
    q: "Do I need MONSHI to use Mon-Pad?",
    a: "No. Holding at least 1,000,000 MONSHI gives you 50% off the creation fee (250 MON instead of 500), but everything works without it.",
  },
  {
    q: "Where does the token trade?",
    a: "In a Uniswap V3 pool from the launch transaction. Buys and sells hit the DEX immediately, and the pair is on DexScreener from block one.",
  },
  {
    q: "Can the team rug me?",
    a: "Liquidity sits in the Uniswap V3 position. Creators earn the LP fee split. They do not get a withdraw button for the pool.",
  },
  {
    q: "What does a creator earn?",
    a: "70% of LP fees, with 10% to the platform, 10% buying and burning MONSHI, and 10% burning the project token. Creators can also route extra tax into buyback or LP.",
  },
  {
    q: "How is this different from Pump.fun?",
    a: "Pump.fun uses its own curve. Monpad launches on Monad straight into Uniswap V3, so the pair is on the DEX and DexScreener from block one. Bots and agents are welcome.",
  },
  {
    q: "How is this different from nad.fun?",
    a: "Same fair-launch, native-MON approach, but Mon-Pad adds creator tools (optional per-trade tax routed to buyback-burn / LP) and a MONSHI flywheel — a slice of every sell buys and burns MONSHI.",
  },
  {
    q: "What's MONSHI?",
    a: "MONSHI is a community token on Monad. Holding ≥1M gets you 50% off creation fees, and a slice of every sell (plus any creator tax above 2%) automatically buys and burns MONSHI. Not required to use the pad.",
  },
];

const LAUNCH_STEPS = [
  { n: 1, title: 'Connect your wallet', body: 'MetaMask, Rabby, or any wallet that supports Monad mainnet (chainId 143).' },
  { n: 2, title: 'Pay 500 MON creation fee', body: '100 MON seeds the Uniswap V3 pool; the rest funds the platform treasury.' },
  { n: 3, title: 'Fill in token details', body: 'Name, symbol, description, image, socials (Twitter, Telegram, website — all optional).' },
  { n: 4, title: 'Make your dev buy (optional)', body: 'Between 0 and 2% of supply. Signals commitment. Standard is roughly 1–2%.' },
  { n: 5, title: 'Confirm transaction', body: 'One transaction creates the token, seeds the Uniswap V3 pool, and fills your dev-bot buy.' },
  { n: 6, title: 'Trading goes live instantly', body: 'Your token has its own page at /token/<address> for anyone to buy and sell.' },
];

export default function HowItWorks() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Head>
        <title>How Mon-Pad works | Fair launch on Monad</title>
        <meta key="description" name="description" content="How MONPAD works: launch straight into a Uniswap V3 pool on Monad. LP fees pay the creator, the platform, and two burns." />
        <meta key="og:title" property="og:title" content="How Mon-Pad works" />
        <meta key="og:description" property="og:description" content="Launch on Monad into Uniswap V3 from block one." />
        <meta key="og:url" property="og:url" content="https://www.monpad.net/how-it-works" />
        <meta key="twitter:title" name="twitter:title" content="How Mon-Pad works" />
        <meta key="twitter:description" name="twitter:description" content="Fair launch token platform on Monad." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/how-it-works" />
        {/* FAQ JSON-LD mirrors the visible FAQ array above exactly. */}
        {/* Do not edit one without editing the other - schema-vs-content mismatch triggers Google manual actions. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: FAQ.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
              })),
            }),
          }}
        />
      </Head>
      {/* Hero */}
      <header className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">How Mon-Pad works</h1>
        <p className="text-base md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
          Everything you need to know to launch and trade a token on Monad.
        </p>
      </header>

      {/* Section 1: What is Mon-Pad? */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">What is Mon-Pad?</h2>
        <div className="space-y-4 text-base text-white/70 leading-relaxed">
          <p>
            MONPAD is a fair-launch token platform on Monad. No pre-sale, no team allocation, no insider unlocks. The launch transaction puts the token in a Uniswap V3 pool.
          </p>
          <p>
            From that block the pair is on the DEX and DexScreener. Creators earn LP fees. Every trade also burns MONSHI and a slice of the project token.
          </p>
        </div>
      </section>

      {/* Section 2: Launching a token */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Launching a token</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LAUNCH_STEPS.map((s) => (
            <div key={s.n} className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-brand-purple/10 text-brand-purple flex items-center justify-center font-bold text-sm">
                  {s.n}
                </div>
                <h3 className="text-lg font-semibold text-white">{s.title}</h3>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link href="/create" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-purple hover:bg-brand-purple/90 text-white font-semibold transition-colors">
            Launch a token <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">The pool</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Price is the Uniswap V3 pool. Bots and agents can trade the block the pool exists.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Total supply</div>
            <div className="text-2xl font-bold text-brand-purple">1B tokens</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Pool</div>
            <div className="text-2xl font-bold text-brand-purple">Uniswap V3</div>
            <div className="text-xs text-white/50 mt-1">1% fee tier</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">LP fees</div>
            <div className="text-2xl font-bold text-brand-purple">LP split</div>
            <div className="text-xs text-white/50 mt-1">{LP_FEE_SPLIT_COPY}</div>
          </div>
        </div>
      </section>

      {/* Section 4: Fees */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Fees explained</h2>
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr className="text-left text-white/70">
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Fee</th>
                <th className="px-4 py-3 font-semibold">Split</th>
              </tr>
            </thead>
            <tbody className="text-white/80">
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">LP fees</td>
                <td className="px-4 py-3">1% pool</td>
                <td className="px-4 py-3">{LP_FEE_SPLIT_COPY}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">Token creation</td>
                <td className="px-4 py-3">500 MON</td>
                <td className="px-4 py-3">Seeds the Uniswap V3 position. MONSHI holders can get the creation discount.</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">Creator tax (optional)</td>
                <td className="px-4 py-3">0–10%</td>
                <td className="px-4 py-3">Set by the creator, on top of the 2% base → buyback &amp; burn / LP</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Fees</h2>
        <p className="text-base text-white/70 leading-relaxed">
          {LP_FEE_SPLIT_COPY}. The pool fee tier is 1% on Uniswap V3. That split is the product. There is no second curve fee.
        </p>
      </section>

      {/* Section 6: MONSHI + creator tools */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">MONSHI &amp; creator tools</h2>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          Hold <strong className="text-white">≥ 1,000,000 MONSHI</strong> and your creation fee is cut 50% (250 MON instead of 500).
          Every launch also feeds the MONSHI ecosystem: <strong className="text-white">0.5% of every sell</strong>, plus
          25% of any creator tax above 2%, automatically buys &amp; burns MONSHI.
        </p>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          On top of the base fees, creators can turn on their own <strong className="text-white">buyback &amp; burn</strong> and
          <strong className="text-white"> add-to-LP</strong> routing (funded by an optional 0–10% per-trade tax and/or their dev fee) —
          so trading volume automatically reduces supply and/or deepens liquidity. See the <Link href="/docs" className="text-brand-purple hover:underline">Docs</Link> for the full mechanics.
        </p>
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="inline-block px-3 py-1 mb-2 rounded-full bg-brand-purple/10 border border-brand-purple/30 text-brand-purple text-xs font-medium tracking-wide uppercase">On the roadmap</div>
          <p className="text-sm text-white/70 leading-relaxed">
            <strong className="text-white">Staking</strong> — stake project tokens launched on Mon-Pad to earn a share of revenue
            plus holder bonuses — is in active development and ships after mainnet stabilizes.
          </p>
        </div>
      </section>

      {/* Section 7: Safety & Audits */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Safety &amp; Audits</h2>
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <Shield className="text-brand-purple flex-shrink-0 mt-1" size={28} />
            <div className="space-y-3 text-base text-white/70 leading-relaxed">
              <p>
                Reviewed across multiple audit rounds and source-verified on the Monad explorer. Liquidity lives in the Uniswap V3 position. Treasury, buyback, and platform wallets are visible on-chain, and economic parameters change only through a 24-hour timelock with 2-step ownership.
              </p>
              <p>
                Read the contract source and audit notes on the <Link href="/docs" className="text-brand-purple hover:underline">Docs page</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 8: FAQ */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">FAQ</h2>
        <div className="space-y-4">
          {FAQ.map((item, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-base font-semibold text-white mb-2">{item.q}</h3>
              <p className="text-sm text-white/70 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 9: Getting Help */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Getting help</h2>
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
                  Stuck on something? Reach the team on Telegram.
                </p>
                <div className="text-xs text-brand-purple mt-2">t.me/MonshiUtilitySupport &rarr;</div>
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
                  Hang out, share launches, talk strategy with the community.
                </p>
                <div className="text-xs text-brand-purple mt-2">t.me/monpadlounge &rarr;</div>
              </div>
            </div>
          </a>
        </div>
      </section>

      {/* Section 10: CTA */}
      <section className="mt-16 mb-8 text-center">
        <h2 className="text-3xl font-bold text-white mb-4">Ready to launch?</h2>
        <p className="text-base text-white/70 mb-6 max-w-2xl mx-auto">
          Fair launch. Real pool. Real money.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/create" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-purple hover:bg-brand-purple/90 text-white font-semibold transition-colors">
            Create a token <ArrowRight size={18} />
          </Link>
          <Link href="/docs" className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border hover:border-brand-purple/50 text-white font-semibold transition-colors">
            Read the docs <BookOpen size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}

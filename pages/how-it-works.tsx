import Link from 'next/link';
import Head from 'next/head';
import { ArrowRight, Shield, Coins, TrendingUp, Lock, Sparkles, MessageCircle, BookOpen } from 'lucide-react';

const FAQ = [
  {
    q: "Do I need MONSHI to use Mon-Pad?",
    a: "No. MONSHI gets you bonuses (waived stake fee, bonus rewards) but everything works without it.",
  },
  {
    q: "What if my token doesn't graduate?",
    a: "It keeps trading on the bonding curve forever. There's no time limit and no failed-launch refund — buys and sells route through the curve until graduation happens.",
  },
  {
    q: "Can the team rug me?",
    a: "No. The graduation LP is locked permanently. Creators can't withdraw the LP — they can only earn the trading fees from sells (0.5% forever).",
  },
  {
    q: "How is this different from Pump.fun?",
    a: "Pump.fun is on Solana with their own AMM. Mon-Pad is on Monad with real Uniswap V3 graduation. Creators on Mon-Pad earn forever (not just before graduation). Staking rewards built in.",
  },
  {
    q: "How is this different from nad.fun?",
    a: "We focus on creator economics (2% fee revenue forever per token), deeper DeFi integration (staking, MONSHI tie-ins), and fair-launch ethos. Pricing is the same range for users.",
  },
  {
    q: "When can I unstake?",
    a: "Anytime, but unstaking before your lock ends charges the tier's early fee (varies by tier, see the Staking page). Free-tier stakers who fall below 2M MONSHI before unstake also pay a 20% dropout penalty.",
  },
  {
    q: "What's MONSHI?",
    a: "MONSHI is a community token on Monad that we partner with for fee distribution. Holding MONSHI waives stake fees and gives bonus rewards. Not required.",
  },
];

const LAUNCH_STEPS = [
  { n: 1, title: 'Connect your wallet', body: 'MetaMask, Rabby, or any wallet that supports Monad mainnet (chainId 143).' },
  { n: 2, title: 'Pay 500 MON creation fee', body: '100 MON seeds your curve as starting liquidity; the rest funds the platform treasury.' },
  { n: 3, title: 'Fill in token details', body: 'Name, symbol, description, image, socials (Twitter, Telegram, website — all optional).' },
  { n: 4, title: 'Make your dev buy (optional)', body: 'Between 0 and 2% of supply. Signals commitment. Standard is roughly 1–2%.' },
  { n: 5, title: 'Confirm transaction', body: 'One tx creates the token, sets up the bonding curve, and credits your dev buy.' },
  { n: 6, title: 'Trading goes live instantly', body: 'Your token has its own page at /token/<address> for anyone to buy and sell.' },
];

export default function HowItWorks() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Head>
        <title>How Mon-Pad works | Fair launch on Monad</title>
        <meta key="description" name="description" content="How Mon-Pad works: bonding curve, graduation to Uniswap V3, fair launch with no pre-sale or team allocation on Monad." />
        <meta key="og:title" property="og:title" content="How Mon-Pad works" />
        <meta key="og:description" property="og:description" content="Fair launch token platform on Monad. Learn how the bonding curve and graduation work." />
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
          Everything you need to know to launch, trade, and graduate a token on Monad.
        </p>
      </header>

      {/* Section 1: What is Mon-Pad? */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">What is Mon-Pad?</h2>
        <div className="space-y-4 text-base text-white/70 leading-relaxed">
          <p>
            Mon-Pad is a fair-launch token platform on the Monad blockchain. No pre-sale, no team allocation, no insider unlocks — everyone buys from the same bonding curve from block one.
          </p>
          <p>
            When a token raises enough MON, it &quot;graduates&quot; to a real Uniswap V3 liquidity pool. The LP is locked forever, the creator earns sell fees in perpetuity, and the token trades like any other on-chain asset.
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

      {/* Section 3: The bonding curve */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">The bonding curve</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          Price rises as more MON is added to the curve, and drops when MON is removed. The curve uses constant-product math (x·y=k) with virtual reserves to prevent snipe-bots from buying everything at launch.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Total supply</div>
            <div className="text-2xl font-bold text-brand-purple">1B tokens</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Virtual reserve</div>
            <div className="text-2xl font-bold text-brand-purple">117K MON</div>
            <div className="text-xs text-white/50 mt-1">anti-snipe</div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 text-center">
            <div className="text-xs text-white/50 uppercase tracking-wide mb-1">Graduation target</div>
            <div className="text-2xl font-bold text-brand-purple">425K MON</div>
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
                <td className="px-4 py-3 font-medium">Buy</td>
                <td className="px-4 py-3">2%</td>
                <td className="px-4 py-3">1% creator + 1% platform buffer</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">Sell</td>
                <td className="px-4 py-3">2%</td>
                <td className="px-4 py-3">1% platform + 0.5% creator + 0.5% staking rewards</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">Token creation</td>
                <td className="px-4 py-3">500 MON</td>
                <td className="px-4 py-3">100 MON seeds curve liquidity; remainder to treasury</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-4 py-3 font-medium">Early unstake</td>
                <td className="px-4 py-3">Varies</td>
                <td className="px-4 py-3">Per-tier early fee + 20% dropout penalty if free staker</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5: Graduation */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Graduation</h2>
        <p className="text-base text-white/70 leading-relaxed mb-6">
          When raised MON hits <strong className="text-white">260,000 MON net of fees</strong> (≈ $5,000), the token graduates automatically. Three things happen in one transaction:
        </p>
        <ol className="space-y-3 mb-6">
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-purple/10 text-brand-purple flex items-center justify-center font-bold text-xs mt-0.5">1</span>
            <span className="text-white/70 leading-relaxed">Remaining curve tokens + MON migrate to a real Uniswap V3 LP.</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-purple/10 text-brand-purple flex items-center justify-center font-bold text-xs mt-0.5">2</span>
            <span className="text-white/70 leading-relaxed">The LP NFT is locked forever (no rug possible).</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-purple/10 text-brand-purple flex items-center justify-center font-bold text-xs mt-0.5">3</span>
            <span className="text-white/70 leading-relaxed">Creator receives <strong className="text-white">25,000 MON graduation reward</strong> (claimable via the Token page).</span>
          </li>
        </ol>
        <p className="text-base text-white/70 leading-relaxed">
          After graduation, the token trades on Uniswap V3 like any other Monad token. The creator still earns 0.5% of every sell forever (no expiry).
        </p>
      </section>

      {/* Section 6: Staking teaser */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Staking</h2>
        <p className="text-base text-white/70 leading-relaxed mb-4">
          Token holders can stake to earn a share of sell fees from the tokens they back. Lock durations: <strong className="text-white">7 / 30 / 90 / 180 days</strong> (longer locks earn more rewards weight). 2% stake fee, waived if you hold MONSHI. Early unstake charges the tier's early fee (set per tier by Mon-Pad governance). Free-tier stakers who fall below 2M MONSHI before unstake also pay a 20% dropout penalty.
        </p>
        <p className="text-base text-white/70 leading-relaxed">
          MONSHI stakers get bonus rewards — 40% of platform sell fees flow to MONSHI buyback.
        </p>
        {/* TODO: link to /stake once Batch 2d ships */}
      </section>

      {/* Section 7: Safety & Audits */}
      <section className="mt-16">
        <h2 className="text-3xl font-bold text-white mb-6">Safety &amp; Audits</h2>
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <Shield className="text-brand-purple flex-shrink-0 mt-1" size={28} />
            <div className="space-y-3 text-base text-white/70 leading-relaxed">
              <p>
                Audited by Claude Code via three rounds of review. The graduation LP is locked permanently — creators cannot withdraw it. Treasury, buyback, and platform wallets are env-driven and visible on-chain.
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
          Fair launch. Pure curve. Real money.
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

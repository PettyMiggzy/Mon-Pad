import Head from 'next/head';

export default function StakePage() {
  const canonical = 'https://www.monpad.net/stake';
  return (
    <>
      <Head>
        <title>Stake | Mon-Pad</title>
        <meta
          key="description"
          name="description"
          content="MONSHI-powered staking on Mon-Pad is coming soon. Stake project tokens to earn revenue share and holder bonuses."
        />
        <meta key="og:title" property="og:title" content="Stake | Mon-Pad" />
        <meta
          key="og:description"
          property="og:description"
          content="MONSHI-powered staking on Mon-Pad is coming soon."
        />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Stake | Mon-Pad" />
        <meta
          key="twitter:description"
          name="twitter:description"
          content="MONSHI-powered staking on Mon-Pad is coming soon."
        />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-xl bg-black/40 border border-border rounded-xl px-6 py-10 text-center">
            <div className="inline-block px-3 py-1 mb-4 rounded-full bg-brand-purple/10 border border-brand-purple/30 text-brand-purple text-xs font-medium tracking-wide uppercase">
              On the roadmap
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">
              Staking — Coming Soon
            </h1>
            <p className="text-white/70 leading-relaxed">
              MONSHI-powered staking is in active development. Soon you’ll be
              able to stake project tokens launched on Mon-Pad to earn a share
              of platform revenue alongside holder bonuses on every launch.
            </p>
            <p className="text-white/50 leading-relaxed mt-3 text-sm">
              Staking will roll out shortly after the platform mainnet
              stabilizes. Thanks for your patience while we ship it right.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

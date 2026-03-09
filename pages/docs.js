import Layout from '../components/Layout'

export default function Docs() {
  return (
    <Layout showBack title="Docs">
      <div style={{ padding: '20px 14px 40px', maxWidth: 480 }}>

        {/* HERO */}
        <div style={{ background: 'linear-gradient(135deg,rgba(110,84,255,0.12),rgba(133,230,255,0.06))', border: '1px solid rgba(110,84,255,0.2)', borderRadius: 16, padding: '24px 20px', marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📖</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>MonPad Documentation</div>
          <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7 }}>
            The fairest token launchpad on Monad. Creators earn from day one.
          </div>
        </div>

        {/* HOW IT WORKS */}
        <Section title="How MonPad Works">
          <P>MonPad is a fair launch token launchpad on Monad. Anyone can launch a token for 10 MON. Every token starts on a bonding curve — price increases as more people buy. When 400,000 MON is raised, the token graduates to Uniswap V3 and liquidity is permanently locked.</P>
        </Section>

        {/* DEV FEES — THIS IS THE MAIN SECTION */}
        <Section title="💰 Creator Fees — Devs Earn 1.5% of Volume">
          <P style={{ color: 'var(--p2)', fontWeight: 600, fontSize: 15 }}>
            Every creator earns 1.5% of the total trading volume on their token. That means every buy and every sell pays you — automatically, on-chain, forever while on the bonding curve.
          </P>

          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <FeeRow label="0.5% of every BUY" desc="Sent to your wallet immediately when someone buys" badge="INSTANT" color="var(--g)" />
            <FeeRow label="0.5% of every SELL" desc="Sent to your wallet immediately when someone sells" badge="INSTANT" color="var(--g)" />
            <FeeRow label="0.5% buy buffer" desc="Accumulates in the bonding curve, paid to you in full at graduation" badge="AT GRAD" color="var(--gold)" />
          </div>

          <div style={{ background: 'rgba(110,84,255,0.08)', border: '1px solid rgba(110,84,255,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--p2)', marginBottom: 8 }}>Example: 100,000 MON volume on your token</div>
            <Row l="0.5% buy fees (paid instantly)" v="~250 MON" />
            <Row l="0.5% sell fees (paid instantly)" v="~250 MON" />
            <Row l="0.5% buffer (paid at graduation)" v="~500 MON" />
            <div style={{ height: 1, background: 'var(--bd)', margin: '8px 0' }} />
            <Row l="Total earned" v="~1,000 MON" bold />
          </div>
          <P>Your fees arrive in your wallet automatically. No claiming required for instant fees.</P>
        </Section>

        {/* BONDING CURVE */}
        <Section title="📈 Bonding Curve">
          <P>Every token starts at a price of 0.000150 MON per token. As more MON is raised, the price increases linearly. This means early buyers get lower prices and the curve rewards early participation.</P>
          <P>The bonding curve is fully on-chain. No central order book. Price is determined by a formula, not by matching orders.</P>
          <Row l="Starting price" v="0.000150 MON/token" />
          <Row l="Total supply" v="1,000,000,000 tokens" />
          <Row l="Graduation target" v="400,000 MON raised" />
        </Section>

        {/* FEES FULL BREAKDOWN */}
        <Section title="Fee Breakdown">
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', marginBottom: 10 }}>On every BUY (2% total)</div>
          <Row l="1% — MonPad platform" v="Pays for infrastructure" />
          <Row l="0.5% — Creator (instant)" v="Your wallet" />
          <Row l="0.5% — Creator buffer" v="Paid at graduation" />

          <div style={{ height: 1, background: 'var(--bd)', margin: '14px 0' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', marginBottom: 10 }}>On every SELL (2% total)</div>
          <Row l="1% — Sell buffer" v="Paid to MonPad at graduation" />
          <Row l="0.5% — Buyback" v="Used for MON buybacks" />
          <Row l="0.5% — Creator (instant)" v="Your wallet" />
        </Section>

        {/* GRADUATION */}
        <Section title="🎓 Graduation">
          <P>When a token raises 400,000 MON on the bonding curve, it graduates automatically. At graduation:</P>
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            {[
              'Creator receives all accumulated buy buffer fees',
              'Creation fee goes to buyback wallet',
              'Sell buffer goes to MonPad platform',
              'All remaining MON + tokens are added as Uniswap V3 liquidity',
              'LP position is permanently burned — nobody can rug the pool',
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <span style={{ color: 'var(--g)', flexShrink: 0 }}>✓</span>
                <span style={{ fontSize: 13, color: 'var(--t2)' }}>{s}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* CONTRACTS */}
        <Section title="🔒 Contracts">
          <P>All contracts are deployed on Monad Mainnet (Chain ID: 143).</P>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px', marginTop: 10 }}>
            {[
              ['Factory', '0xfEdC5df2F34Ec01Ac9cbc0c557a4BFD3de6C5c45'],
              ['WMON', '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'],
              ['Uniswap V3 NPM', '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'],
            ].map(([l, v]) => (
              <div key={l} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--p2)', wordBreak: 'break-all' }}>{v}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* BOT PROTECTION */}
        <Section title="🤖 Bot Protection">
          <P>Every token launches with bot protection enabled by default. This limits max buy size to 2.5% of remaining supply and enforces a 1-block cooldown between buys from the same wallet. Creators can ask MonPad to adjust these settings.</P>
        </Section>

      </div>
    </Layout>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--bd)' }}>{title}</div>
      {children}
    </div>
  )
}

function P({ children, style }) {
  return <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 10, ...style }}>{children}</p>
}

function Row({ l, v, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span style={{ color: 'var(--t3)' }}>{l}</span>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: bold ? 800 : 600, color: bold ? 'var(--p2)' : 'var(--t1)' }}>{v}</span>
    </div>
  )
}

function FeeRow({ label, desc, badge, color }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--bd)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>{desc}</div>
      </div>
      <div style={{ background: `rgba(${color === 'var(--g)' ? '34,197,94' : '255,174,69'},0.12)`, color, fontSize: 9, fontWeight: 800, padding: '3px 7px', borderRadius: 5, letterSpacing: '.5px', alignSelf: 'center', flexShrink: 0 }}>
        {badge}
      </div>
    </div>
  )
}
import Layout from '../components/Layout'

export default function Docs() {
  return (
    <Layout title="Docs">
      <div className="container" style={{maxWidth:760, paddingBottom:60}}>
        <div className="hero" style={{marginTop:16, marginBottom:24, padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <h1 className="hero-title" style={{fontSize:'clamp(28px,5vw,40px)'}}>📖 How MonPad Works</h1>
            <p className="text-t2 text-sm">The fairest pad on Monad. Devs earn forever.</p>
          </div>
        </div>

        <Section title="🚀 Launching" emoji="🚀">
          <p>Anyone can launch a token on MonPad for <Bold>100 MON</Bold>.</p>
          <ul>
            <li><Bold>1B fixed supply</Bold> — minted to bonding curve at deploy</li>
            <li><Bold>0-2% optional dev buy</Bold> — atomic at launch, no front-running</li>
            <li><Bold>No insider allocations</Bold> — no team tokens, no presale, no vesting unlocks</li>
            <li><Bold>Custom branding</Bold> — banner image, token icon, social links</li>
          </ul>
        </Section>

        <Section title="📈 Trading Fees" emoji="📈">
          <p>Every trade has a small fee that pays creators, the platform, and stakers.</p>

          <div className="card mt-3 mb-3" style={{padding:16}}>
            <div className="font-bold text-base mb-2 text-green">🟢 BUY (2% total)</div>
            <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6, fontSize:13}}>
              <li>• <Bold>1%</Bold> to token creator (instant)</li>
              <li>• <Bold>1%</Bold> to curve buffer (paid to platform at graduation)</li>
            </ul>
          </div>

          <div className="card" style={{padding:16}}>
            <div className="font-bold text-base mb-2 text-red">🔴 SELL (2% total)</div>
            <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6, fontSize:13}}>
              <li>• <Bold>0.5%</Bold> to token creator (instant)</li>
              <li>• <Bold>0.5%</Bold> to staking pool (or buyback wallet)</li>
              <li>• <Bold>1%</Bold> to platform (instant)</li>
            </ul>
          </div>
        </Section>

        <Section title="🎓 Graduation" emoji="🎓">
          <p>When a token raises <Bold>425,000 MON</Bold> on the bonding curve, it graduates:</p>
          <ul>
            <li><Bold>400,000 MON</Bold> + remaining tokens → Uniswap V3 liquidity pool</li>
            <li>LP tokens are <Bold>permanently burned</Bold> 🔥 (rug-proof forever)</li>
            <li><Bold>25,000 MON</Bold> goes to the creator (marketing reward)</li>
            <li>Buy buffer accumulated from trades → platform wallet</li>
          </ul>
          <p className="mt-3">After graduation, the token trades on the open market like any other.</p>
        </Section>

        <Section title="🥩 Staking" emoji="🥩">
          <p>Anyone can create a staking pool for any MonPad token. Free for 1M+ MONSHI holders, 200 MON otherwise (→ buyback).</p>

          <div className="card mt-3 mb-3" style={{padding:16}}>
            <div className="font-bold text-base mb-2">⏰ Lock Tiers</div>
            <table style={{width:'100%', fontSize:13}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--bd)'}}>
                  <th style={{textAlign:'left', padding:'6px 0', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Lock</th>
                  <th style={{textAlign:'right', padding:'6px 0', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Boost</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={{padding:'8px 0'}}>30 days</td><td style={{textAlign:'right', fontFamily:'var(--mono)'}}>1.0x</td></tr>
                <tr><td style={{padding:'8px 0'}}>90 days</td><td style={{textAlign:'right', fontFamily:'var(--mono)', color:'var(--cyan)'}}>1.5x</td></tr>
                <tr><td style={{padding:'8px 0'}}>180 days</td><td style={{textAlign:'right', fontFamily:'var(--mono)', color:'var(--p2)'}}>2.5x</td></tr>
                <tr><td style={{padding:'8px 0'}}>365 days</td><td style={{textAlign:'right', fontFamily:'var(--mono)', color:'var(--gold)'}}>4.0x</td></tr>
              </tbody>
            </table>
          </div>

          <p className="mb-3">Sell-tax 0.5% from each token's trades flows to staking. <Bold>40%</Bold> goes to MONSHI's pool, <Bold>60%</Bold> distributed to other pools by trading volume.</p>

          <div className="card" style={{background:'rgba(252,211,77,0.05)', borderColor:'rgba(252,211,77,0.3)', padding:14, fontSize:13, color:'var(--gold)'}}>
            ⚠ <Bold>Early unstake:</Bold> 10% fee on tokens (sent to creator) + ALL pending rewards forfeited (boosts other stakers).
          </div>
        </Section>

        <Section title="💸 Why MonPad?" emoji="💸">
          <ul>
            <li>🎯 <Bold>Fair launch</Bold> — no presale, no team tokens, no insider trading</li>
            <li>💰 <Bold>Devs earn forever</Bold> — 2% of all volume, paid instantly</li>
            <li>🔥 <Bold>LP burned</Bold> — graduated tokens have unrugable liquidity</li>
            <li>🔀 <Bold>Upgradeable</Bold> — admin params tunable without redeploying</li>
            <li>🤝 <Bold>Referrals</Bold> — share your link to earn from new launches</li>
            <li>🏆 <Bold>Achievements</Bold> — earn badges for trading, staking, creating</li>
          </ul>
        </Section>

        <Section title="🔗 Links" emoji="🔗">
          <ul>
            <li><a href="https://x.com/Monshi_Monpad" target="_blank" rel="noreferrer" className="text-purple">𝕏 @Monshi_Monpad</a></li>
            <li><a href="https://t.me/monshimonad" target="_blank" rel="noreferrer" className="text-purple">📱 Telegram</a></li>
            <li><a href="https://github.com/PettyMiggzy/Mon-Pad" target="_blank" rel="noreferrer" className="text-purple">⚙️ GitHub</a></li>
          </ul>
        </Section>
      </div>
    </Layout>
  )
}

function Section({ title, children }) {
  return (
    <div className="card mb-4" style={{padding:20}}>
      <h2 className="text-lg font-black mb-3">{title}</h2>
      <div style={{color:'var(--t2)', fontSize:14, lineHeight:1.7}}>{children}</div>
    </div>
  )
}

function Bold({ children }) {
  return <strong style={{color:'var(--p2)'}}>{children}</strong>
}

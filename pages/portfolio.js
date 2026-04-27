import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useBalance } from 'wagmi'
import Layout from '../components/Layout'
import { fmtMON, fmtUSD, fmtTokens, fmtAddr, timeAgo, MONSHI_TOKEN } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Portfolio() {
  const router = useRouter()
  const { address: wallet, isConnected } = useAccount()
  const { data: monBalance } = useBalance({ address: wallet })

  const [holdings, setHoldings] = useState([])
  const [stakes, setStakes] = useState([])
  const [trades, setTrades] = useState([])
  const [achievements, setAchievements] = useState([])
  const [monPrice, setMonPrice] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('holdings')

  useEffect(() => {
    if (!wallet || !SERVER) { setLoading(false); return }
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
    loadAll()
    const iv = setInterval(loadAll, 12000)
    return () => clearInterval(iv)
  }, [wallet])

  async function loadAll() {
    if (!wallet || !SERVER) return
    try {
      const h = await fetch(`${SERVER}/api/portfolio/${wallet}/holdings`).then(r => r.ok ? r.json() : []).catch(() => [])
      if (Array.isArray(h)) setHoldings(h)
      const s = await fetch(`${SERVER}/api/staking/positions/${wallet}`).then(r => r.ok ? r.json() : []).catch(() => [])
      if (Array.isArray(s)) setStakes(s)
      const t = await fetch(`${SERVER}/api/portfolio/${wallet}/trades?limit=50`).then(r => r.ok ? r.json() : []).catch(() => [])
      if (Array.isArray(t)) setTrades(t)
      const a = await fetch(`${SERVER}/api/portfolio/${wallet}/achievements`).then(r => r.ok ? r.json() : []).catch(() => [])
      if (Array.isArray(a)) setAchievements(a)
    } catch {}
    setLoading(false)
  }

  if (!isConnected) {
    return (
      <Layout title="Portfolio">
        <div className="container" style={{padding:'40px 16px', textAlign:'center'}}>
          <div className="card" style={{padding:40, maxWidth:420, margin:'0 auto'}}>
            <div style={{fontSize:48, marginBottom:14}}>💎</div>
            <div className="text-xl font-bold mb-2">Connect Wallet</div>
            <p className="text-t3 text-sm mb-4">Connect your wallet to see your holdings, stakes, P&L, and achievements.</p>
          </div>
        </div>
      </Layout>
    )
  }

  const totalHoldingsMon = holdings.reduce((a, h) => a + Number(h.valueMon || 0), 0)
  const totalStakedMon = stakes.reduce((a, s) => a + Number(s.valueMon || 0), 0)
  const totalPending = stakes.reduce((a, s) => a + Number(s.pendingReward || 0) / 1e18, 0)
  const monBal = monBalance ? Number(monBalance.value) / 1e18 : 0
  const netWorth = totalHoldingsMon + totalStakedMon + monBal + totalPending
  const realizedPnL = trades.reduce((a, t) => a + (Number(t.realizedPnL) || 0), 0)

  // Calculate wallet tier
  const monshiHolding = holdings.find(h => h.tokenAddress?.toLowerCase() === MONSHI_TOKEN.toLowerCase())
  const monshiBalance = Number(monshiHolding?.balance || 0) / 1e18
  let walletTier = 'shrimp'
  if (monshiBalance >= 10_000_000) walletTier = 'whale'
  else if (monshiBalance >= 1_000_000) walletTier = 'dolphin'
  else if (monshiBalance >= 100_000) walletTier = 'crab'
  if (achievements.find(a => a.id === 'royalty')) walletTier = 'royalty'

  return (
    <Layout title="Portfolio">
      <div className="container" style={{paddingBottom:60}}>
        {/* HERO with Net Worth */}
        <div className="hero" style={{marginTop:16, marginBottom:16, padding:'28px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <div className="text-xs text-t3 font-bold mb-2" style={{letterSpacing:2}}>NET WORTH</div>
            <div className="hero-title" style={{fontSize:'clamp(36px,7vw,56px)', marginBottom:6}}>{fmtUSD(BigInt(Math.floor(netWorth * 1e18)), monPrice)}</div>
            <div className="text-t2 text-sm font-mono mb-3">{netWorth.toFixed(4)} MON</div>
            <div className="flex justify-center gap-2 mb-2" style={{flexWrap:'wrap'}}>
              <span className={`tier-badge ${walletTier}`}>{walletTier === 'whale' ? '🐋 Whale' : walletTier === 'dolphin' ? '🐬 Dolphin' : walletTier === 'crab' ? '🦀 Crab' : walletTier === 'royalty' ? '👑 Royalty' : '🦐 Shrimp'}</span>
              <span className="tag">{fmtAddr(wallet)}</span>
              {realizedPnL !== 0 && <span className={`tag ${realizedPnL > 0 ? 'tag-green' : ''}`} style={realizedPnL < 0 ? {background:'rgba(248,113,113,0.15)', color:'var(--red)', borderColor:'rgba(248,113,113,0.3)'} : {}}>{realizedPnL > 0 ? '📈' : '📉'} {realizedPnL > 0 ? '+' : ''}{realizedPnL.toFixed(2)} MON realized</span>}
            </div>
          </div>
        </div>

        {/* QUICK STATS */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10, marginBottom:16}}>
          <div className="card" style={{padding:14}}>
            <div className="text-xs text-t3 mb-1">💎 Holdings</div>
            <div className="font-mono font-bold text-base">{fmtUSD(BigInt(Math.floor(totalHoldingsMon * 1e18)), monPrice)}</div>
            <div className="text-xs text-t4 mt-1">{holdings.length} tokens</div>
          </div>
          <div className="card" style={{padding:14}}>
            <div className="text-xs text-t3 mb-1">🥩 Staked</div>
            <div className="font-mono font-bold text-base">{fmtUSD(BigInt(Math.floor(totalStakedMon * 1e18)), monPrice)}</div>
            <div className="text-xs text-t4 mt-1">{stakes.length} positions</div>
          </div>
          <div className="card" style={{padding:14, background:'rgba(74,222,128,0.05)', borderColor:'rgba(74,222,128,0.3)'}}>
            <div className="text-xs text-t3 mb-1">💰 Claimable</div>
            <div className="font-mono font-bold text-base text-green">{totalPending.toFixed(4)} MON</div>
            <div className="text-xs text-t4 mt-1">across {stakes.filter(s => Number(s.pendingReward) > 0).length} stakes</div>
          </div>
          <div className="card" style={{padding:14}}>
            <div className="text-xs text-t3 mb-1">⛽ MON Balance</div>
            <div className="font-mono font-bold text-base">{monBal.toFixed(4)}</div>
            <div className="text-xs text-t4 mt-1">{fmtUSD(BigInt(Math.floor(monBal * 1e18)), monPrice)}</div>
          </div>
        </div>

        {/* TABS */}
        <div className="tabs" style={{margin:'8px 0 16px'}}>
          {[['holdings', '💎 Holdings'], ['stakes', '🥩 Stakes'], ['trades', '📊 Trades'], ['achievements', '🏆 Achievements']].map(([id, lbl]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        {/* HOLDINGS TAB */}
        {tab === 'holdings' && (
          loading ? <div className="text-center text-t3 dots" style={{padding:40}}>Loading holdings</div>
          : holdings.length === 0 ? (
            <div className="card text-center" style={{padding:40}}>
              <div style={{fontSize:48, marginBottom:14}}>💎</div>
              <div className="text-xl font-bold mb-2">No tokens yet</div>
              <p className="text-t3 mb-4 text-sm">Buy your first MonPad token to start collecting</p>
              <button className="btn btn-primary" onClick={() => router.push('/')}>Browse Tokens →</button>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
              {holdings.map(h => {
                const pnl = Number(h.realizedPnL || 0) + Number(h.unrealizedPnL || 0)
                const pnlPct = h.costBasis > 0 ? (pnl / Number(h.costBasis) / 1e18) * 100 : 0
                return (
                  <div key={h.tokenAddress} className="card" style={{cursor:'pointer'}} onClick={() => router.push(`/token/${h.tokenAddress}`)}>
                    <div className="flex justify-between items-center" style={{flexWrap:'wrap', gap:10}}>
                      <div className="flex items-center gap-3" style={{minWidth:0, flex:1}}>
                        <div style={{width:40, height:40, borderRadius:'var(--r)', background:'linear-gradient(135deg, var(--p), var(--p-deep))', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:14, flexShrink:0}}>{(h.symbol || '?').slice(0,2)}</div>
                        <div style={{minWidth:0, flex:1}}>
                          <div className="font-bold" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{h.name}</div>
                          <div className="font-mono text-xs text-t3">${h.symbol} · {fmtTokens(h.balance)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold">{fmtUSD(BigInt(Math.floor(Number(h.valueMon) * 1e18)), monPrice)}</div>
                        {pnl !== 0 && (
                          <div className={`text-xs font-mono ${pnl > 0 ? 'text-green' : 'text-red'}`}>
                            {pnl > 0 ? '+' : ''}{pnl.toFixed(3)} MON ({pnlPct > 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* STAKES TAB */}
        {tab === 'stakes' && (
          loading ? <div className="text-center text-t3 dots" style={{padding:40}}>Loading stakes</div>
          : stakes.length === 0 ? (
            <div className="card text-center" style={{padding:40}}>
              <div style={{fontSize:48, marginBottom:14}}>🥩</div>
              <div className="text-xl font-bold mb-2">No active stakes</div>
              <p className="text-t3 mb-4 text-sm">Stake any MonPad token to earn MON from sell-tax</p>
              <button className="btn btn-primary" onClick={() => router.push('/staking')}>Browse Pools →</button>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
              {stakes.map((s, i) => {
                const isLocked = Date.now() / 1000 < Number(s.unlockAt)
                return (
                  <div key={i} className="card" style={{cursor:'pointer'}} onClick={() => router.push(`/stake/${s.tokenAddress}`)}>
                    <div className="flex justify-between items-center mb-2" style={{flexWrap:'wrap', gap:8}}>
                      <div className="flex items-center gap-3" style={{minWidth:0, flex:1}}>
                        <div style={{width:40, height:40, borderRadius:'var(--r)', background:'linear-gradient(135deg, var(--p), var(--p-deep))', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:14, flexShrink:0}}>{(s.symbol || '?').slice(0,2)}</div>
                        <div style={{minWidth:0}}>
                          <div className="font-bold">{s.symbol}</div>
                          <div className="text-xs text-t3 font-mono">{fmtTokens(s.amount)} staked</div>
                        </div>
                      </div>
                      <span className={`tag ${isLocked ? '' : 'tag-green'}`}>{['30d', '90d', '180d', '365d'][s.tier] || '?'} · {[1, 1.5, 2.5, 4][s.tier] || 1}x</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="text-xs text-t3">{isLocked ? `🔒 Unlocks ${new Date(Number(s.unlockAt) * 1000).toLocaleDateString()}` : '🔓 Unlocked'}</div>
                      <div className="font-mono font-bold text-green">+{fmtMON(s.pendingReward)} MON</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* TRADES TAB */}
        {tab === 'trades' && (
          loading ? <div className="text-center text-t3 dots" style={{padding:40}}>Loading trades</div>
          : trades.length === 0 ? (
            <div className="card text-center" style={{padding:40}}>
              <div style={{fontSize:48, marginBottom:14}}>📊</div>
              <div className="text-xl font-bold mb-2">No trades yet</div>
              <p className="text-t3 text-sm">Your trade history will appear here</p>
            </div>
          ) : (
            <div className="card" style={{padding:0, overflow:'hidden'}}>
              <table style={{width:'100%', fontSize:12}}>
                <thead style={{borderBottom:'1px solid var(--bd)'}}>
                  <tr>
                    <th style={{textAlign:'left', padding:12, color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Type</th>
                    <th style={{textAlign:'left', padding:12, color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Token</th>
                    <th style={{textAlign:'right', padding:12, color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>MON</th>
                    <th style={{textAlign:'right', padding:12, color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)', cursor:'pointer'}} onClick={() => router.push(`/token/${t.tokenAddress}`)}>
                      <td style={{padding:12}}>
                        <span style={{fontSize:10, padding:'2px 6px', borderRadius:4, background: t.type === 'buy' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: t.type === 'buy' ? 'var(--green)' : 'var(--red)', fontWeight:700}}>{(t.type || 'BUY').toUpperCase()}</span>
                      </td>
                      <td style={{padding:12}}>
                        <div className="font-bold text-xs">${t.symbol || '???'}</div>
                      </td>
                      <td style={{padding:12, textAlign:'right', fontFamily:'var(--mono)'}}>{fmtMON(t.monAmount || '0')}</td>
                      <td style={{padding:12, textAlign:'right', color:'var(--t4)', fontSize:11}}>{t.timestamp ? timeAgo(t.timestamp) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ACHIEVEMENTS TAB */}
        {tab === 'achievements' && (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:10}}>
            {[
              { id: 'first_buy', icon: '🎯', title: 'First Buy', desc: 'Made your first trade' },
              { id: 'whale', icon: '🐋', title: 'Whale', desc: 'Hold 10M+ MONSHI' },
              { id: 'royalty', icon: '👑', title: 'Royalty', desc: 'Top 1% holder' },
              { id: 'diamond_hands', icon: '💎', title: 'Diamond Hands', desc: 'Stake for 365d' },
              { id: 'creator', icon: '🚀', title: 'Creator', desc: 'Launched a token' },
              { id: 'graduate', icon: '🎓', title: 'Graduate', desc: 'Token reached graduation' },
            ].map(a => {
              const earned = achievements.find(x => x.id === a.id)
              return (
                <div key={a.id} className="card text-center" style={{padding:16, opacity: earned ? 1 : 0.4, borderColor: earned ? 'var(--p)' : 'var(--bd)'}}>
                  <div style={{fontSize:32, marginBottom:8}}>{a.icon}</div>
                  <div className="font-bold text-sm mb-1">{a.title}</div>
                  <div className="text-xs text-t3">{a.desc}</div>
                  {earned && <div className="tag tag-gold mt-2" style={{fontSize:9}}>EARNED</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

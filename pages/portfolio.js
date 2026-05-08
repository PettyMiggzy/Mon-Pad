// V2.1 unified user hub. Replaces the old portfolio + profile split.
// Hero with wallet tier, stats grid, tabs for: Holdings | Created | Stakes | Trades | Achievements | Referrals.

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useBalance, usePublicClient } from 'wagmi'
import Layout from '../components/Layout'
import { fmtMON, fmtUSD, fmtTokens, fmtAddr, timeAgo, MONSHI_TOKEN, CURVE_ABI } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Hub() {
  const router = useRouter()
  const { address: wallet, isConnected } = useAccount()
  const { data: monBalance } = useBalance({ address: wallet })
  const publicClient = usePublicClient({ chainId: monad.id })

  const [holdings, setHoldings] = useState([])
  const [stakes, setStakes] = useState([])
  const [trades, setTrades] = useState([])
  const [achievements, setAchievements] = useState([])
  const [allTokens, setAllTokens] = useState([])      // for Created-tab filter
  const [createdEnriched, setCreatedEnriched] = useState([])  // with creatorPending/totalCreatorFees
  const [monPrice, setMonPrice] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('holdings')
  const [copied, setCopied] = useState(false)

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
      const [h, s, t, a, all] = await Promise.all([
        fetch(`${SERVER}/api/portfolio/${wallet}/holdings`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/staking/positions/${wallet}`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/portfolio/${wallet}/trades?limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/portfolio/${wallet}/achievements`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/tokens`).then(r => r.ok ? r.json() : []).catch(() => []),
      ])
      if (Array.isArray(h)) setHoldings(h)
      if (Array.isArray(s)) setStakes(s)
      if (Array.isArray(t)) setTrades(t)
      if (Array.isArray(a)) setAchievements(a)
      if (Array.isArray(all)) setAllTokens(all)
    } catch {}
    setLoading(false)
  }

  // Created-tokens enrichment: for each token launched by this wallet, multicall the curve
  // to read totalCreatorFees + creatorPending + bondedBps live. The base /api/tokens response
  // doesn't include creatorPending (added in V2.1, not in the indexer's read set).
  useEffect(() => {
    if (!wallet || !publicClient || allTokens.length === 0) { setCreatedEnriched([]); return }
    const myCreated = allTokens.filter(t => t.creator?.toLowerCase() === wallet.toLowerCase())
    if (myCreated.length === 0) { setCreatedEnriched([]); return }

    let cancelled = false
    ;(async () => {
      try {
        const calls = []
        for (const t of myCreated) {
          calls.push({ address: t.curveAddress, abi: CURVE_ABI, functionName: 'totalCreatorFees' })
          calls.push({ address: t.curveAddress, abi: CURVE_ABI, functionName: 'bondedBps' })
          // creatorPending may not be in CURVE_ABI export yet (V2.1-5 added). Read via raw call below.
        }
        const results = await publicClient.multicall({ contracts: calls, allowFailure: true })

        // creatorPending raw read (no ABI dep): selector 0xc1eb538b for creatorPending()
        // Actually safer: do per-token readContract with an inline ABI fragment.
        const pendingResults = await Promise.all(myCreated.map(t =>
          publicClient.readContract({
            address: t.curveAddress,
            abi: [{ name: 'creatorPending', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
            functionName: 'creatorPending',
          }).catch(() => 0n)
        ))

        if (cancelled) return
        const out = myCreated.map((t, i) => {
          const earned = results[i*2]?.status === 'success' ? results[i*2].result : 0n
          const bonded = results[i*2+1]?.status === 'success' ? results[i*2+1].result : 0n
          return {
            ...t,
            totalCreatorFees: earned.toString(),
            bondedBps: bonded.toString(),
            creatorPending: pendingResults[i].toString(),
          }
        })
        setCreatedEnriched(out)
      } catch (e) {
        console.warn('createdEnriched fetch:', e)
      }
    })()

    return () => { cancelled = true }
  }, [wallet, publicClient, allTokens])

  // ── Aggregate stats ───────────────────────────────────────
  const totalHoldingsMon = holdings.reduce((a, h) => a + Number(h.valueMon || 0), 0)
  const totalStakedMon   = stakes.reduce((a, s) => a + Number(s.valueMon || 0), 0)
  const totalPending     = stakes.reduce((a, s) => a + Number(s.pendingReward || 0) / 1e18, 0)
  const monBal = monBalance ? Number(monBalance.value) / 1e18 : 0
  const netWorth = totalHoldingsMon + totalStakedMon + monBal + totalPending
  const realizedPnL = trades.reduce((a, t) => a + (Number(t.realizedPnL) || 0), 0)
  const claimableCreator = createdEnriched.reduce(
    (a, t) => a + Number(t.creatorPending || 0) / 1e18, 0
  )
  const totalCreatorEarned = createdEnriched.reduce(
    (a, t) => a + Number(t.totalCreatorFees || 0) / 1e18, 0
  )

  // Wallet tier from MONSHI holdings (audit V2.1 noted MONSHI isn't in tokenIndex by default —
  // we read it from the holdings response which uses tokenIndex multicall, so it'll only
  // appear if MONSHI was launched on MonPad. For now this stays "shrimp" for non-MonPad MONSHI;
  // use an explicit balanceOf call for accuracy.
  const monshiHolding = holdings.find(h => h.tokenAddress?.toLowerCase() === MONSHI_TOKEN.toLowerCase())
  const monshiBalance = Number(monshiHolding?.balance || 0) / 1e18
  let walletTier = 'shrimp'
  if (monshiBalance >= 10_000_000) walletTier = 'whale'
  else if (monshiBalance >= 1_000_000) walletTier = 'dolphin'
  else if (monshiBalance >= 100_000) walletTier = 'crab'
  if (achievements.find(a => a.id === 'royalty')) walletTier = 'royalty'

  const tierMeta = {
    shrimp:   { emoji: '🦐', label: 'Shrimp' },
    crab:     { emoji: '🦀', label: 'Crab' },
    dolphin:  { emoji: '🐬', label: 'Dolphin' },
    whale:    { emoji: '🐋', label: 'Whale' },
    royalty:  { emoji: '👑', label: 'Royalty' },
  }[walletTier]

  const refLink = typeof window !== 'undefined' && wallet ? `${window.location.origin}/create?ref=${wallet}` : ''
  function copyLink() {
    if (!refLink) return
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!isConnected) {
    return (
      <Layout title="My Hub">
        <div className="container" style={{padding:'40px 16px', textAlign:'center'}}>
          <div className="card" style={{padding:40, maxWidth:420, margin:'0 auto'}}>
            <div style={{fontSize:48, marginBottom:14}}>💎</div>
            <div className="text-xl font-bold mb-2">Connect Wallet</div>
            <p className="text-t3 text-sm">Connect your wallet to see your holdings, stakes, P&amp;L, and achievements.</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="My Hub">
      <div className="container" style={{paddingBottom:60}}>

        {/* HUB HERO */}
        <div className="hub-hero">
          <div className="hub-hero-glow" />
          <div style={{position:'relative', zIndex:1, display:'flex', alignItems:'center', gap:18, flexWrap:'wrap'}}>
            <div className="hub-avatar">{wallet ? wallet.slice(2, 4).toUpperCase() : '?'}</div>
            <div style={{flex:1, minWidth:180}}>
              <div className="text-xs text-t3 font-bold mb-1" style={{letterSpacing:2}}>NET WORTH</div>
              <div className="hero-title" style={{fontSize:'clamp(28px,6vw,44px)', marginBottom:4}}>
                {fmtUSD(BigInt(Math.floor(netWorth * 1e18)), monPrice)}
              </div>
              <div className="text-t2 text-sm font-mono mb-2">{netWorth.toFixed(4)} MON</div>
              <div className="flex gap-2" style={{flexWrap:'wrap'}}>
                <span className={`tier-badge ${walletTier}`}>{tierMeta.emoji} {tierMeta.label}</span>
                <span className="tag font-mono">{fmtAddr(wallet)}</span>
                {realizedPnL !== 0 && (
                  <span className={`tag ${realizedPnL > 0 ? 'tag-green' : ''}`}
                    style={realizedPnL < 0 ? {background:'rgba(248,113,113,0.15)', color:'var(--red)', borderColor:'rgba(248,113,113,0.3)'} : {}}>
                    {realizedPnL > 0 ? '📈 +' : '📉 '}{realizedPnL.toFixed(2)} MON realized
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* STATS GRID */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10, marginBottom:16}}>
          <div className="hub-stat-tile accent">
            <div className="hub-stat-tile-label">💎 Holdings</div>
            <div className="hub-stat-tile-value">{fmtUSD(BigInt(Math.floor(totalHoldingsMon * 1e18)), monPrice)}</div>
            <div className="hub-stat-tile-sub">{holdings.length} token{holdings.length === 1 ? '' : 's'}</div>
          </div>
          <div className="hub-stat-tile">
            <div className="hub-stat-tile-label">🥩 Staked</div>
            <div className="hub-stat-tile-value">{fmtUSD(BigInt(Math.floor(totalStakedMon * 1e18)), monPrice)}</div>
            <div className="hub-stat-tile-sub">{stakes.length} position{stakes.length === 1 ? '' : 's'}</div>
          </div>
          <div className="hub-stat-tile" style={{background:'rgba(74,222,128,0.05)', borderColor:'rgba(74,222,128,0.3)'}}>
            <div className="hub-stat-tile-label">💰 Claimable rewards</div>
            <div className="hub-stat-tile-value text-green">{totalPending.toFixed(4)} MON</div>
            <div className="hub-stat-tile-sub">across {stakes.filter(s => Number(s.pendingReward) > 0).length} stake{stakes.filter(s => Number(s.pendingReward) > 0).length === 1 ? '' : 's'}</div>
          </div>
          {createdEnriched.length > 0 && (
            <div className="hub-stat-tile" style={{background:'rgba(168,85,247,0.05)', borderColor:'rgba(168,85,247,0.3)'}}>
              <div className="hub-stat-tile-label">🚀 Creator earned</div>
              <div className="hub-stat-tile-value text-purple">{totalCreatorEarned.toFixed(2)} MON</div>
              <div className="hub-stat-tile-sub">{claimableCreator.toFixed(2)} MON pending claim</div>
            </div>
          )}
          <div className="hub-stat-tile">
            <div className="hub-stat-tile-label">⛽ MON balance</div>
            <div className="hub-stat-tile-value">{monBal.toFixed(4)}</div>
            <div className="hub-stat-tile-sub">{fmtUSD(BigInt(Math.floor(monBal * 1e18)), monPrice)}</div>
          </div>
        </div>

        {/* TABS */}
        <div className="tabs" style={{margin:'8px 0 16px'}}>
          {[
            ['holdings', '💎 Holdings'],
            ['created', `🚀 Created${createdEnriched.length > 0 ? ` (${createdEnriched.length})` : ''}`],
            ['stakes', '🥩 Stakes'],
            ['trades', '📊 Trades'],
            ['achievements', '🏆 Achievements'],
            ['referrals', '🔗 Referrals'],
          ].map(([id, lbl]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        {/* HOLDINGS */}
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
                const costBasisMon = Number(h.costBasis || 0) / 1e18
                const pnlPct = costBasisMon > 0 ? (pnl / costBasisMon) * 100 : 0
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

        {/* CREATED */}
        {tab === 'created' && (
          loading ? <div className="text-center text-t3 dots" style={{padding:40}}>Loading your tokens</div>
          : createdEnriched.length === 0 ? (
            <div className="card text-center" style={{padding:40}}>
              <div style={{fontSize:48, marginBottom:14}}>🚀</div>
              <div className="text-xl font-bold mb-2">You haven't launched any tokens</div>
              <p className="text-t3 mb-4 text-sm">Launch a token to start earning 2% of all volume — forever.</p>
              <button className="btn btn-primary" onClick={() => router.push('/create')}>Launch Token →</button>
            </div>
          ) : (
            <div className="mytok">
              {createdEnriched.map(t => {
                const pct = Number(t.bondedBps || 0) / 100
                const pending = Number(t.creatorPending || 0) / 1e18
                const earned = Number(t.totalCreatorFees || 0) / 1e18
                return (
                  <div key={t.tokenAddress} className={`mytok-card ${t.graduated ? 'graduated' : ''}`} onClick={() => router.push(`/token/${t.tokenAddress}`)}>
                    <div className="flex justify-between items-start mb-2">
                      <div style={{minWidth:0, flex:1}}>
                        <div className="font-bold" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.name}</div>
                        <div className="font-mono text-xs text-t3">${t.symbol}</div>
                      </div>
                      {t.graduated && <span className="tag tag-gold">GRAD</span>}
                    </div>
                    {!t.graduated && (
                      <>
                        <div className="tcard-progress">
                          <div className="tcard-progress-fill" style={{width:`${Math.min(pct, 100)}%`}} />
                        </div>
                        <div className="text-xs text-t4 mt-1 font-mono">{pct.toFixed(1)}% to grad</div>
                      </>
                    )}
                    <div className="mytok-earned">
                      <span className="text-t3">Earned</span>
                      <span className="font-mono font-bold text-purple">{earned.toFixed(2)} MON</span>
                    </div>
                    {pending > 0.000001 && (
                      <div className="mytok-earned" style={{borderTop:'none', paddingTop:0, marginTop:4}}>
                        <span className="text-green text-xs">💰 Claimable</span>
                        <span className="font-mono font-bold text-green">{pending.toFixed(4)} MON</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* STAKES */}
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

        {/* TRADES */}
        {tab === 'trades' && (
          loading ? <div className="text-center text-t3 dots" style={{padding:40}}>Loading trades</div>
          : trades.length === 0 ? (
            <div className="card text-center" style={{padding:40}}>
              <div style={{fontSize:48, marginBottom:14}}>📊</div>
              <div className="text-xl font-bold mb-2">No trades yet</div>
              <p className="text-t3 text-sm">Your trade history will appear here</p>
            </div>
          ) : (
            <div className="ticker">
              {trades.map((t, i) => (
                <div key={i} className={`ticker-row ${t.type === 'buy' ? 'buy' : 'sell'}`} style={{cursor:'pointer'}} onClick={() => router.push(`/token/${t.tokenAddress}`)}>
                  <span className={`ticker-pill ${t.type === 'buy' ? 'buy' : 'sell'}`}>{t.type === 'buy' ? 'B' : 'S'}</span>
                  <span><span className="font-bold">${t.symbol || '???'}</span></span>
                  <span className="ticker-amt">{fmtMON(t.monAmount || '0')} MON</span>
                  <span className="ticker-time">{t.timestamp ? timeAgo(t.timestamp) : '—'}</span>
                </div>
              ))}
            </div>
          )
        )}

        {/* ACHIEVEMENTS */}
        {tab === 'achievements' && (
          <div className="achv-grid">
            {[
              { id: 'first_buy',     icon: '🎯', title: 'First Buy',     desc: 'Made your first trade' },
              { id: 'whale',         icon: '🐋', title: 'Whale',         desc: 'Hold 10M+ MONSHI' },
              { id: 'royalty',       icon: '👑', title: 'Royalty',       desc: 'Top 1% holder' },
              { id: 'diamond_hands', icon: '💎', title: 'Diamond Hands', desc: 'Stake for 365d' },
              { id: 'creator',       icon: '🚀', title: 'Creator',       desc: 'Launched a token' },
              { id: 'graduate',      icon: '🎓', title: 'Graduate',      desc: 'Token reached graduation' },
            ].map(a => {
              const earned = !!achievements.find(x => x.id === a.id)
              return (
                <div key={a.id} className={`achv-tile ${earned ? 'earned' : 'locked'}`}>
                  <div className="achv-icon">{a.icon}</div>
                  <div className="achv-title">{a.title}</div>
                  <div className="achv-desc">{a.desc}</div>
                  <div className="achv-progress">
                    <div className="achv-progress-fill" style={{width: earned ? '100%' : '0%'}} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* REFERRALS */}
        {tab === 'referrals' && (
          <div className="card" style={{padding:24, background:'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(34,211,238,0.04))'}}>
            <div className="font-bold text-base mb-2">🔗 Your Referral Link</div>
            <p className="text-t3 text-xs mb-4">Share this link. When someone launches a token through it, they're tagged as your referral and you earn from their trades.</p>
            <div className="flex gap-2 mb-4">
              <input className="input" value={refLink} readOnly style={{fontSize:11, fontFamily:'var(--mono)'}} />
              <button className={`btn ${copied ? 'btn-green' : 'btn-primary'}`} onClick={copyLink}>{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
            <div className="flex gap-2">
              <a className="btn btn-ghost btn-sm" style={{flex:1}}
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent('Launching on @Monshi_Monpad — fair launch on @monad_xyz, devs earn 2% forever 🚀')}&url=${encodeURIComponent(refLink)}`}
                target="_blank" rel="noreferrer">Share on 𝕏</a>
              <a className="btn btn-ghost btn-sm" style={{flex:1}}
                href={`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Launch your token on MonPad — fair launch on Monad')}`}
                target="_blank" rel="noreferrer">Share on TG</a>
            </div>
            <div className="mt-4" style={{padding:12, background:'rgba(0,0,0,0.3)', borderRadius:'var(--r-sm)', fontSize:12, color:'var(--t3)'}}>
              💡 You earn from buy/sell fees on tokens launched via your link, forever. Your address is set as the <code>referrer</code> on those tokens at launch.
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

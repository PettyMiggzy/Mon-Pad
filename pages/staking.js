import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import Layout from '../components/Layout'
import { fmtMON, fmtUSD, fmtTokens, fmtAddr, STAKING_POOL_ABI } from '../lib/constants'
import { resolveTokenImage } from '../lib/tokenImage'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function StakingDashboard() {
  const router = useRouter()
  const { address: wallet, isConnected } = useAccount()
  const [pools, setPools] = useState([])
  const [myStakes, setMyStakes] = useState([])
  const [hub, setHub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [monPrice, setMonPrice] = useState(0)

  useEffect(() => {
    if (!SERVER) { setLoading(false); return }
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
    loadAll()
    const iv = setInterval(loadAll, 12000)
    return () => clearInterval(iv)
  }, [wallet])

  async function loadAll() {
    if (!SERVER) return
    try {
      const p = await fetch(`${SERVER}/api/staking/pools`).then(r => r.ok ? r.json() : []).catch(() => [])
      if (Array.isArray(p)) setPools(p)
      const h = await fetch(`${SERVER}/api/staking/hub`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (h) setHub(h)
      if (wallet) {
        const my = await fetch(`${SERVER}/api/staking/positions/${wallet}`).then(r => r.ok ? r.json() : []).catch(() => [])
        if (Array.isArray(my)) setMyStakes(my)
      }
    } catch {}
    setLoading(false)
  }

  return (
    <Layout title="Staking">
      <div className="container" style={{paddingBottom:60}}>
        <div className="hero" style={{marginTop:16, marginBottom:16}}>
          <div style={{position:'relative', zIndex:1}}>
            <h1 className="hero-title">🥩 Staking Hub</h1>
            <p className="hero-sub">Stake any MonPad token. Earn MON. Up to 4x boost for diamond hands.</p>
            <div className="flex gap-6 justify-center mt-4 text-xs" style={{flexWrap:'wrap'}}>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-purple">{pools.length}</div>
                <div className="text-t4">POOLS</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-gold">{hub ? fmtMON(hub.totalDistributed || '0') : '—'}</div>
                <div className="text-t4">MON DISTRIBUTED</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-cyan">{hub ? hub.totalStakers || '0' : '—'}</div>
                <div className="text-t4">STAKERS</div>
              </div>
            </div>
          </div>
        </div>

        {/* MY STAKES */}
        {isConnected && myStakes.length > 0 && (
          <>
            <h2 className="text-lg font-black mb-3">💎 My Active Stakes</h2>
            <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12, marginBottom:24}}>
              {myStakes.map((s, i) => (
                <div key={i} className="card flex justify-between items-center" style={{flexWrap:'wrap', gap:10, cursor:'pointer'}} onClick={() => router.push(`/stake/${s.tokenAddress}`)}>
                  <div className="flex items-center gap-3" style={{minWidth:0}}>
                    <div style={{width:40, height:40, borderRadius:'var(--r)', background:'linear-gradient(135deg, var(--p), var(--p-deep))', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:14, flexShrink:0}}>
                      {(s.symbol || '?').slice(0,2)}
                    </div>
                    <div>
                      <div className="font-bold">{s.symbol}</div>
                      <div className="text-xs text-t3">Staked: <span className="font-mono">{fmtTokens(s.totalStaked)}</span></div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-green">+{fmtMON(s.pendingReward)} MON</div>
                    <div className="text-xs text-t3">claimable</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ALL POOLS */}
        <h2 className="text-lg font-black mb-3">🥩 All Staking Pools</h2>
        {loading ? (
          <div className="text-center text-t3 dots" style={{padding:40}}>Loading pools</div>
        ) : pools.length === 0 ? (
          <div className="card text-center" style={{padding:40}}>
            <div style={{fontSize:48, marginBottom:14}}>🥩</div>
            <div className="text-xl font-bold mb-2">No Staking Pools Yet</div>
            <p className="text-t3 mb-4 text-sm">Be the first to create one. Free for 1M+ MONSHI holders, 200 MON otherwise (→ buyback).</p>
            <button className="btn btn-primary" onClick={() => router.push('/')}>Browse Tokens</button>
          </div>
        ) : (
          <div className="token-grid">
            {pools.map(p => <PoolCard key={p.address} p={p} onClick={() => router.push(`/stake/${p.tokenAddress}`)} />)}
          </div>
        )}

        {/* HOW IT WORKS */}
        <div className="card mt-6" style={{background:'rgba(168,85,247,0.05)', borderColor:'var(--bd2)'}}>
          <div className="font-bold mb-3 text-base">📖 How Staking Works</div>
          <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:8, fontSize:13, color:'var(--t2)'}}>
            <li>• <strong>Sell tax 0.5%</strong> from each token's trades flows to its staking pool</li>
            <li>• <strong>40%</strong> goes to the MONSHI pool, <strong>60%</strong> distributed across other pools by trading volume</li>
            <li>• <strong>4 lock tiers:</strong> 30d (1x), 90d (1.5x), 180d (2.5x), 365d (4x reward boost)</li>
            <li>• <strong>Early unstake:</strong> 10% fee on tokens + ALL pending rewards forfeited (boosts other stakers)</li>
            <li>• Anyone can <strong>create a pool</strong> — free for 1M+ MONSHI holders, 200 MON otherwise (→ buyback)</li>
          </ul>
        </div>
      </div>
    </Layout>
  )
}


function PoolCard({ p, onClick }) {
  // Resolve underlying token address: prefer API-provided p.tokenAddress, fall back to pool.token() on-chain.
  const tokenAddrFromApi = p.tokenAddress && p.tokenAddress.length === 42 ? p.tokenAddress : null

  const { data: tokenAddrOnChain } = useReadContract({
    address: p.address,
    abi: STAKING_POOL_ABI,
    functionName: 'token',
    query: { enabled: !tokenAddrFromApi && !!p.address },
  })

  const tokenAddress = tokenAddrFromApi || tokenAddrOnChain || null

  // Read on-chain symbol() for a generic, source-of-truth label.
  const { data: onChainSymbol } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !!tokenAddress },
  })

  // Resolve token image via the generic chain:
  // on-chain tokenURI -> server meta -> Monad token-list -> Monshi fallback -> null.
  const [resolvedImage, setResolvedImage] = useState(null)
  useEffect(() => {
    if (!tokenAddress) return
    let cancelled = false
    resolveTokenImage(tokenAddress, { serverUrl: SERVER })
      .then(img => { if (!cancelled) setResolvedImage(img) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tokenAddress])

  // Fallbacks: prefer on-chain symbol, then API symbol if non-placeholder, else dash. Special-case Monshi for image.
  const symbol = onChainSymbol || (p.symbol && p.symbol !== 'TOKEN' ? p.symbol : null) || '—'
  const image = resolvedImage

  return (
    <div className="card" style={{cursor:'pointer'}} onClick={onClick}>
      <div className="flex items-center gap-3 mb-3">
        {image ? (
          <img src={image} alt={symbol} style={{width:48, height:48, borderRadius:'var(--r)', objectFit:'cover'}} />
        ) : (
          <div style={{width:48, height:48, borderRadius:'var(--r)', background:'linear-gradient(135deg, var(--p), var(--p-deep))', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:16}}>
            {(symbol || '?').slice(0,2)}
          </div>
        )}
        <div style={{minWidth:0, flex:1}}>
          <div className="font-bold">{p.name || symbol}</div>
          <div className="font-mono text-xs text-t3">${symbol}</div>
        </div>
      </div>
      <div className="text-xs text-t3 mb-1">Total Staked</div>
      <div className="font-mono font-bold text-base mb-2">{fmtTokens(p.totalStaked || 0)} ${symbol}</div>
      <div className="text-xs text-t3 mb-1">Lifetime Rewards</div>
      <div className="font-mono font-bold text-green">{fmtMON(p.totalRewards || 0)} MON</div>
      <button className="btn btn-primary btn-sm btn-block mt-3">Stake →</button>
    </div>
  )
}

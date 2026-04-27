import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import Layout from '../../components/Layout'
import { STAKING_POOL_ABI, TOKEN_ABI, fmtMON, fmtTokens, fmtAddr, fmtDuration, MONADSCAN, POOL_FACTORY_V2 } from '../../lib/constants'
import { monad } from '../../lib/wagmi'

const TIERS = [
  { idx: 0, label: '30 DAYS', mult: 1.0, color: 'var(--t2)', desc: 'Casual stake' },
  { idx: 1, label: '90 DAYS', mult: 1.5, color: 'var(--cyan)', desc: 'Real conviction' },
  { idx: 2, label: '180 DAYS', mult: 2.5, color: 'var(--p2)', desc: 'Diamond hands' },
  { idx: 3, label: '365 DAYS', mult: 4.0, color: 'var(--gold)', desc: 'Maxi mode' },
]

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function StakePage() {
  const router = useRouter()
  const { address: tokenAddr } = router.query
  const { address: wallet, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: monad.id })

  const [pool, setPool] = useState(null)
  const [tokenInfo, setTokenInfo] = useState(null)
  const [tokenBalance, setTokenBalance] = useState(0n)
  const [stakes, setStakes] = useState([])
  const [pendingTotal, setPendingTotal] = useState(0n)
  const [tier, setTier] = useState(0)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!tokenAddr) return
    loadAll()
    const iv = setInterval(loadAll, 8000)
    return () => clearInterval(iv)
  }, [tokenAddr, wallet])

  useEffect(() => { if (isSuccess) loadAll() }, [isSuccess])

  async function loadAll() {
    if (!tokenAddr) return
    try {
      let poolAddr
      if (SERVER) {
        const r = await fetch(`${SERVER}/api/staking/pool/${tokenAddr}`).then(r => r.ok ? r.json() : null).catch(() => null)
        if (r?.pool) poolAddr = r.pool
      }
      if (!poolAddr && POOL_FACTORY_V2 && publicClient) {
        try {
          poolAddr = await publicClient.readContract({
            address: POOL_FACTORY_V2,
            abi: [{ name: 'tokenToPool', type: 'function', stateMutability: 'view', inputs: [{type:'address'}], outputs: [{type:'address'}] }],
            functionName: 'tokenToPool',
            args: [tokenAddr],
          })
        } catch {}
      }
      
      if (publicClient) {
        try {
          const [name, symbol] = await Promise.all([
            publicClient.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'name' }),
            publicClient.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'symbol' }),
          ])
          setTokenInfo({ name, symbol })
          if (wallet) {
            const bal = await publicClient.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'balanceOf', args: [wallet] })
            setTokenBalance(BigInt(bal || 0))
          }
        } catch {}
      }

      if (poolAddr && poolAddr !== '0x0000000000000000000000000000000000000000') {
        setPool({ address: poolAddr })
        if (wallet && publicClient) {
          try {
            const count = await publicClient.readContract({ address: poolAddr, abi: STAKING_POOL_ABI, functionName: 'userStakeCount', args: [wallet] })
            const myStakes = []
            for (let i = 0; i < Number(count); i++) {
              const s = await publicClient.readContract({ address: poolAddr, abi: STAKING_POOL_ABI, functionName: 'getStake', args: [wallet, BigInt(i)] })
              const reward = await publicClient.readContract({ address: poolAddr, abi: STAKING_POOL_ABI, functionName: 'pendingReward', args: [wallet, BigInt(i)] })
              myStakes.push({ idx: i, ...s, pendingReward: reward })
            }
            setStakes(myStakes)
            const totalPending = await publicClient.readContract({ address: poolAddr, abi: STAKING_POOL_ABI, functionName: 'pendingTotal', args: [wallet] })
            setPendingTotal(BigInt(totalPending || 0))
          } catch (e) { console.warn('stake load', e) }
        }
      } else {
        setPool(null)
      }
    } catch (e) { console.warn(e) }
    setLoading(false)
  }

  async function approveAndStake() {
    if (!pool || !amount || parseFloat(amount) <= 0) return
    const amt = parseEther(amount.toString())
    try {
      const allowance = await publicClient.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'allowance', args: [wallet, pool.address] })
      if (BigInt(allowance) < amt) {
        writeContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'approve', args: [pool.address, BigInt(2) ** BigInt(256) - BigInt(1)], chainId: monad.id })
        return
      }
      writeContract({ address: pool.address, abi: STAKING_POOL_ABI, functionName: 'stake', args: [amt, tier], chainId: monad.id })
    } catch (e) { console.error(e) }
  }

  function claim(stakeIdx) {
    writeContract({ address: pool.address, abi: STAKING_POOL_ABI, functionName: 'claim', args: [BigInt(stakeIdx)], chainId: monad.id })
  }

  function unstake(stakeIdx) {
    if (!confirm('Unstake? If still locked, you will lose 10% of tokens AND all rewards.')) return
    writeContract({ address: pool.address, abi: STAKING_POOL_ABI, functionName: 'unstake', args: [BigInt(stakeIdx)], chainId: monad.id })
  }

  function claimAll() {
    writeContract({ address: pool.address, abi: STAKING_POOL_ABI, functionName: 'claimAll', args: [], chainId: monad.id })
  }

  return (
    <Layout showBack title={`Stake ${tokenInfo?.symbol || ''}`}>
      <div className="container" style={{maxWidth:760, paddingBottom:60}}>
        {loading ? (
          <div className="text-center text-t3 dots" style={{padding:60}}>Loading staking pool</div>
        ) : !pool ? (
          <div className="card text-center" style={{padding:40}}>
            <div style={{fontSize:48, marginBottom:14}}>🥩</div>
            <div className="text-xl font-bold mb-2">No Staking Pool Yet</div>
            <p className="text-t3 mb-4 text-sm">This token does not have a staking pool. Anyone can create one — free for 1M+ MONSHI holders, 200 MON otherwise.</p>
            <button className="btn btn-primary">Create Pool</button>
          </div>
        ) : (
          <>
            <div className="hero" style={{padding:'24px 18px', marginBottom:16}}>
              <div style={{position:'relative', zIndex:1}}>
                <div className="text-xs text-t3 font-bold mb-2" style={{letterSpacing:2}}>STAKING POOL</div>
                <h1 className="text-2xl font-black mb-2">${tokenInfo?.symbol || '...'} Pool</h1>
                <p className="text-sm text-t2 mb-4">Stake your tokens, earn MON rewards from sell-tax.</p>
                <div className="flex gap-4 justify-center text-xs" style={{flexWrap:'wrap'}}>
                  <div><div className="font-bold text-purple">4 tiers</div><div className="text-t4">30/90/180/365d</div></div>
                  <div><div className="font-bold text-gold">4x max</div><div className="text-t4">multiplier</div></div>
                  <div><div className="font-bold text-green">MON</div><div className="text-t4">rewards</div></div>
                </div>
              </div>
            </div>

            {isConnected && stakes.length > 0 && (
              <div className="card mb-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-bold text-base">💎 My Stakes</div>
                  {pendingTotal > 0n && <button className="btn btn-green btn-sm" onClick={claimAll} disabled={isPending || isConfirming}>Claim All ({fmtMON(pendingTotal)} MON)</button>}
                </div>
                {stakes.map(s => {
                  if (s.amount === 0n) return null
                  const tierInfo = TIERS[s.tier] || TIERS[0]
                  const isLocked = Date.now() / 1000 < Number(s.unlockAt)
                  return (
                    <div key={s.idx} className="p-3 mb-2 rounded" style={{background:'rgba(0,0,0,0.3)', border:'1px solid var(--bd)'}}>
                      <div className="flex justify-between items-center mb-2" style={{flexWrap:'wrap', gap:8}}>
                        <div className="flex items-center gap-2">
                          <span className="tag" style={{background:`${tierInfo.color}22`, color:tierInfo.color, borderColor:tierInfo.color}}>{tierInfo.label}</span>
                          <span className="text-xs text-t3">{tierInfo.mult}x boost</span>
                        </div>
                        <div className="text-xs text-t3">
                          {isLocked ? `🔒 Unlocks in ${fmtDuration(Number(s.unlockAt) - Date.now()/1000)}` : '🔓 Unlocked'}
                        </div>
                      </div>
                      <div className="flex justify-between items-center" style={{flexWrap:'wrap', gap:8}}>
                        <div>
                          <div className="font-mono font-bold">{fmtTokens(s.amount)} ${tokenInfo?.symbol}</div>
                          <div className="text-xs text-green font-mono">+{fmtMON(s.pendingReward)} MON</div>
                        </div>
                        <div className="flex gap-2">
                          {s.pendingReward > 0n && <button className="btn btn-ghost btn-sm" onClick={() => claim(s.idx)} disabled={isPending || isConfirming}>Claim</button>}
                          <button className={`btn btn-sm ${isLocked ? 'btn-red' : 'btn-ghost'}`} onClick={() => unstake(s.idx)} disabled={isPending || isConfirming}>{isLocked ? 'Force Unstake' : 'Unstake'}</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="card">
              <div className="font-bold text-base mb-3">🥩 Stake ${tokenInfo?.symbol || '...'}</div>

              <label className="input-label">Lock Tier</label>
              <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8, marginBottom:14}}>
                {TIERS.map(t => (
                  <button key={t.idx} onClick={() => setTier(t.idx)} className={`p-3 rounded text-left`} style={{background: tier === t.idx ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.3)', border: tier === t.idx ? '2px solid var(--p)' : '2px solid var(--bd)', color: 'var(--t1)', cursor:'pointer', transition:'all 0.15s'}}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-sm" style={{color: t.color}}>{t.label}</span>
                      <span className="font-mono font-bold" style={{color: t.color}}>{t.mult}x</span>
                    </div>
                    <div className="text-xs text-t3">{t.desc}</div>
                  </button>
                ))}
              </div>

              <label className="input-label flex justify-between">
                <span>Amount to stake</span>
                {isConnected && <span className="text-t3 font-normal">Balance: <span className="font-mono">{fmtTokens(tokenBalance)}</span></span>}
              </label>
              <input className="input" type="number" placeholder="0.0" value={amount} onChange={e => setAmount(e.target.value)} />
              <div className="flex gap-2 mt-2 mb-4">
                {[0.25, 0.5, 0.75, 1].map(p => (
                  <button key={p} className="btn btn-ghost btn-sm" style={{flex:1}} onClick={() => setAmount(formatEther((tokenBalance * BigInt(Math.floor(p*100))) / 100n))}>{p === 1 ? 'MAX' : `${p*100}%`}</button>
                ))}
              </div>

              <div className="card mb-3" style={{background:'rgba(252,211,77,0.05)', borderColor:'rgba(252,211,77,0.3)', padding:12, fontSize:12, color:'var(--gold)'}}>
                ⚠ Early unstake = 10% fee + ALL rewards forfeited (boosts other stakers)
              </div>

              {!isConnected ? (
                <div className="text-center text-t3 text-sm" style={{padding:20}}>Connect wallet to stake</div>
              ) : (
                <button className="btn btn-primary btn-block btn-lg" onClick={approveAndStake} disabled={isPending || isConfirming || !amount}>
                  {isPending ? '✍️ Confirm in wallet' : isConfirming ? '⏳ Staking...' : `🥩 Stake ${amount || '0'} for ${TIERS[tier].label}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

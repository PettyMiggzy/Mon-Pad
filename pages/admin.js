import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, fmtAddr, fmtMON } from '../lib/constants'
import { monad } from '../lib/wagmi'

export default function AdminPanel() {
  const { address: wallet, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: monad.id })
  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const [owner, setOwner] = useState(null)
  const [config, setConfig] = useState({})
  const [loading, setLoading] = useState(true)

  // Edit fields
  const [edits, setEdits] = useState({
    creationFee: '', graduationTarget: '', graduationCreatorReward: '',
    maxDevBuyBps: '', rewardRouter: '', blocklistAddr: '', blocklistVal: false
  })
  const [pause, setPause] = useState({ launches: false, buys: false, sells: false })

  useEffect(() => {
    if (!FACTORY_ADDRESS || !publicClient) return
    loadConfig()
  }, [FACTORY_ADDRESS, publicClient])

  useEffect(() => { if (isSuccess) loadConfig() }, [isSuccess])

  async function loadConfig() {
    try {
      const calls = [
        ['owner', []], ['creationFee', []], ['graduationTarget', []],
        ['maxDevBuyBps', []], ['rewardRouter', []], ['getRewardRecipient', []],
        ['pauseNewLaunches', []], ['pauseAllBuys', []], ['pauseAllSells', []]
      ]
      const c = {}
      for (const [fn, args] of calls) {
        try {
          c[fn] = await publicClient.readContract({ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: fn, args })
        } catch {}
      }
      setOwner(c.owner)
      setConfig(c)
      setPause({ launches: !!c.pauseNewLaunches, buys: !!c.pauseAllBuys, sells: !!c.pauseAllSells })
    } catch {}
    setLoading(false)
  }

  function call(fn, args) {
    writeContract({ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: fn, args, chainId: monad.id })
  }

  const isOwner = isConnected && owner && wallet?.toLowerCase() === owner.toLowerCase()

  if (loading) return <Layout title="Admin"><div className="container dots text-t3" style={{padding:40, textAlign:"center"}}>Loading config</div></Layout>

  if (!isConnected) {
    return (
      <Layout title="Admin">
        <div className="container" style={{padding:40, textAlign:'center'}}>
          <div className="card" style={{padding:40, maxWidth:420, margin:'0 auto'}}>
            <div style={{fontSize:48, marginBottom:14}}>🔒</div>
            <div className="text-xl font-bold mb-2">Admin Access</div>
            <p className="text-t3 text-sm">Connect with the contract owner wallet</p>
          </div>
        </div>
      </Layout>
    )
  }

  if (!isOwner) {
    return (
      <Layout title="Admin">
        <div className="container" style={{padding:40, textAlign:'center'}}>
          <div className="card" style={{padding:40, maxWidth:480, margin:'0 auto'}}>
            <div style={{fontSize:48, marginBottom:14}}>🚫</div>
            <div className="text-xl font-bold mb-2">Not Authorized</div>
            <p className="text-t3 text-sm mb-3">Only the factory owner can access this panel.</p>
            <div className="text-xs font-mono text-t4">Owner: {owner ? fmtAddr(owner) : '???'}</div>
            <div className="text-xs font-mono text-t4">You: {fmtAddr(wallet)}</div>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Admin Panel">
      <div className="container" style={{maxWidth:760, paddingBottom:60}}>
        <div className="hero" style={{marginTop:16, marginBottom:16, padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <div className="text-xs text-t3 font-bold mb-2" style={{letterSpacing:2}}>ADMIN PANEL</div>
            <h1 className="hero-title" style={{fontSize:'clamp(24px,5vw,36px)'}}>🔧 MonPad Control</h1>
            <p className="text-t2 text-sm">Owner: <span className="font-mono">{fmtAddr(owner)}</span></p>
          </div>
        </div>

        {/* PAUSE SWITCHES */}
        <div className="card mb-4" style={{borderColor:'rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.04)'}}>
          <div className="font-bold text-base mb-3">🚨 Emergency Pause</div>
          {[
            { key:'launches', label:'New Launches', fn:'setPauseNewLaunches', curr: pause.launches },
            { key:'buys', label:'All Buys', fn:'setPauseAllBuys', curr: pause.buys },
            { key:'sells', label:'All Sells', fn:'setPauseAllSells', curr: pause.sells },
          ].map(p => (
            <div key={p.key} className="flex justify-between items-center mb-2 p-3 rounded" style={{background:'rgba(0,0,0,0.3)'}}>
              <div>
                <div className="font-bold text-sm">{p.label}</div>
                <div className={`text-xs font-mono ${p.curr ? 'text-red' : 'text-green'}`}>{p.curr ? '🔴 PAUSED' : '🟢 LIVE'}</div>
              </div>
              <button className={`btn btn-sm ${p.curr ? 'btn-green' : 'btn-red'}`} disabled={isPending || isConfirming} onClick={() => call(p.fn, [!p.curr])}>{p.curr ? 'Resume' : 'Pause'}</button>
            </div>
          ))}
        </div>

        {/* ECONOMICS */}
        <div className="card mb-4">
          <div className="font-bold text-base mb-3">💰 Economics</div>

          <div className="mb-3">
            <label className="input-label">Creation Fee (currently {fmtMON(config.creationFee)} MON)</label>
            <div className="flex gap-2">
              <input className="input" placeholder="100" value={edits.creationFee} onChange={e => setEdits({...edits, creationFee:e.target.value})} />
              <button className="btn btn-primary" disabled={!edits.creationFee || isPending || isConfirming} onClick={() => call('setCreationFee', [parseEther(edits.creationFee)])}>Update</button>
            </div>
          </div>

          <div className="mb-3">
            <label className="input-label">Graduation Target (currently {fmtMON(config.graduationTarget)} MON)</label>
            <div className="flex gap-2">
              <input className="input" placeholder="425000" value={edits.graduationTarget} onChange={e => setEdits({...edits, graduationTarget:e.target.value})} />
              <button className="btn btn-primary" disabled={!edits.graduationTarget || isPending || isConfirming} onClick={() => call('setGraduationTarget', [parseEther(edits.graduationTarget)])}>Update</button>
            </div>
          </div>

          <div className="mb-3">
            <label className="input-label">Creator Grad Reward (in MON)</label>
            <div className="flex gap-2">
              <input className="input" placeholder="25000" value={edits.graduationCreatorReward} onChange={e => setEdits({...edits, graduationCreatorReward:e.target.value})} />
              <button className="btn btn-primary" disabled={!edits.graduationCreatorReward || isPending || isConfirming} onClick={() => call('setGraduationCreatorReward', [parseEther(edits.graduationCreatorReward)])}>Update</button>
            </div>
          </div>

          <div>
            <label className="input-label">Max Dev Buy BPS (currently {Number(config.maxDevBuyBps || 0)} = {Number(config.maxDevBuyBps || 0) / 100}%)</label>
            <div className="flex gap-2">
              <input className="input" placeholder="200" value={edits.maxDevBuyBps} onChange={e => setEdits({...edits, maxDevBuyBps:e.target.value})} />
              <button className="btn btn-primary" disabled={!edits.maxDevBuyBps || isPending || isConfirming} onClick={() => call('setMaxDevBuyBps', [BigInt(edits.maxDevBuyBps)])}>Update</button>
            </div>
            <div className="text-xs text-t4 mt-1">100 = 1%, 200 = 2%. Max 1000 (10%).</div>
          </div>
        </div>

        {/* REWARD ROUTER */}
        <div className="card mb-4" style={{background:'linear-gradient(135deg, rgba(168,85,247,0.06), rgba(34,211,238,0.04))'}}>
          <div className="font-bold text-base mb-2">🔀 Reward Router (the magic switch)</div>
          <p className="text-xs text-t3 mb-3">Routes 0.5% sell tax. <strong>Empty</strong> = goes to buyback wallet. <strong>Set</strong> = goes to staking hub.</p>
          <div className="text-xs text-t3 mb-2">Currently routing to: <span className="font-mono text-purple">{fmtAddr(config.getRewardRecipient || '')}</span></div>
          <div className="flex gap-2">
            <input className="input" placeholder="0xStakingHubAddress (or empty for buyback)" value={edits.rewardRouter} onChange={e => setEdits({...edits, rewardRouter:e.target.value})} />
            <button className="btn btn-primary" disabled={isPending || isConfirming} onClick={() => call('setRewardRouter', [edits.rewardRouter || '0x0000000000000000000000000000000000000000'])}>Set</button>
          </div>
        </div>

        {/* BLOCKLIST */}
        <div className="card mb-4">
          <div className="font-bold text-base mb-2">🚫 Token Blocklist</div>
          <p className="text-xs text-t3 mb-3">Block scam tokens from buying/selling.</p>
          <div className="flex gap-2 mb-2">
            <input className="input" placeholder="0xTokenAddress" value={edits.blocklistAddr} onChange={e => setEdits({...edits, blocklistAddr:e.target.value})} />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-red" style={{flex:1}} disabled={!edits.blocklistAddr || isPending || isConfirming} onClick={() => call('setBlocked', [edits.blocklistAddr, true])}>Block</button>
            <button className="btn btn-green" style={{flex:1}} disabled={!edits.blocklistAddr || isPending || isConfirming} onClick={() => call('setBlocked', [edits.blocklistAddr, false])}>Unblock</button>
          </div>
        </div>

        {/* TX STATUS */}
        {(isPending || isConfirming || isSuccess) && (
          <div className="card" style={{padding:14, position:'sticky', bottom:80, background:'var(--bg-card)', backdropFilter:'blur(20px)'}}>
            {isPending && <div className="text-purple text-sm">✍️ Confirm in wallet...</div>}
            {isConfirming && <div className="text-cyan text-sm dots">⏳ Confirming on chain</div>}
            {isSuccess && <div className="text-green text-sm">✅ Updated! Reloading config...</div>}
          </div>
        )}
      </div>
    </Layout>
  )
}

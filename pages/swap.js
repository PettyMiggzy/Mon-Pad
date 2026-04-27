import { useState, useEffect } from 'react'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import Layout from '../components/Layout'
import { TOKEN_ABI, fmtMON, fmtTokens, fmtAddr, MONSHI_TOKEN, WMON_ADDRESS, SWAP_V2 } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

const SWAP_ABI = [
  { name: 'swapMONForToken', type: 'function', stateMutability: 'payable', inputs: [{name:'tokenOut',type:'address'},{name:'minOut',type:'uint256'},{name:'deadline',type:'uint256'}], outputs: [] },
  { name: 'swapTokenForMON', type: 'function', stateMutability: 'nonpayable', inputs: [{name:'tokenIn',type:'address'},{name:'amountIn',type:'uint256'},{name:'minOut',type:'uint256'},{name:'deadline',type:'uint256'}], outputs: [] },
  { name: 'platformFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{type:'uint16'}] },
]

export default function SwapPage() {
  const { address: wallet, isConnected } = useAccount()
  const { data: monBalance } = useBalance({ address: wallet })
  const publicClient = usePublicClient({ chainId: monad.id })

  const [tokens, setTokens] = useState([])
  const [fromTok, setFromTok] = useState('MON')   // 'MON' or token address
  const [toTok, setToTok] = useState('')
  const [fromAmt, setFromAmt] = useState('')
  const [toAmtEst, setToAmtEst] = useState('')
  const [slippage, setSlippage] = useState(5)
  const [showFromPicker, setShowFromPicker] = useState(false)
  const [showToPicker, setShowToPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [fromBalance, setFromBalance] = useState(0n)
  const [error, setError] = useState('')

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/tokens`).then(r => r.json()).then(d => setTokens(d || [])).catch(() => {})
  }, [])

  // Update from balance when token changes
  useEffect(() => {
    if (!wallet || !publicClient) return
    if (fromTok === 'MON') {
      setFromBalance(monBalance?.value || 0n)
    } else {
      publicClient.readContract({ address: fromTok, abi: TOKEN_ABI, functionName: 'balanceOf', args: [wallet] })
        .then(b => setFromBalance(BigInt(b || 0)))
        .catch(() => setFromBalance(0n))
    }
  }, [fromTok, wallet, monBalance, publicClient, isSuccess])

  function flip() {
    const f = fromTok, t = toTok
    setFromTok(t || 'MON')
    setToTok(f === 'MON' ? '' : f)
    setFromAmt(toAmtEst)
  }

  async function executeSwap() {
    setError('')
    if (!SWAP_V2) { setError('Swap contract not deployed yet'); return }
    if (!fromAmt || parseFloat(fromAmt) <= 0) { setError('Enter amount'); return }
    if (!toTok) { setError('Pick a token'); return }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
    try {
      if (fromTok === 'MON') {
        // MON → Token
        writeContract({
          address: SWAP_V2,
          abi: SWAP_ABI,
          functionName: 'swapMONForToken',
          args: [toTok, 0n, deadline],
          value: parseEther(fromAmt),
          chainId: monad.id
        })
      } else {
        // Token → MON: needs approval first
        const amountIn = parseEther(fromAmt)
        const allowance = await publicClient.readContract({
          address: fromTok, abi: TOKEN_ABI, functionName: 'allowance', args: [wallet, SWAP_V2]
        })
        if (BigInt(allowance) < amountIn) {
          writeContract({ address: fromTok, abi: TOKEN_ABI, functionName: 'approve', args: [SWAP_V2, BigInt(2)**BigInt(256)-1n], chainId: monad.id })
          return
        }
        writeContract({
          address: SWAP_V2,
          abi: SWAP_ABI,
          functionName: 'swapTokenForMON',
          args: [fromTok, amountIn, 0n, deadline],
          chainId: monad.id
        })
      }
    } catch (e) { setError(e?.shortMessage || e?.message || 'Swap failed') }
  }

  const fromInfo = fromTok === 'MON' ? { symbol: 'MON', name: 'Monad' } : tokens.find(t => t.tokenAddress?.toLowerCase() === fromTok?.toLowerCase()) || { symbol: fromTok?.slice(0,6) }
  const toInfo = toTok ? (tokens.find(t => t.tokenAddress?.toLowerCase() === toTok?.toLowerCase()) || { symbol: toTok.slice(0,6) }) : null

  const filtered = tokens.filter(t => {
    const q = search.toLowerCase()
    return !q || (t.name||'').toLowerCase().includes(q) || (t.symbol||'').toLowerCase().includes(q) || (t.tokenAddress||'').toLowerCase().includes(q)
  })

  return (
    <Layout title="Swap">
      <div className="container" style={{maxWidth:480, paddingBottom:60}}>
        <div className="hero" style={{marginTop:16, marginBottom:16, padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <h1 className="hero-title" style={{fontSize:'clamp(28px,5vw,40px)'}}>🔄 Swap</h1>
            <p className="text-t2 text-sm">Trade graduated tokens with 0.3% platform fee → buyback</p>
          </div>
        </div>

        <div className="card" style={{padding:18}}>
          {/* FROM */}
          <div style={{padding:14, background:'rgba(0,0,0,0.3)', borderRadius:'var(--r)', marginBottom:8}}>
            <div className="flex justify-between mb-2 text-xs text-t3">
              <span>From</span>
              {isConnected && <span>Bal: <span className="font-mono">{fromTok === 'MON' ? Number(formatEther(fromBalance)).toFixed(4) : fmtTokens(fromBalance)}</span></span>}
            </div>
            <div className="flex gap-2 items-center">
              <button className="btn btn-ghost" style={{padding:'10px 14px', minWidth:120}} onClick={() => setShowFromPicker(true)}>
                <span className="font-bold">{fromInfo.symbol}</span> ▼
              </button>
              <input className="input" type="number" placeholder="0.0" value={fromAmt} onChange={e => setFromAmt(e.target.value)} style={{flex:1, fontSize:18, fontWeight:700, textAlign:'right'}} />
            </div>
            {isConnected && fromBalance > 0n && (
              <div className="flex gap-1 mt-2">
                {[0.25, 0.5, 1].map(p => (
                  <button key={p} className="btn btn-ghost btn-sm" style={{flex:1, fontSize:10}} onClick={() => setFromAmt(formatEther((fromBalance * BigInt(Math.floor(p*100))) / 100n))}>{p === 1 ? 'MAX' : `${p*100}%`}</button>
                ))}
              </div>
            )}
          </div>

          {/* FLIP */}
          <div className="text-center" style={{margin:'-4px 0', position:'relative', zIndex:1}}>
            <button className="btn btn-ghost" style={{width:36, height:36, padding:0, borderRadius:'50%', border:'2px solid var(--bd2)', background:'var(--bg-card)'}} onClick={flip}>↕</button>
          </div>

          {/* TO */}
          <div style={{padding:14, background:'rgba(0,0,0,0.3)', borderRadius:'var(--r)'}}>
            <div className="flex justify-between mb-2 text-xs text-t3">
              <span>To (estimated)</span>
            </div>
            <div className="flex gap-2 items-center">
              <button className="btn btn-ghost" style={{padding:'10px 14px', minWidth:120}} onClick={() => setShowToPicker(true)}>
                {toInfo ? <span className="font-bold">{toInfo.symbol}</span> : <span className="text-t3">Select</span>} ▼
              </button>
              <input className="input" placeholder="0.0" disabled value={toAmtEst} style={{flex:1, fontSize:18, fontWeight:700, textAlign:'right'}} />
            </div>
          </div>

          {/* SLIPPAGE */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-t3 mb-2">
              <span>Slippage tolerance</span>
              <span className="font-mono text-purple">{slippage}%</span>
            </div>
            <input type="range" min="1" max="20" value={slippage} onChange={e => setSlippage(parseInt(e.target.value))} />
          </div>

          {/* FEES */}
          <div className="mt-4 p-3 rounded text-xs" style={{background:'rgba(0,0,0,0.3)'}}>
            <div className="flex justify-between text-t3"><span>Platform fee (0.3% → buyback)</span><span className="font-mono">{fromAmt ? (parseFloat(fromAmt) * 0.003).toFixed(6) : '0'}</span></div>
            <div className="flex justify-between text-t3"><span>DEX fee (0.3%)</span><span className="font-mono">{fromAmt ? (parseFloat(fromAmt) * 0.003).toFixed(6) : '0'}</span></div>
          </div>

          {error && <div className="card mt-3" style={{background:'rgba(248,113,113,0.08)', borderColor:'rgba(248,113,113,0.3)', color:'var(--red)', padding:10, fontSize:13}}>❌ {error}</div>}
          {!SWAP_V2 && <div className="card mt-3" style={{background:'rgba(252,211,77,0.05)', borderColor:'rgba(252,211,77,0.3)', padding:10, fontSize:12, color:'var(--gold)'}}>⚠ Swap contract not deployed yet. Use a DEX like Monadex for now.</div>}

          {!isConnected ? (
            <div className="text-center text-t3 text-sm mt-4" style={{padding:14}}>Connect wallet to swap</div>
          ) : (
            <button className="btn btn-primary btn-block btn-lg mt-4" disabled={!fromAmt || !toTok || isPending || isConfirming || !SWAP_V2} onClick={executeSwap}>
              {isPending ? '✍️ Confirm in wallet' : isConfirming ? '⏳ Swapping...' : 'Swap'}
            </button>
          )}
        </div>
      </div>

      {/* Token picker modal */}
      {(showFromPicker || showToPicker) && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', backdropFilter:'blur(8px)', zIndex:100, display:'flex', alignItems:'flex-end', justifyContent:'center'}} onClick={() => { setShowFromPicker(false); setShowToPicker(false) }}>
          <div className="card" style={{maxWidth:480, width:'100%', maxHeight:'80vh', display:'flex', flexDirection:'column', borderRadius:'var(--r-xl) var(--r-xl) 0 0', padding:18}} onClick={e => e.stopPropagation()}>
            <div className="font-bold text-lg mb-3">Select token</div>
            <input className="input mb-3" placeholder="Search by name or address..." value={search} onChange={e => setSearch(e.target.value)} />
            <div style={{flex:1, overflowY:'auto'}}>
              {showFromPicker && (
                <button className="btn btn-ghost btn-block mb-2" style={{justifyContent:'flex-start'}} onClick={() => { setFromTok('MON'); setShowFromPicker(false); setSearch('') }}>
                  <div style={{width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg, var(--p), var(--p-deep))', marginRight:10, display:'inline-flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:12}}>M</div>
                  <span><span className="font-bold">MON</span> · Native</span>
                </button>
              )}
              {filtered.map(t => (
                <button key={t.tokenAddress} className="btn btn-ghost btn-block mb-1" style={{justifyContent:'flex-start'}} onClick={() => {
                  if (showFromPicker) setFromTok(t.tokenAddress)
                  else setToTok(t.tokenAddress)
                  setShowFromPicker(false); setShowToPicker(false); setSearch('')
                }}>
                  <div style={{width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg, var(--p), var(--p-deep))', marginRight:10, display:'inline-flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:11}}>{(t.symbol || '?').slice(0,2)}</div>
                  <div style={{textAlign:'left', flex:1, minWidth:0}}>
                    <div className="font-bold text-sm">{t.symbol}</div>
                    <div className="text-xs text-t3" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.name}</div>
                  </div>
                  {t.graduated && <span className="tag tag-gold">GRAD</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

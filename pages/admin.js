import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CURVE_ABI, fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

const PLATFORM = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16'
const TREASURY = '0xB9d4B73bE18914c6d64Bee65a806648370be467f'
const ALLOWED  = [PLATFORM.toLowerCase(), TREASURY.toLowerCase()]
const SERVER   = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Admin() {
    const { address, isConnected } = useAccount()
    const [tokens, setTokens]       = useState([])
    const [selected, setSelected]   = useState(null)  // { token, curve }
  const [loading, setLoading]     = useState(true)
    const [msg, setMsg]             = useState('')
    const [globalPaused, setGP]     = useState(false)

  const { writeContract, data: txHash, isPending } = useWriteContract()
    const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const isAdmin = isConnected && ALLOWED.includes(address?.toLowerCase())

  useEffect(() => { if (SERVER) loadTokens() }, [])
    useEffect(() => { if (isSuccess) { flash('✅ Done!'); loadTokens() } }, [isSuccess])

  async function loadTokens() {
        try {
                const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
                setTokens(data)
        } catch {}
        setLoading(false)
  }

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function call(functionName, args) {
        writeContract({ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName, args, chainId: monad.id })
        flash('⏳ Waiting for wallet…')
  }

  if (!isConnected) return (
        <Layout showBack title="Admin">
          <div style={{ padding:'60px 16px', textAlign:'center', color:'var(--t3)' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700 }}>Connect your wallet to access admin</div>
  </div>
  </Layout>
  )

  if (!isAdmin) return (
        <Layout showBack title="Admin">
          <div style={{ padding:'60px 16px', textAlign:'center', color:'var(--t3)' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>🚫</div>
        <div style={{ fontSize:16, fontWeight:700 }}>Not authorized</div>
        <div style={{ fontSize:13, marginTop:8, fontFamily:'var(--mono)' }}>{fmtAddr(address)}</div>
    </div>
    </Layout>
  )

  return (
        <Layout showBack title="Admin Panel">
          <div style={{ maxWidth:800, margin:'0 auto', padding:'16px 16px 80px' }}>

{msg && (
            <div style={{ background:'rgba(110,84,255,0.15)', border:'1px solid var(--p)', borderRadius:10, padding:'10px 14px', fontSize:13, fontWeight:700, color:'var(--p2)', marginBottom:16 }}>
{msg}
</div>
        )}

{/* GLOBAL CONTROLS */}
        <div className="card" style={{ marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:800, marginBottom:14, color:'var(--t1)' }}>🌐 Global Controls</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button className="btn-primary" style={{ background:'var(--r)', padding:'10px 18px', fontSize:13 }}
              onClick={() => call('setEmergencyPaused', [true])}>
              🚨 Emergency Pause All
                </button>
            <button className="btn-primary" style={{ background:'var(--g)', padding:'10px 18px', fontSize:13 }}
              onClick={() => call('setEmergencyPaused', [false])}>
              ✅ Resume All
                </button>
                </div>
                </div>

{/* TOKEN LIST */}
        <div className="card" style={{ marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:800, marginBottom:14, color:'var(--t1)' }}>🪙 Tokens ({tokens.length})</div>
{loading && <div style={{ color:'var(--t3)', fontSize:13 }}>Loading…</div>}
{!loading && tokens.length === 0 && <div style={{ color:'var(--t3)', fontSize:13 }}>No tokens yet</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
{tokens.map(t => (
                <div key={t.tokenAddress}
                onClick={() => setSelected(selected?.token === t.tokenAddress ? null : { token: t.tokenAddress, curve: t.curveAddress })}
                style={{ padding:'10px 14px', borderRadius:10, border: selected?.token === t.tokenAddress ? '1px solid var(--p)' : '1px solid var(--bd2)',
                                         background: selected?.token === t.tokenAddress ? 'rgba(110,84,255,0.1)' : 'var(--bg2)', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                                    <span style={{ fontWeight:800, fontSize:14 }}>{t.name}</span>
                  <span style={{ color:'var(--t3)', fontSize:12, marginLeft:8, fontFamily:'var(--mono)' }}>${t.symbol}</span>
{t.graduated && <span style={{ marginLeft:8, fontSize:11, color:'var(--g)', fontWeight:700 }}>🎓 GRAD</span>}
  </div>
                <div style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>{fmtAddr(t.tokenAddress)}</div>
  </div>
            ))}
              </div>
              </div>

{/* TOKEN ACTIONS */}
{selected && (
            <div className="card">
              <div style={{ fontSize:14, fontWeight:800, marginBottom:4, color:'var(--t1)' }}>⚙️ Token Actions</div>
            <div style={{ fontSize:12, color:'var(--t3)', fontFamily:'var(--mono)', marginBottom:14 }}>
              Curve: {selected.curve}
</div>

{/* PAUSE / RESUME */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.5px' }}>Trading</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn-primary" style={{ background:'rgba(255,174,69,0.8)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curvePause', [selected.curve, true, true])}>
                  ⏸ Pause All Trading
                    </button>
                <button className="btn-primary" style={{ background:'rgba(255,174,69,0.8)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curvePause', [selected.curve, true, false])}>
                  ⏸ Pause Buys Only
                    </button>
                <button className="btn-primary" style={{ background:'rgba(255,174,69,0.8)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curvePause', [selected.curve, false, true])}>
                  ⏸ Pause Sells Only
                    </button>
                <button className="btn-primary" style={{ background:'var(--g)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curvePause', [selected.curve, false, false])}>
                  ▶️ Resume Trading
                    </button>
                    </div>
                    </div>

{/* DELIST */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.5px' }}>Listing</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn-primary" style={{ background:'var(--r)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curveDelist', [selected.curve, true, true, true])}>
                  🗑 Delist Token
                    </button>
                <button className="btn-primary" style={{ background:'var(--g)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curveDelist', [selected.curve, false, false, false])}>
                  ✅ Relist Token
                    </button>
                    </div>
                    </div>

{/* DEV FREEZE */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.5px' }}>Dev Wallet</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn-primary" style={{ background:'var(--g)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curveUnfreeze', [selected.curve])}>
                  🔓 Unfreeze Dev Wallet
                    </button>
                <button className="btn-primary" style={{ background:'rgba(110,84,255,0.6)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curveForceGrad', [selected.curve])}>
                  🎓 Force Graduate
                    </button>
                    </div>
                    </div>

{/* BOT PROTECTION */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.5px' }}>Bot Protection</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn-primary" style={{ background:'rgba(110,84,255,0.6)', padding:'9px 16px', fontSize:12 }}
                  onClick={() => call('curveBot', [selected.curve, true, 500, 1])}>
                  🤖 Enable Bot Protection
                    </button>
                <button className="btn-primary" style={{ background:'var(--bg3)', padding:'9px 16px', fontSize:12, border:'1px solid var(--bd2)', color:'var(--t2)' }}
                  onClick={() => call('curveBot', [selected.curve, false, 0, 0])}>
                  Disable Bot Protection
                    </button>
                    </div>
                    </div>

{/* COPY ADDRESSES */}
            <div style={{ marginTop:16, padding:'12px 14px', background:'var(--bg2)', borderRadius:10, border:'1px solid var(--bd)' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:8 }}>Addresses</div>
{[['Token', selected.token], ['Curve', selected.curve]].map(([l, v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <span style={{ fontSize:12, color:'var(--t3)' }}>{l}</span>
                                                                              <button onClick={() => navigator.clipboard.writeText(v)}
                    style={{ fontSize:11, fontFamily:'var(--mono)', color:'var(--p2)', background:'none', border:'none', cursor:'pointer' }}>
{v} ⎘
  </button>
  </div>
              ))}
                </div>
                </div>
        )}
</div>
          </Layout>
  )
}

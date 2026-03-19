import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAccount, usePublicClient } from 'wagmi'
import Layout from '../components/Layout'
import { TOKEN_ABI, CURVE_ABI, fmtMON, fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Profile() {
  const router = useRouter()
  const { address } = useAccount()
  const client = usePublicClient({ chainId: monad.id })
  const [tab, setTab] = useState('Created')
  const [created, setCreated] = useState([])
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalVol: 0, devFees: 0, tokens: 0 })

  useEffect(() => {
    if (address && client) load()
    else setLoading(false)
  }, [address, client])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`${SERVER}/api/tokens/all`)
      const tokens = await res.json()

      // find tokens created by this address
      const myTokens = tokens.filter(t => t.creator && address && t.creator.toLowerCase() === address.toLowerCase())

      // get volume stats from candles for created tokens
      let totalVol = 0, devFees = 0
      const createdWithStats = await Promise.all(myTokens.map(async t => {
        try {
          const cRes = await fetch(`${SERVER}/api/candles/${t.curveAddress}?interval=1h`)
          const { trades } = await cRes.json()
          const vol = (trades || []).reduce((s, tr) => s + tr.volume, 0)
          totalVol += vol
          devFees += vol * 0.015
          return { ...t, volume: vol }
        } catch { return { ...t, volume: 0 } }
      }))

      setCreated(createdWithStats)
      setStats({ totalVol, devFees, tokens: myTokens.length })

      // find holdings — check balanceOf for each token
      const holdingList = []
      await Promise.all(tokens.map(async t => {
        try {
          const bal = await client.readContract({ address: t.tokenAddress, abi: TOKEN_ABI, functionName: 'balanceOf', args: [address] })
          if (bal > 0n) {
            const priceWei = await client.readContract({ address: t.curveAddress, abi: CURVE_ABI, functionName: 'priceWeiPerToken' })
            holdingList.push({ ...t, balance: bal, priceWei })
          }
        } catch {}
      }))
      holdingList.sort((a, b) => Number(b.balance) - Number(a.balance))
      setHoldings(holdingList)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const TABS = ['Created', 'Holdings']

  return (
    <Layout title="Profile">
      {!address ? (
        <div style={{ padding:'60px 14px', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>👤</div>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Connect your wallet</div>
          <div style={{ fontSize:13, color:'var(--t3)' }}>Connect to see your created tokens and holdings</div>
        </div>
      ) : (
        <>
          {/* PROFILE HEADER */}
          <div style={{ padding:'20px 14px 0', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background:'linear-gradient(135deg,var(--p),var(--cyan))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:800, color:'white', flexShrink:0 }}>
              {address.slice(2,4).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, fontFamily:'var(--mono)' }}>{fmtAddr(address)}</div>
              <div style={{ fontSize:12, color:'var(--t3)', marginTop:2 }}>MonPad Creator</div>
            </div>
          </div>

          {/* STATS */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:1, margin:'16px 14px', background:'var(--bd)', borderRadius:12, overflow:'hidden' }}>
            {[
              ['Tokens Created', stats.tokens],
              ['Total Volume', fmtMON(BigInt(Math.floor(stats.totalVol * 1e18))) + ' MON'],
              ['Dev Fees Earned', fmtMON(BigInt(Math.floor(stats.devFees * 1e18))) + ' MON'],
            ].map(([l, v]) => (
              <div key={l} style={{ background:'var(--bg2)', padding:'12px 8px', textAlign:'center' }}>
                <div style={{ fontSize:16, fontWeight:800, color:'var(--p2)' }}>{v}</div>
                <div style={{ fontSize:9, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.3px', marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>

          {/* TABS */}
          <div style={{ display:'flex', borderBottom:'1px solid var(--bd)', margin:'0 14px' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex:1, padding:'12px 0', border:'none', borderBottom:tab===t?'2px solid var(--p)':'2px solid transparent', background:'transparent', color:tab===t?'var(--t1)':'var(--t3)', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:-1 }}>
                {t} {t==='Created'?`(${created.length})`:t==='Holdings'?`(${holdings.length})`:''}
              </button>
            ))}
          </div>

          {loading && <div style={{ padding:'40px 14px', textAlign:'center', color:'var(--t3)', fontSize:13 }}>Loading…</div>}

          {/* CREATED TOKENS */}
          {!loading && tab==='Created' && (
            <div style={{ padding:'0 14px' }}>
              {created.length === 0 && (
                <div style={{ padding:'40px 0', textAlign:'center' }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>🚀</div>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>No tokens yet</div>
                  <div style={{ fontSize:13, color:'var(--t3)', marginBottom:16 }}>Launch your first token on MonPad for 10 MON</div>
                  <button onClick={() => router.push('/create')} className="btn-primary" style={{ padding:'10px 24px' }}>+ Create Token</button>
                </div>
              )}
              {created.map(t => (
                <div key={t.tokenAddress} onClick={() => router.push(`/token/${t.tokenAddress}`)}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderBottom:'1px solid var(--bd)', cursor:'pointer' }}>
                  <div style={{ width:48, height:48, borderRadius:10, background:'radial-gradient(circle at 35% 35%,#3b1d9e,#120830)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'rgba(255,255,255,0.3)', flexShrink:0, overflow:'hidden' }}>
                    {t.pfpUrl ? <img src={t.pfpUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : (t.symbol||'?').slice(0,2)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:800 }}>{t.name}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>${t.symbol}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, fontFamily:'var(--mono)' }}>{(t.volume||0).toFixed(2)} MON vol</div>
                    <div style={{ fontSize:11, color:'var(--g)', marginTop:2 }}>+{((t.volume||0)*0.015).toFixed(3)} MON fees</div>
                    {t.graduated && <div style={{ fontSize:10, color:'var(--gold)', marginTop:2 }}>🎓 Graduated</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* HOLDINGS */}
          {!loading && tab==='Holdings' && (
            <div style={{ padding:'0 14px' }}>
              {holdings.length === 0 && (
                <div style={{ padding:'40px 0', textAlign:'center' }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>💎</div>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>No holdings</div>
                  <div style={{ fontSize:13, color:'var(--t3)' }}>Buy tokens on MonPad to see them here</div>
                </div>
              )}
              {holdings.map(h => (
                <div key={h.tokenAddress} onClick={() => router.push(`/token/${h.tokenAddress}`)}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderBottom:'1px solid var(--bd)', cursor:'pointer' }}>
                  <div style={{ width:48, height:48, borderRadius:10, background:'radial-gradient(circle at 35% 35%,#3b1d9e,#120830)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'rgba(255,255,255,0.3)', flexShrink:0, overflow:'hidden' }}>
                    {h.pfpUrl ? <img src={h.pfpUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : (h.symbol||'?').slice(0,2)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:800 }}>{h.name}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>${h.symbol}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, fontFamily:'var(--mono)' }}>{(Number(h.balance)/1e18).toLocaleString(undefined,{maximumFractionDigits:0})} {h.symbol}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{(Number(h.balance)/1e18 * Number(h.priceWei)/1e18).toFixed(4)} MON</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  )
}

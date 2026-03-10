import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CURVE_ABI, TOKEN_ABI, START_BLOCK, fmtMON, fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
function fixUrl(url) {
  if (!url) return url
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  return url
}

const TABS = [
  { id: 'movers',    label: '⭐ Movers' },
  { id: 'live',      label: '🔴 Live', blink: true },
  { id: 'new',       label: '🌱 New' },
  { id: 'marketcap', label: '🔥 Market cap' },
  { id: 'trenches',  label: '⚔️ Trenches' },
  { id: 'oldest',    label: '🕰 Oldest' },
  { id: 'grad',      label: '🎓 Graduated' },
]

const GRAD_COLORS = ['#6E54FF','#a78bfa','#85E6FF','#FF8EE4','#FFAE45','#22c55e']

export default function Home() {
  const router    = useRouter()
  const client    = usePublicClient({ chainId: monad.id })
  const [tab, setTab]         = useState('movers')
  const [tokens, setTokens]   = useState([])
  const [metas, setMetas]     = useState({})
  const [liveRooms, setLive]  = useState([])
  const [loading, setLoading] = useState(true)
  const carouselRef = useRef(null)

  useEffect(() => { if (router.query.tab) setTab(router.query.tab) }, [router.query.tab])
  useEffect(() => { loadTokens() }, [])

  // poll live rooms every 15s
  useEffect(() => {
    if (!SERVER) return
    const poll = () => fetch(`${SERVER}/api/live`).then(r=>r.json()).then(d=>setLive(d.live||[])).catch(()=>{})
    poll()
    const iv = setInterval(poll, 15000)
    return () => clearInterval(iv)
  }, [])

  async function loadTokens() {
    if (!SERVER) return
    try {
      const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
      const map  = {}
      const list = data.map((t, i) => {
        map[t.tokenAddress?.toLowerCase()] = t
        return {
          token:        t.tokenAddress,
          curve:        t.curveAddress,
          creator:      t.creator,
          name:         t.name,
          symbol:       t.symbol,
          graduated:    t.graduated,
          monRaisedNet: BigInt(t.monRaisedNet || '0'),
          capMon:       BigInt(t.capMon || '0'),
          bondedBps:    BigInt(t.bondedBps || '0'),
          marketCap:    BigInt(t.marketCap || '0'),
          blockNumber:  BigInt(t.blockNumber || '0'),
          colorIdx:     i,
        }
      })
      setTokens(list)
      setMetas(map)
    } catch (e) {
      console.error('loadTokens:', e)
    } finally {
      setLoading(false)
    }
  }

  function filtered() {
    const live = new Set(liveRooms.map(a=>a.toLowerCase()))
    if (tab === 'grad')      return tokens.filter(t => t.graduated)
    if (tab === 'live')      return tokens.filter(t => live.has(t.token?.toLowerCase()))
    if (tab === 'new')       return [...tokens]
    if (tab === 'oldest')    return [...tokens].reverse()
    if (tab === 'marketcap') return [...tokens].sort((a,b) => Number(b.marketCap||b.monRaisedNet) - Number(a.marketCap||a.monRaisedNet))
    if (tab === 'trenches')  return tokens.filter(t => !t.graduated && Number(t.bondedBps) >= 5000)
    // movers default
    return [...tokens].sort((a,b) => Number(b.marketCap||b.monRaisedNet) - Number(a.marketCap||a.monRaisedNet))
  }

  const list     = filtered()
  const live     = new Set(liveRooms.map(a=>a.toLowerCase()))
  const trending = [...tokens].sort((a,b) => Number(b.monRaisedNet)-Number(a.monRaisedNet)).slice(0,6)

  return (
    <Layout>
      {/* TRENDING CAROUSEL */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 16px 10px' }}>
        <div style={{ fontSize:17, fontWeight:800 }}>Trending coins</div>
        <div style={{ display:'flex', gap:6 }}>
          {['‹','›'].map((ch,i) => (
            <button key={ch}
              onClick={() => carouselRef.current?.scrollBy({ left: i===0?-240:240, behavior:'smooth' })}
              style={{ width:30, height:30, borderRadius:'50%', background:'var(--bg2)', border:'1px solid var(--bd2)', color:'var(--t2)', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div ref={carouselRef} style={{ display:'flex', gap:10, padding:'0 16px 8px', overflowX:'auto', scrollSnapType:'x mandatory', scrollbarWidth:'none' }}>
        {trending.length === 0 && !loading && (
          <div style={{ color:'var(--t3)', fontSize:13, padding:'20px 0' }}>No tokens yet — launch the first one!</div>
        )}
        {loading && [0,1,2,4].map(i => (
          <div key={i} style={{ flexShrink:0, width:230, height:145, borderRadius:12, background:'var(--bg2)', scrollSnapAlign:'start', animation:'pulse 1.5s infinite' }} />
        ))}
        {trending.map((t,i) => {
          const meta = metas[t.token?.toLowerCase()]
          const isLive = live.has(t.token?.toLowerCase())
          const color  = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]
          return (
            <div key={t.token} onClick={() => router.push(`/token/${t.token}`)}
              style={{ flexShrink:0, width:230, borderRadius:12, overflow:'hidden', position:'relative', cursor:'pointer', scrollSnapAlign:'start', background: meta?.bannerUrl ? '#000' : `linear-gradient(135deg,${color}22,${color}08)`, border:`1px solid ${color}22` }}>
              {meta?.bannerUrl
                ? <img src={fixUrl(meta.bannerUrl)} alt="" style={{ width:'100%', height:145, objectFit:'cover', display:'block' }} />
                : <div style={{ height:145, display:'flex', alignItems:'center', justifyContent:'center', fontSize:54, fontWeight:900, color:`${color}20` }}>{(t.symbol||'?').slice(0,2)}</div>
              }
              {isLive && (
                <div style={{ position:'absolute', top:8, left:8, background:'#ef4444', color:'white', fontSize:10, fontWeight:800, padding:'3px 8px', borderRadius:99, display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ width:6, height:6, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />LIVE
                </div>
              )}
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top,rgba(0,0,0,0.85) 0%,transparent 55%)', pointerEvents:'none' }} />
              <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'10px 12px', zIndex:2, display:'flex', alignItems:'flex-end', gap:8 }}>
                {meta?.pfpUrl && (
                  <div style={{ width:26, height:26, borderRadius:7, overflow:'hidden', border:'1.5px solid rgba(255,255,255,0.2)', flexShrink:0 }}>
                    <img src={fixUrl(meta.pfpUrl)} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:'white', lineHeight:1.1 }}>{fmtMON(t.marketCap || t.monRaisedNet)} MON</div>
                  <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.7)' }}>{t.name} · ${t.symbol}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* FILTER TABS */}
      <div className="tab-bar" style={{ overflowX:'auto', scrollbarWidth:'none', flexWrap:'nowrap' }}>
        {TABS.map(t => (
          <button key={t.id} className={`tab-pill ${tab===t.id?'on':'off'}`} onClick={() => setTab(t.id)}
            style={{ flexShrink:0 }}>
            {t.blink && tab === t.id && (
              <span style={{ width:7, height:7, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite', display:'inline-block', marginRight:5 }} />
            )}
            {t.label}
            {t.id==='live' && liveRooms.length>0 && (
              <span style={{ marginLeft:5, background:'#ef4444', color:'white', fontSize:10, fontWeight:800, padding:'1px 5px', borderRadius:99 }}>{liveRooms.length}</span>
            )}
          </button>
        ))}

        {/* Explore / Watchlist toggles like pump.fun */}
        <div style={{ marginLeft:'auto', display:'flex', gap:0, flexShrink:0, borderBottom:'none' }}>
          <button className="tab-pill on" style={{ background:'none', border:'none', borderBottom:'2px solid var(--p1)', borderRadius:0, color:'var(--p2)', padding:'10px 14px' }}>Explore</button>
          <button className="tab-pill off" style={{ background:'none', border:'none', borderRadius:0, padding:'10px 14px' }}>Watchlist</button>
        </div>
      </div>

      {/* TOKEN GRID — 3 columns like pump.fun */}
      <div style={{ padding:'12px 16px' }}>
        {loading && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[...Array(9)].map((_,i) => (
              <div key={i} style={{ height:110, borderRadius:12, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
            ))}
          </div>
        )}

        {!loading && list.length === 0 && (
          <div style={{ padding:'40px 0', textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:10 }}>
              {tab==='live'?'📡':tab==='grad'?'🎓':tab==='trenches'?'⚔️':'🚀'}
            </div>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>
              {tab==='live'?'Nobody is live right now':tab==='grad'?'No graduated tokens yet':tab==='trenches'?'No tokens in the trenches yet':'No tokens yet'}
            </div>
            <div style={{ fontSize:13, color:'var(--t3)' }}>
              {tab==='live'?'Go live on your token page':tab==='grad'?'Tokens graduate at 400K MON':tab==='trenches'?'Tokens past 50% bonding show here':'Be the first to launch on MonPad'}
            </div>
          </div>
        )}

        {!loading && list.length > 0 && (
          <div className="token-grid">
            {list.map(t => (
              <TokenCard key={t.token} token={t} meta={metas[t.token?.toLowerCase()]} isLive={live.has(t.token?.toLowerCase())} onClick={() => router.push(`/token/${t.token}`)} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function TokenCard({ token: t, meta, isLive, onClick }) {
  const pct   = Number(t.bondedBps) / 100
  const color = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]

  return (
    <div className="tcard" onClick={onClick}>
      {/* Image */}
      <div className="tcard-img" style={{ background: meta?.pfpUrl ? '#000' : `linear-gradient(135deg,${color}30,${color}10)`, position:'relative', overflow:'hidden' }}>
        {meta?.pfpUrl
          ? <img src={fixUrl(meta.pfpUrl)} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          : <span style={{ fontSize:24, fontWeight:900, color:`${color}50` }}>{(t.symbol||'?').slice(0,2)}</span>
        }
        {t.graduated && <div className="tcard-badge" style={{ background:'var(--gold)', color:'#000' }}>🎓 GRAD</div>}
        {isLive && !t.graduated && (
          <div className="tcard-badge" style={{ display:'flex', alignItems:'center', gap:3 }}>
            <span style={{ width:5, height:5, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />
            LIVE
          </div>
        )}
      </div>

      {/* Info */}
      <div className="tcard-body">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:2 }}>
          <div style={{ fontWeight:800, fontSize:13, lineHeight:1.2 }}>{meta?.name || t.name}</div>
          <div style={{ fontSize:11, fontWeight:700, fontFamily:'var(--mono)', color:'var(--t1)', flexShrink:0, marginLeft:4 }}>{fmtMON(t.marketCap || t.monRaisedNet)}</div>
        </div>
        <div style={{ fontSize:11, color:'var(--t3)', marginBottom:5, fontFamily:'var(--mono)' }}>${meta?.symbol || t.symbol}</div>

        {/* Progress bar */}
        <div style={{ width:'100%', height:3, background:'var(--bg3)', borderRadius:999, overflow:'hidden', marginBottom:4 }}>
          <div style={{ height:'100%', background: t.graduated ? 'linear-gradient(90deg,#d97706,#FFAE45)' : `linear-gradient(90deg,${color},${color}88)`, borderRadius:999, width:`${Math.min(pct,100)}%` }} />
        </div>

        {/* MC label + pct */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:10, color:'var(--t3)' }}>MC {fmtMON(t.marketCap || t.monRaisedNet)} MON</span>
          <span style={{ fontSize:10, fontWeight:700, color: pct >= 70 ? 'var(--gold)' : 'var(--t3)', fontFamily:'var(--mono)' }}>↑{pct.toFixed(1)}%</span>
        </div>

        {meta?.desc && (
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:4, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{meta.desc}</div>
        )}
      </div>
    </div>
  )
}
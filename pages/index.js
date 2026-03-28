import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CURVE_ABI, TOKEN_ABI, START_BLOCK, fmtMON, fmtUSD, fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
function fixUrl(url) {
  if (!url) return url
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  if (url.startsWith('http://api.monpad.net')) return url.replace('http://api.monpad.net', 'https://api.monpad.net')
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
  const [monPrice, setMonPrice] = useState(0)
  const carouselRef = useRef(null)

  useEffect(() => {
    fetch(`${SERVER}/api/mon-price`).then(r=>r.json()).then(d=>setMonPrice(d.price||0)).catch(()=>{})
  }, [])

  useEffect(() => { if (router.query.tab) setTab(router.query.tab) }, [router.query.tab])
  useEffect(() => { loadTokens() }, [])

  // websocket for real-time price updates
  useEffect(() => {
    if (!SERVER) return
    const wsUrl = SERVER.replace('https://', 'wss://').replace('http://', 'ws://')
    let ws, retryTimeout
    function connect() {
      ws = new WebSocket(wsUrl)
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'price_update') {
            setTokens(prev => prev.map(t =>
              t.token?.toLowerCase() === msg.tokenAddress?.toLowerCase()
                ? { ...t, marketCap: BigInt(msg.marketCap||'0'), monRaisedNet: BigInt(msg.monRaisedNet||'0'), bondedBps: BigInt(msg.bondedBps||'0') }
                : t
            ))
          }
        } catch {}
      }
      ws.onclose = () => { retryTimeout = setTimeout(connect, 3000) }
    }
    connect()
    return () => { if (ws) ws.close(); clearTimeout(retryTimeout) }
  }, [])

  // poll live rooms every 15s
  useEffect(() => {
    if (!SERVER) return
    const poll = () => fetch(`${SERVER}/api/live`).then(r=>r.json()).then(d=>setLive(d.live||[])).catch(()=>{})
    poll()
    const iv = setInterval(poll, 15000)
    return () => clearInterval(iv)
  }, [])


// Demo tokens shown when platform is new (< 10 real tokens)
// marketCap stored as plain numbers for easy mutation; displayed via BigInt conversion
const DEMO_TOKENS_BASE = [
  { token:'0xdemo1', curve:'0xdemo1c', creator:'0xdemo', name:'MonShiba',  symbol:'MSHIB',  graduated:false, capMon:400000000000000000000000n, colorIdx:10, isDemo:true, _mc:210000,  _bps:2800,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE.png' },
  { token:'0xdemo2', curve:'0xdemo2c', creator:'0xdemo', name:'PurpleNad', symbol:'PNAD',   graduated:false, capMon:400000000000000000000000n, colorIdx:11, isDemo:true, _mc:650000,  _bps:5500,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x4d224452801ACEd8B2F0aebE155379bb5D594381.png' },
  { token:'0xdemo3', curve:'0xdemo3c', creator:'0xdemo', name:'MonDoge',   symbol:'MDOGE',  graduated:false, capMon:400000000000000000000000n, colorIdx:12, isDemo:true, _mc:95000,   _bps:1200,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2.png' },
  { token:'0xdemo4', curve:'0xdemo4c', creator:'0xdemo', name:'NadPepe',   symbol:'NPEPE',  graduated:true,  capMon:400000000000000000000000n, colorIdx:13, isDemo:true, _mc:1200000, _bps:10000, _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x6982508145454Ce325dDbE47a25d4ec3d2311933.png' },
  { token:'0xdemo5', curve:'0xdemo5c', creator:'0xdemo', name:'MonAI',     symbol:'MAI',    graduated:false, capMon:400000000000000000000000n, colorIdx:14, isDemo:true, _mc:890000,  _bps:7800,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984.png' },
  { token:'0xdemo6', curve:'0xdemo6c', creator:'0xdemo', name:'LaunchPad', symbol:'LPAD',   graduated:false, capMon:400000000000000000000000n, colorIdx:15, isDemo:true, _mc:280000,  _bps:3300,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599.png' },
  { token:'0xdemo7', curve:'0xdemo7c', creator:'0xdemo', name:'MonCat',    symbol:'MCAT',   graduated:false, capMon:400000000000000000000000n, colorIdx:16, isDemo:true, _mc:72000,   _bps:900,   _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x514910771AF9Ca656af840dff83E8264EcF986CA.png' },
  { token:'0xdemo8', curve:'0xdemo8c', creator:'0xdemo', name:'NadRocket', symbol:'NRKT',   graduated:false, capMon:400000000000000000000000n, colorIdx:17, isDemo:true, _mc:420000,  _bps:4400,  _img:'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9.png' },
]
function makeDemoTokens(bases) {
  return bases.map(b => ({
    ...b,
    monRaisedNet: BigInt(Math.floor(b._mc * 1e18)),
    marketCap:    BigInt(Math.floor(b._mc * 1e18)),
    bondedBps:    BigInt(b._bps),
    blockNumber:  0n,
    pfpUrl:       b._img || null,
  }))
}
// mutable state for demo MC simulation (outside component to persist across renders)
let _demoBases = DEMO_TOKENS_BASE.map(b => ({ ...b }))
  async function loadTokens() {
    if (!SERVER) return
    try {
      const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
      const map  = {}
      const list = data.map((t, i) => {
        map[t.tokenAddress?.toLowerCase()] = t
        return {
          token:         t.tokenAddress,
          curve:         t.curveAddress,
          creator:       t.creator,
          name:          t.name,
          symbol:        t.symbol,
          graduated:     t.graduated,
          monRaisedNet:  BigInt(t.monRaisedNet || '0'),
          capMon:        BigInt(t.capMon || '0'),
          bondedBps:     BigInt(t.bondedBps || '0'),
          marketCap:     BigInt(t.marketCap || '0'),
          blockNumber:   BigInt(t.blockNumber || '0'),
          colorIdx:      i,
          // stats from server
          vol24h:        t.vol24h        || 0,
          uniqueBuyers:  t.uniqueBuyers  || 0,
          ath:           t.ath           || 0,
          change24h:     t.change24h     || 0,
          // metadata
          pfpUrl:        t.pfpUrl        || null,
          bannerUrl:     t.bannerUrl     || null,
          desc:          t.desc          || t.description || '',
          twitter:       t.twitter       || '',
          website:       t.website       || '',
        }
      })
      // fill with demo tokens until 10 real ones exist
      const demoCount = Math.max(0, 10 - list.length)
      const combined = demoCount > 0 ? [...list, ...makeDemoTokens(_demoBases).slice(0, demoCount)] : list
      setTokens(combined)
      setMetas(map)
    } catch (e) {
      console.error('loadTokens:', e)
    } finally {
      setLoading(false)
    }
  }

  // Animate demo token market caps to simulate live buys/sells
  useEffect(() => {
    const iv = setInterval(() => {
      setTokens(prev => {
        const hasReal = prev.filter(t => !t.isDemo).length
        const needsDemo = hasReal < 10
        if (!needsDemo) return prev
        // pick a random demo token and nudge its MC
        const demoIdx = Math.floor(Math.random() * _demoBases.length)
        const base = _demoBases[demoIdx]
        if (base.graduated) return prev // don't move graduated tokens
        // random ±0.5% to ±3% move, slight upward bias
        const changePct = (Math.random() * 3.5 - 1.0) / 100
        const newMc = Math.max(10000, base._mc * (1 + changePct))
        // nudge bondedBps proportionally (cap at 9999 for non-graduated)
        const newBps = Math.min(9999, Math.max(100, Math.round(base._bps * (1 + changePct * 0.5))))
        _demoBases[demoIdx] = { ...base, _mc: newMc, _bps: newBps }
        return prev.map(t => {
          if (!t.isDemo || t.token !== base.token) return t
          return {
            ...t,
            marketCap:    BigInt(Math.floor(newMc * 1e18)),
            monRaisedNet: BigInt(Math.floor(newMc * 1e18)),
            bondedBps:    BigInt(newBps),
          }
        })
      })
    }, 2500)
    return () => clearInterval(iv)
  }, [])

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
  const trending = [...tokens].sort((a,b) => {
    const mcA = Number(a.marketCap || a.monRaisedNet || 0n)
    const mcB = Number(b.marketCap || b.monRaisedNet || 0n)
    return mcB - mcA
  }).slice(0,6)

  return (
    <Layout>
      {/* LAUNCH BANNER */}
      <div className="launch-banner" style={{ margin:'12px 16px', padding:'16px 18px', background:'linear-gradient(135deg,rgba(110,84,255,0.12),rgba(133,230,255,0.06))', border:'1px solid rgba(110,84,255,0.2)', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, marginBottom:3, display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ background:'linear-gradient(135deg,var(--p),var(--cyan))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>MonPad</span>
            <span style={{ fontSize:12, color:'var(--t2)', fontWeight:600 }}>is live on Monad</span>
          </div>
          <div style={{ fontSize:11, color:'var(--t3)' }}>Fair launch · No presale · Devs earn 1.5% forever</div>
        </div>
        <button onClick={() => router.push('/create')}
          style={{ padding:'10px 20px', background:'linear-gradient(135deg,var(--p),var(--cyan))', border:'none', borderRadius:10, color:'white', fontWeight:800, fontSize:13, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, boxShadow:'0 4px 20px rgba(110,84,255,0.3)' }}>
          + Launch Token
        </button>
      </div>
      {/* TRENDING CAROUSEL */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 16px 10px' }}>
        <div className="trending-title" style={{ fontSize:17, fontWeight:800 }}>Trending coins</div>
        <div className="trending-arrows" style={{ display:'flex', gap:6 }}>
          {['‹','›'].map((ch,i) => (
            <button key={ch}
              onClick={() => carouselRef.current?.scrollBy({ left: i===0?-240:240, behavior:'smooth' })}
              style={{ width:30, height:30, borderRadius:'50%', background:'var(--bg2)', border:'1px solid var(--bd2)', color:'var(--t2)', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div ref={carouselRef} style={{ display:'flex', gap:10, padding:'0 16px 8px', overflowX:'scroll', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', msOverflowStyle:'none' }}>
        {trending.length === 0 && !loading && (
          <div style={{ color:'var(--t3)', fontSize:13, padding:'20px 0' }}>No tokens yet — launch the first one!</div>
        )}
        {loading && [0,1,2,4].map(i => (
          <div key={i} style={{ flexShrink:0, width:'min(230px, 60vw)', height:145, borderRadius:12, background:'var(--bg2)', scrollSnapAlign:'start', animation:'pulse 1.5s infinite' }} />
        ))}
        {trending.map((t,i) => {
          const meta = metas[t.token?.toLowerCase()]
          const isLive = live.has(t.token?.toLowerCase())
          const color  = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]
          return (
            <div key={t.token} onClick={() => router.push(`/token/${t.token}`)}
              style={{ flexShrink:0, width:'min(230px, 60vw)', borderRadius:12, overflow:'hidden', position:'relative', cursor:'pointer', scrollSnapAlign:'start', background: meta?.bannerUrl ? '#000' : `linear-gradient(135deg,${color}22,${color}08)`, border:`1px solid ${color}22` }}>
              {meta?.bannerUrl
                ? <img src={fixUrl(meta.bannerUrl)} alt="" className="trend-carousel-card-img" style={{ width:'100%', height:100, objectFit:'cover', display:'block' }} />
                : <div className="trend-carousel-card-img" style={{ height:100, display:'flex', alignItems:'center', justifyContent:'center', fontSize:42, fontWeight:900, color:`${color}20` }}>{(t.symbol||'?').slice(0,2)}</div>
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
                  <div style={{ fontSize:18, fontWeight:800, color:'white', lineHeight:1.1 }}>{fmtUSD(t.marketCap || t.monRaisedNet, monPrice)}</div>
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
      <div className="token-grid-wrap" style={{ padding:'12px 16px' }}>
        {loading && (
          <div className="token-grid">
            {[...Array(8)].map((_,i) => (
              <div key={i} style={{ borderRadius:12, background:'var(--bg2)', animation:'pulse 1.5s infinite', height:200 }} />
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
              <TokenCard key={t.token} token={t} meta={metas[t.token?.toLowerCase()]} isLive={live.has(t.token?.toLowerCase())} monPrice={monPrice} onClick={() => !t.isDemo && router.push(`/token/${t.token}`)} />
            ))}
            {list.length < 6 && Array.from({ length: Math.max(0, 4 - list.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="tcard" style={{ opacity:0.35, cursor:'default' }}>
                <div className="tcard-img" style={{ background:'var(--bg3)', fontSize:32 }}>
                  {['🚀','💎','🔥','⚡'][i]}
                </div>
                <div className="tcard-body">
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--t3)', marginBottom:2 }}>Your token here</div>
                  <div style={{ fontSize:10, color:'var(--p2)', fontWeight:600 }}>+ Launch →</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function shortAddr(a) {
  if (!a) return ''
  return a.length > 10 ? `${a.slice(0,6)}…${a.slice(-4)}` : a
}

function fmtMONval(n) {
  if (!n || n <= 0) return '$0'
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n/1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function TokenCard({ token: t, meta, isLive, monPrice, onClick }) {
  const pct        = Number(t.bondedBps) / 100
  const color      = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]
  const mcDisplay  = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
  const change24h  = t.change24h || 0
  const isUp       = change24h >= 0
  const imgUrl     = fixUrl(t.pfpUrl || meta?.pfpUrl || '')
  const symbol     = t.symbol  || meta?.symbol || '??'
  const name       = t.name    || meta?.name   || 'Unknown'
  const desc       = t.desc    || meta?.desc   || meta?.description || ''
  const contract   = t.token   || t.tokenAddress || ''

  // ATH: t.ath is price in MON per token, MC = ath * 1B supply
  const athMon = t.ath > 0 ? t.ath * 1_000_000_000 : 0
  const athDisplay = athMon > 0 ? fmtUSD(BigInt(Math.floor(athMon * 1e18)), monPrice) : null

  return (
    <div className="tcard" onClick={onClick} style={{ cursor: t.isDemo ? 'default' : 'pointer', opacity: t.isDemo ? 0.85 : 1 }}>

      {/* ── Image left ── */}
      <div className="tcard-img" style={{ background: imgUrl ? '#000' : `linear-gradient(135deg,${color}55,${color}11)` }}>
        {imgUrl
          ? <img src={imgUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display='none'; e.target.parentNode.style.background=`linear-gradient(135deg,${color}55,${color}11)` }} />
          : <span style={{ fontSize:30, fontWeight:900, color:color, textShadow:`0 0 20px ${color}88` }}>{symbol.slice(0,2).toUpperCase()}</span>
        }
        {t.graduated && <div className="tcard-badge" style={{ background:'var(--gold)', color:'#000' }}>🎓</div>}
        {isLive && !t.graduated && (
          <div className="tcard-badge" style={{ display:'flex', alignItems:'center', gap:3, background:'#ef4444' }}>
            <span style={{ width:5, height:5, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />LIVE
          </div>
        )}
      </div>

      {/* ── Info right ── */}
      <div className="tcard-body">

        {/* Top: symbol + 24h change */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
          <div style={{ background:'rgba(110,84,255,0.25)', borderRadius:6, padding:'2px 9px', fontSize:11, fontWeight:800, color:'var(--p2)', fontFamily:'var(--mono)' }}>
            ${symbol}
          </div>
          {change24h !== 0 && (
            <span style={{ fontSize:11, fontWeight:700, color: isUp ? 'var(--g)' : 'var(--r)', fontFamily:'var(--mono)' }}>
              {isUp ? '▲' : '▼'}{Math.abs(change24h).toFixed(1)}%
            </span>
          )}
        </div>

        {/* Name */}
        <div style={{ fontSize:15, fontWeight:800, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}>
          {name}
        </div>

        {/* Description */}
        {desc && (
          <div style={{ fontSize:11, color:'var(--t3)', lineHeight:1.4, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', marginBottom:4 }}>
            {desc}
          </div>
        )}

        {/* Contract address */}
        <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--mono)', marginBottom:6 }}>
          {shortAddr(contract)}
        </div>

        {/* Stats: MC + ATH */}
        <div style={{ display:'flex', gap:10, marginBottom:6 }}>
          <div>
            <span style={{ fontSize:10, color:'var(--t3)' }}>MC </span>
            <span style={{ fontSize:12, fontWeight:800, fontFamily:'var(--mono)', color:'var(--gold)' }}>{mcDisplay}</span>
          </div>
          {athDisplay && (
            <div>
              <span style={{ fontSize:10, color:'var(--t3)' }}>ATH </span>
              <span style={{ fontSize:12, fontWeight:700, fontFamily:'var(--mono)', color:'var(--p2)' }}>{athDisplay}</span>
            </div>
          )}
        </div>

        {/* Bonding progress bar */}
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--t3)', marginBottom:3 }}>
          <span>Bonding curve</span>
          <span style={{ fontWeight:700, color: t.graduated ? 'var(--g)' : 'var(--p3)', fontFamily:'var(--mono)' }}>
            {t.graduated ? '✓ Grad' : `${pct.toFixed(1)}%`}
          </span>
        </div>
        <div style={{ width:'100%', height:5, background:'var(--bg3)', borderRadius:999, overflow:'hidden' }}>
          <div style={{
            height:'100%',
            background: t.graduated ? 'linear-gradient(90deg,#d97706,#FFAE45)' : 'linear-gradient(90deg,var(--p),var(--cyan))',
            borderRadius:999,
            width:`${Math.min(pct,100)}%`,
            transition:'width .4s ease'
          }} />
        </div>

      </div>
    </div>
  )
}
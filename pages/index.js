import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { fmtUSD, fmtAddr } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

function fixUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  if (url.startsWith('http://api.monpad.net')) return url.replace('http://api.monpad.net', 'https://api.monpad.net')
  return url
}

function fmtNum(n) {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}

const TABS = [
  { id: 'new',       label: '🌱 New'       },
  { id: 'movers',    label: '🔥 Hot'       },
  { id: 'marketcap', label: '💎 Market Cap' },
  { id: 'trenches',  label: '⚔️ Trenches'  },
  { id: 'grad',      label: '🎓 Graduated' },
]

const COLORS = ['#6E54FF','#a78bfa','#85E6FF','#FF8EE4','#FFAE45','#22c55e','#f472b6','#38bdf8']

export default function Home() {
  const router = useRouter()
  const [tab, setTab]         = useState('new')
  const [tokens, setTokens]   = useState([])
  const [liveRooms, setLive]  = useState([])
  const [loading, setLoading] = useState(true)
  const [monPrice, setMonPrice] = useState(0)
  const [search, setSearch]   = useState('')
  const carouselRef = useRef(null)

  // MON price
  useEffect(() => {
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
  }, [])

  // load tokens
  useEffect(() => { loadTokens() }, [])

  // live rooms
  useEffect(() => {
    if (!SERVER) return
    const poll = () => fetch(`${SERVER}/api/live`).then(r => r.json()).then(d => setLive(d.live || [])).catch(() => {})
    poll()
    const iv = setInterval(poll, 15000)
    return () => clearInterval(iv)
  }, [])

  // websocket price updates
  useEffect(() => {
    if (!SERVER) return
    const wsUrl = SERVER.replace('https://', 'wss://').replace('http://', 'ws://')
    let ws, retry
    function connect() {
      ws = new WebSocket(wsUrl)
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'price_update') {
            setTokens(prev => prev.map(t =>
              t.token?.toLowerCase() === msg.tokenAddress?.toLowerCase()
                ? { ...t, marketCap: BigInt(msg.marketCap || '0'), monRaisedNet: BigInt(msg.monRaisedNet || '0'), bondedBps: BigInt(msg.bondedBps || '0') }
                : t
            ))
          }
        } catch {}
      }
      ws.onclose = () => { retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { ws?.close(); clearTimeout(retry) }
  }, [])

  async function loadTokens() {
    if (!SERVER) { setLoading(false); return }
    try {
      const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
      const list = data.map((t, i) => ({
        ...t,
        token:        t.tokenAddress,
        curve:        t.curveAddress,
        monRaisedNet: BigInt(t.monRaisedNet || '0'),
        capMon:       BigInt(t.capMon       || '0'),
        bondedBps:    BigInt(t.bondedBps    || '0'),
        marketCap:    BigInt(t.marketCap    || '0'),
        blockNumber:  BigInt(t.blockNumber  || '0'),
        colorIdx:     i,
        vol24h:       t.vol24h       || 0,
        uniqueBuyers: t.uniqueBuyers || 0,
        ath:          t.ath          || 0,
        change24h:    t.change24h    || 0,
        pfpUrl:       fixUrl(t.pfpUrl    || ''),
        bannerUrl:    fixUrl(t.bannerUrl || ''),
        desc:         t.desc || t.description || '',
      }))
      setTokens(list)
    } catch (e) {
      console.error('loadTokens:', e)
    } finally {
      setLoading(false)
    }
  }

  const liveSet = new Set(liveRooms.map(a => a.toLowerCase()))

  function filtered() {
    let list = [...tokens]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.name?.toLowerCase().includes(q) || t.symbol?.toLowerCase().includes(q))
    }
    if (tab === 'grad')      return list.filter(t => t.graduated)
    if (tab === 'trenches')  return list.filter(t => !t.graduated && Number(t.bondedBps) >= 5000)
    if (tab === 'movers')    return list.sort((a, b) => (b.change24h || 0) - (a.change24h || 0))
    if (tab === 'marketcap') return list.sort((a, b) => Number(b.marketCap - a.marketCap))
    // new (default)
    return list
  }

  const list    = filtered()
  const trending = [...tokens].sort((a, b) => Number(b.marketCap - a.marketCap)).slice(0, 8)

  return (
    <Layout>

      {/* ═══ HERO BANNER ═══ */}
      <div style={{
        margin: '12px 16px',
        padding: '24px 20px',
        background: 'linear-gradient(135deg, rgba(110,84,255,0.15) 0%, rgba(133,230,255,0.06) 100%)',
        border: '1px solid rgba(110,84,255,0.25)',
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 0,
      }}>
        <div>
          <img src="/monpad-logo.png" alt="MonPad" style={{ width: 120, height: 120, borderRadius: 20, objectFit: 'cover', marginBottom: 10, boxShadow: '0 4px 24px rgba(110,84,255,0.4)' }} />
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 4, letterSpacing: '-0.5px' }}>MonPad</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500, marginBottom: 16 }}>Fair launch · No presale · Devs earn 1.5% forever · 10 MON to launch</div>
        </div>
        <button
          onClick={() => router.push('/create')}
          style={{
            padding: '14px 36px',
            background: 'linear-gradient(135deg,#6E54FF,#85E6FF)',
            border: 'none', borderRadius: 14,
            color: 'white', fontWeight: 800, fontSize: 16,
            cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: '0 4px 24px rgba(110,84,255,0.4)',
            transition: 'transform .15s, box-shadow .15s',
          }}
          onMouseEnter={e => { e.target.style.transform='translateY(-1px)'; e.target.style.boxShadow='0 6px 30px rgba(110,84,255,0.55)' }}
          onMouseLeave={e => { e.target.style.transform='translateY(0)';    e.target.style.boxShadow='0 4px 24px rgba(110,84,255,0.4)' }}
        >
          + Launch Token
        </button>
      </div>

      {/* ═══ TRENDING CAROUSEL ═══ */}
      <div style={{ padding: '4px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--t2)' }}>🔥 Trending</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['‹','›'].map((ch, i) => (
            <button key={ch} onClick={() => carouselRef.current?.scrollBy({ left: i === 0 ? -220 : 220, behavior: 'smooth' })}
              style={{ width:28, height:28, borderRadius:'50%', background:'var(--bg2)', border:'1px solid var(--bd2)', color:'var(--t2)', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div ref={carouselRef} style={{ display:'flex', gap:12, padding:'0 16px 16px', overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
        {trending.map((t, i) => {
          const color = COLORS[t.colorIdx % COLORS.length]
          const mc    = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
          return (
            <div key={t.token} onClick={() => router.push(`/token/${t.token}`)}
              style={{
                flexShrink: 0, width: 240, borderRadius: 18, overflow: 'hidden',
                position: 'relative', cursor: 'pointer',
                border: `1px solid ${color}33`,
                background: t.bannerUrl ? '#000' : `linear-gradient(135deg,${color}22,${color}08)`,
                transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform='translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform='translateY(0)'}
            >
              {t.bannerUrl
                ? <img src={t.bannerUrl} alt="" style={{ width:'100%', height:160, objectFit:'cover', display:'block' }} />
                : <div style={{ height:160, display:'flex', alignItems:'center', justifyContent:'center', fontSize:56, fontWeight:900, color:`${color}40` }}>
                    {t.pfpUrl
                      ? <img src={t.pfpUrl} alt="" style={{ width:100, height:100, borderRadius:'50%', objectFit:'cover', border:`3px solid ${color}66` }} />
                      : (t.symbol||'?').slice(0,2)
                    }
                  </div>
              }
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 55%)', pointerEvents:'none' }} />
              {liveSet.has(t.token?.toLowerCase()) && (
                <div style={{ position:'absolute', top:6, left:6, background:'#ef4444', color:'white', fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:4, display:'flex', alignItems:'center', gap:3 }}>
                  <span style={{ width:5, height:5, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />LIVE
                </div>
              )}
              <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'12px 14px', zIndex:2 }}>
                <div style={{ fontSize:19, fontWeight:900, color:'white', lineHeight:1.1 }}>{mc}</div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.65)', fontWeight:700 }}>${t.symbol}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══ SEARCH + TABS ═══ */}
      <div style={{ padding: '0 16px 10px' }}>
        <div style={{ position:'relative', marginBottom:10 }}>
          <svg style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', width:16, height:16, color:'var(--t3)', pointerEvents:'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="Search tokens..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width:'100%', background:'var(--bg2)', border:'1px solid var(--bd)', borderRadius:12, padding:'10px 12px 10px 36px', fontSize:14, color:'var(--t1)', outline:'none', fontFamily:'var(--sans)' }}
          />
        </div>

        <div style={{ display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                flexShrink:0, padding:'8px 16px', borderRadius:10, fontSize:13, fontWeight:700, border:'none', cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
                background: tab === t.id ? 'var(--p)' : 'var(--bg2)',
                color:      tab === t.id ? 'white'    : 'var(--t2)',
                boxShadow:  tab === t.id ? '0 4px 16px rgba(110,84,255,0.4)' : 'none',
                outline: tab === t.id ? 'none' : '1px solid var(--bd)',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TOKEN GRID ═══ */}
      <div style={{ padding:'0 16px 100px' }}>

        {loading && (
          <>
            {/* Desktop skeleton */}
            <div className="desktop-grid" style={{ display:'none' }}>
              {[...Array(8)].map((_, i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:10, borderRadius:12, background:'var(--bg2)', animation:'pulse 1.5s infinite', height:100 }} />
              ))}
            </div>
            {/* Mobile skeleton */}
            <div className="mobile-list">
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width:80, height:80, borderRadius:16, background:'var(--bg2)', animation:'pulse 1.5s infinite', flexShrink:0 }} />
                  <div style={{ width:90, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ width:80, height:17, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                    <div style={{ width:55, height:13, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                  </div>
                  <div style={{ flex:1, height:60, borderRadius:8, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                  <div style={{ width:65, height:24, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite', flexShrink:0 }} />
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && list.length === 0 && (
          <div style={{ textAlign:'center', padding:'60px 0' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🚀</div>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>No tokens yet</div>
            <div style={{ fontSize:13, color:'var(--t3)', marginBottom:20 }}>Be the first to launch on MonPad</div>
            <button onClick={() => router.push('/create')}
              style={{ padding:'12px 28px', background:'var(--p)', border:'none', borderRadius:12, color:'white', fontWeight:800, fontSize:14, cursor:'pointer' }}>
              Launch Now
            </button>
          </div>
        )}

        {!loading && list.length > 0 && (
          <>
            {/* ── DESKTOP: 4-col pump.fun card grid ── */}
            <div className="desktop-grid" style={{ display:'none' }}>
              {list.map(t => (
                <TokenCard
                  key={t.token}
                  token={t}
                  monPrice={monPrice}
                  isLive={liveSet.has(t.token?.toLowerCase())}
                  onClick={() => router.push(`/token/${t.token}`)}
                />
              ))}
            </div>

            {/* ── MOBILE: single-row list with sparkline ── */}
            <div className="mobile-list" style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {list.map(t => (
                <TokenRow
                  key={t.token}
                  token={t}
                  monPrice={monPrice}
                  isLive={liveSet.has(t.token?.toLowerCase())}
                  onClick={() => router.push(`/token/${t.token}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        input:focus { border-color: rgba(110,84,255,0.5) !important; }

        /* Desktop: show card grid, hide row list */
        @media (min-width: 640px) {
          .desktop-grid {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
          }
          .mobile-list { display: none !important; }
        }

        /* Mobile: show row list, hide card grid */
        @media (max-width: 639px) {
          .desktop-grid { display: none !important; }
          .mobile-list  { display: flex !important; flex-direction: column; gap: 2px; }
        }

        .token-card:hover  { background: rgba(255,255,255,0.05) !important; }
        .token-row:hover   { background: rgba(110,84,255,0.06) !important; }
      `}</style>
    </Layout>
  )
}

// ─── Desktop pump.fun card (4-col grid) ──────────────────────────────────────
function TokenCard({ token: t, monPrice, isLive, onClick }) {
  const color  = COLORS[t.colorIdx % COLORS.length]
  const mc     = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
  const change = t.change24h || 0
  const isUp   = change >= 0
  const symbol = t.symbol || '??'
  const name   = t.name   || 'Unknown'
  const imgUrl = t.pfpUrl || ''
  const desc   = t.desc   || ''
  const pct    = Math.min(100, Number(t.bondedBps) / 100)
  const creator = t.creator ? t.creator.slice(0, 6) : ''
  const timeAgo = t.createdAt
    ? (() => {
        const diff = Math.floor((Date.now() - t.createdAt) / 1000)
        if (diff < 60)         return `${diff}s ago`
        if (diff < 3600)       return `${Math.floor(diff/60)}m ago`
        if (diff < 86400)      return `${Math.floor(diff/3600)}h ago`
        return `${Math.floor(diff/86400)}d ago`
      })()
    : ''

  return (
    <div
      className="token-card"
      onClick={onClick}
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--bd)',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color .15s, box-shadow .15s',
        display: 'flex',
        flexDirection: 'row',
        gap: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${color}55`
        e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.35)`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--bd)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* ── Square image ── */}
      <div style={{
        width: 90, minHeight: 90, flexShrink: 0,
        background: imgUrl ? '#000' : `linear-gradient(135deg,${color}44,${color}11)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {imgUrl
          ? <img src={imgUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display='none' }} />
          : <span style={{ fontSize:26, fontWeight:900, color, textShadow:`0 0 16px ${color}` }}>
              {symbol.slice(0,2).toUpperCase()}
            </span>
        }
        {t.graduated && (
          <div style={{ position:'absolute', top:4, left:4, background:'#d97706', color:'white', fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:5 }}>🎓</div>
        )}
        {isLive && !t.graduated && (
          <div style={{ position:'absolute', top:4, left:4, background:'#ef4444', color:'white', fontSize:9, fontWeight:800, padding:'2px 5px', borderRadius:4, display:'flex', alignItems:'center', gap:3 }}>
            <span style={{ width:5, height:5, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite', flexShrink:0 }} />LIVE
          </div>
        )}
      </div>

      {/* ── Right: all info ── */}
      <div style={{ flex:1, minWidth:0, padding:'8px 10px', display:'flex', flexDirection:'column', gap:3 }}>

        {/* Name */}
        <div style={{ fontWeight:800, fontSize:14, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>
          {name}
        </div>

        {/* Ticker */}
        <div style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)', fontWeight:600 }}>
          {symbol}
        </div>

        {/* Creator + time */}
        <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--t3)' }}>
          <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:'#22c55e', flexShrink:0 }} />
          <span style={{ fontFamily:'var(--mono)', color:'var(--t2)' }}>{creator}</span>
          {timeAgo && <span style={{ color:'var(--t3)' }}>{timeAgo}</span>}
        </div>

        {/* Description */}
        {desc && (
          <div style={{ fontSize:11, color:'var(--t3)', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', lineHeight:1.4, marginTop:2 }}>
            {desc}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex:1 }} />

        {/* MC + progress + change */}
        <div style={{ marginTop: 4 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
            <span style={{ fontSize:12, color:'var(--t3)' }}>MC</span>
            <span style={{ fontSize:12, fontWeight:800, color:'var(--t1)', fontFamily:'var(--mono)' }}>{mc}</span>
            {/* Progress bar */}
            <div style={{ flex:1, height:4, borderRadius:999, background:'rgba(255,255,255,0.08)', overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius:999,
                width: `${pct}%`,
                background: t.graduated
                  ? 'linear-gradient(90deg,#22c55e,#16a34a)'
                  : `linear-gradient(90deg,${color},${color}99)`,
                boxShadow: `0 0 6px ${color}66`,
                transition: 'width .4s',
              }} />
            </div>
            {/* % change */}
            {change !== 0 && (
              <span style={{ fontSize:11, fontWeight:700, color: isUp ? '#22c55e' : '#ef4444', fontFamily:'var(--mono)', flexShrink:0 }}>
                {isUp ? '↑' : '↓'}{Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Full-width responsive sparkline (stretches to fill container) ───────────
function SparklineFill({ prices, color = '#00ff88', height = 80 }) {
  const isUp = prices && prices.length >= 2
    ? prices[prices.length - 1] >= prices[0]
    : true
  const lineColor = isUp ? '#00ff88' : '#ef4444'

  if (!prices || prices.length < 2) {
    return (
      <svg width="100%" height={height} viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={2} y1={65} x2={98} y2={65} stroke={lineColor} strokeWidth={3} strokeOpacity={0.35} strokeLinecap="round" />
      </svg>
    )
  }

  const W = 100, H = 100
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const padX = 2, padY = 8

  const pts = prices.map((p, i) => [
    padX + (i / (prices.length - 1)) * (W - padX * 2),
    padY + (1 - (p - min) / range) * (H - padY * 2),
  ])

  // Smooth bezier
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i-1][0] + pts[i][0]) / 2
    d += ` C ${cx.toFixed(1)} ${pts[i-1][1].toFixed(1)}, ${cx.toFixed(1)} ${pts[i][1].toFixed(1)}, ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`
  }

  const uid = `glow-${lineColor.replace('#','')}`

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <filter id={uid}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* soft glow underneath */}
      <path d={d} fill="none" stroke={lineColor} strokeWidth={5} strokeOpacity={0.18}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* sharp bright line */}
      <path d={d} fill="none" stroke={lineColor} strokeWidth={2.5}
        strokeLinejoin="round" strokeLinecap="round" filter={`url(#${uid})`} />
    </svg>
  )
}

// ─── Sparkline SVG ───────────────────────────────────────────────────────────
function Sparkline({ prices, color = '#22c55e', width = 100, height = 50 }) {
  if (!prices || prices.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={4} y1={height * 0.65} x2={width - 4} y2={height * 0.65}
          stroke={color} strokeWidth={2} strokeOpacity={0.35} strokeLinecap="round" />
      </svg>
    )
  }

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const padX = 4, padY = 5

  const pts = prices.map((p, i) => {
    const x = padX + (i / (prices.length - 1)) * (width - padX * 2)
    const y = padY + (1 - (p - min) / range) * (height - padY * 2)
    return [x, y]
  })

  // Smooth bezier path
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1][0] + pts[i][0]) / 2
    d += ` C ${cx.toFixed(1)} ${pts[i-1][1].toFixed(1)}, ${cx.toFixed(1)} ${pts[i][1].toFixed(1)}, ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`
  }

  const isUp = prices[prices.length - 1] >= prices[0]
  const lineColor = isUp ? '#00ff88' : '#ef4444'
  const glowId = `glow-${width}-${height}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Glow layer */}
      <path d={d} fill="none" stroke={lineColor} strokeWidth={3.5} strokeOpacity={0.25}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* Sharp line on top */}
      <path d={d} fill="none" stroke={lineColor} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" filter={`url(#${glowId})`} />
    </svg>
  )
}

// ─── Pump.fun mobile row ─────────────────────────────────────────────────────
function TokenRow({ token: t, monPrice, isLive, onClick }) {
  const [sparkPrices, setSparkPrices] = useState(null)

  const color  = COLORS[t.colorIdx % COLORS.length]
  const mc     = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
  const symbol = t.symbol || '??'
  const name   = t.name   || 'Unknown'
  const imgUrl = t.pfpUrl || ''

  // Ticker truncated: first 2 chars + "..."
  const tickerShort = symbol.length > 3 ? symbol.slice(0, 2) + '...' : symbol

  // Time ago (short)
  const timeAgo = t.createdAt
    ? (() => {
        const diff = Math.floor((Date.now() - t.createdAt) / 1000)
        if (diff < 60)    return `${diff}s`
        if (diff < 3600)  return `${Math.floor(diff / 60)}m`
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`
        return `${Math.floor(diff / 86400)}d`
      })()
    : ''

  useEffect(() => {
    if (!t.curve || !SERVER) return
    fetch(`${SERVER}/api/candles/${t.curve}?interval=15m`)
      .then(r => r.json())
      .then(data => {
        const candles = data?.candles || []
        if (candles.length >= 2) setSparkPrices(candles.map(c => c.close))
      })
      .catch(() => {})
  }, [t.curve])

  const sparkIsUp = sparkPrices ? sparkPrices[sparkPrices.length - 1] >= sparkPrices[0] : true
  const sparkColor = sparkIsUp ? '#00ff88' : '#ef4444'

  return (
    <div
      className="token-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        transition: 'background .12s',
      }}
    >
      {/* ── Large square image ── */}
      <div style={{
        width: 88, height: 88, borderRadius: 16, flexShrink: 0,
        background: imgUrl ? '#111' : `linear-gradient(135deg,${color}55,${color}11)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
      }}>
        {imgUrl
          ? <img src={imgUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display = 'none' }} />
          : <span style={{ fontSize:30, fontWeight:900, color, textShadow:`0 0 14px ${color}` }}>
              {symbol.slice(0, 2).toUpperCase()}
            </span>
        }
        {t.graduated && (
          <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'#d97706dd', color:'white', fontSize:9, fontWeight:800, textAlign:'center', padding:'2px 0' }}>GRAD</div>
        )}
        {isLive && !t.graduated && (
          <div style={{ position:'absolute', top:5, right:5, width:9, height:9, borderRadius:'50%', background:'#ef4444', boxShadow:'0 0 7px #ef4444', animation:'blink 1.5s infinite' }} />
        )}
      </div>

      {/* ── Name + sub-line — grows to fill space ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#ffffff', lineHeight: 1.25, marginBottom: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {name}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:13, color:'rgba(255,255,255,0.4)' }}>
          <span style={{ fontFamily:'var(--mono)' }}>{tickerShort}</span>
          <span style={{ color:'#22c55e' }}>🌱</span>
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* ── Sparkline — fixed 110px ── */}
      <div style={{ flexShrink: 0, width: 110, height: 56 }}>
        <SparklineFill prices={sparkPrices} color={sparkColor} height={56} />
      </div>

      {/* ── Market Cap — large, bold ── */}
      <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 64 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', whiteSpace: 'nowrap', letterSpacing: '-0.5px' }}>
          {mc}
        </div>
        {t.graduated && (
          <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginTop: 2 }}>✓ Grad</div>
        )}
      </div>
    </div>
  )
}

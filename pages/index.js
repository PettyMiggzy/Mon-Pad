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
        padding: '20px',
        background: 'linear-gradient(135deg, rgba(110,84,255,0.15) 0%, rgba(133,230,255,0.06) 100%)',
        border: '1px solid rgba(110,84,255,0.25)',
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.5px', marginBottom: 4 }}>
            <span style={{ background: 'linear-gradient(135deg,#6E54FF,#85E6FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MonPad</span>
            <span style={{ color: 'var(--t2)', fontWeight: 600, fontSize: 14, marginLeft: 8 }}>on Monad</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>Fair launch · No presale · Devs earn 1.5% forever · 10 MON to launch</div>
        </div>
        <button
          onClick={() => router.push('/create')}
          style={{
            padding: '12px 24px',
            background: 'linear-gradient(135deg,#6E54FF,#85E6FF)',
            border: 'none', borderRadius: 12,
            color: 'white', fontWeight: 800, fontSize: 14,
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
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--t2)' }}>🔥 Trending</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['‹','›'].map((ch, i) => (
            <button key={ch} onClick={() => carouselRef.current?.scrollBy({ left: i === 0 ? -220 : 220, behavior: 'smooth' })}
              style={{ width:28, height:28, borderRadius:'50%', background:'var(--bg2)', border:'1px solid var(--bd2)', color:'var(--t2)', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div ref={carouselRef} style={{ display:'flex', gap:10, padding:'0 16px 12px', overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
        {trending.map((t, i) => {
          const color = COLORS[t.colorIdx % COLORS.length]
          const mc    = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
          return (
            <div key={t.token} onClick={() => router.push(`/token/${t.token}`)}
              style={{
                flexShrink: 0, width: 160, borderRadius: 14, overflow: 'hidden',
                position: 'relative', cursor: 'pointer',
                border: `1px solid ${color}33`,
                background: t.bannerUrl ? '#000' : `linear-gradient(135deg,${color}22,${color}08)`,
                transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform='translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform='translateY(0)'}
            >
              {t.bannerUrl
                ? <img src={t.bannerUrl} alt="" style={{ width:'100%', height:90, objectFit:'cover', display:'block' }} />
                : <div style={{ height:90, display:'flex', alignItems:'center', justifyContent:'center', fontSize:36, fontWeight:900, color:`${color}40` }}>
                    {t.pfpUrl
                      ? <img src={t.pfpUrl} alt="" style={{ width:60, height:60, borderRadius:'50%', objectFit:'cover', border:`2px solid ${color}55` }} />
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
              <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'8px 10px', zIndex:2 }}>
                <div style={{ fontSize:13, fontWeight:800, color:'white', lineHeight:1.1 }}>{mc}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', fontWeight:600 }}>${t.symbol}</div>
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
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px' }}>
                <div style={{ width:52, height:52, borderRadius:12, background:'var(--bg2)', animation:'pulse 1.5s infinite', flexShrink:0 }} />
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                  <div style={{ width:120, height:14, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                  <div style={{ width:80, height:10, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                </div>
                <div style={{ width:100, height:40, borderRadius:8, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
                <div style={{ width:72, height:20, borderRadius:6, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
              </div>
            ))}
          </div>
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
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
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
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        input:focus { border-color: rgba(110,84,255,0.5) !important; }
        .token-row:hover { background: rgba(110,84,255,0.06) !important; }
      `}</style>
    </Layout>
  )
}

// ─── Sparkline SVG ───────────────────────────────────────────────────────────
function Sparkline({ prices, color = '#22c55e', width = 100, height = 40 }) {
  if (!prices || prices.length < 2) {
    // flat line if no data
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth={1.5} strokeOpacity={0.4} />
      </svg>
    )
  }

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const pad = 3

  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (p - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const isUp = prices[prices.length - 1] >= prices[0]
  const lineColor = isUp ? '#22c55e' : '#ef4444'

  // Build fill path (close down to bottom)
  const fillD = `M ${pts[0]} L ${pts.join(' L ')} L ${(width - pad).toFixed(1)},${height} L ${pad},${height} Z`
  const lineD = `M ${pts.join(' L ')}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sg-${lineColor.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#sg-${lineColor.replace('#','')})`} />
      <path d={lineD} fill="none" stroke={lineColor} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── Pump.fun-style single row ────────────────────────────────────────────────
function TokenRow({ token: t, monPrice, isLive, onClick }) {
  const [sparkPrices, setSparkPrices] = useState(null)

  const color   = COLORS[t.colorIdx % COLORS.length]
  const mc      = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
  const change  = t.change24h || 0
  const isUp    = change >= 0
  const symbol  = t.symbol || '??'
  const name    = t.name   || 'Unknown'
  const imgUrl  = t.pfpUrl || ''
  const pct     = Math.min(100, Number(t.bondedBps) / 100)
  const holders = t.uniqueBuyers || 0

  // Load sparkline from candles API
  useEffect(() => {
    if (!t.curve || !SERVER) return
    fetch(`${SERVER}/api/candles/${t.curve}?interval=1h`)
      .then(r => r.json())
      .then(data => {
        const candles = data?.candles || []
        if (candles.length >= 2) {
          setSparkPrices(candles.map(c => c.close))
        }
      })
      .catch(() => {})
  }, [t.curve])

  // Determine sparkline color from real data or change24h
  const sparkIsUp = sparkPrices
    ? sparkPrices[sparkPrices.length - 1] >= sparkPrices[0]
    : isUp
  const sparkColor = sparkIsUp ? '#22c55e' : '#ef4444'

  return (
    <div
      className="token-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        transition: 'background .12s',
        borderRadius: 10,
      }}
    >
      {/* ── Avatar ── */}
      <div style={{
        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
        background: imgUrl ? '#000' : `linear-gradient(135deg,${color}55,${color}22)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        border: `1px solid ${color}33`,
      }}>
        {imgUrl
          ? <img src={imgUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
          : <span style={{ fontSize: 18, fontWeight: 900, color, textShadow: `0 0 12px ${color}` }}>{symbol.slice(0, 2).toUpperCase()}</span>
        }
        {t.graduated && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#d97706cc', color: 'white', fontSize: 8, fontWeight: 800, textAlign: 'center', padding: '1px 0' }}>GRAD</div>
        )}
        {isLive && !t.graduated && (
          <div style={{ position: 'absolute', top: 2, right: 2, width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 5px #ef4444', animation: 'blink 1.5s infinite' }} />
        )}
      </div>

      {/* ── Name + meta ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: 'var(--t1)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            {name}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
            ${symbol}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>
            👥 {fmtNum(holders)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
            {pct.toFixed(0)}% bonded
          </span>
          {change !== 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: isUp ? '#22c55e' : '#ef4444' }}>
              {isUp ? '▲' : '▼'}{Math.abs(change).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* ── Sparkline ── */}
      <div style={{ flexShrink: 0, width: 100, height: 40, display: 'flex', alignItems: 'center' }}>
        <Sparkline prices={sparkPrices} color={sparkColor} width={100} height={40} />
      </div>

      {/* ── Market Cap ── */}
      <div style={{ flexShrink: 0, minWidth: 72, textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>
          {mc}
        </div>
        {t.graduated && (
          <div style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', marginTop: 2 }}>✓ Grad</div>
        )}
      </div>
    </div>
  )
}

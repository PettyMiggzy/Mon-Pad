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
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:10 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ height:160, borderRadius:16, background:'var(--bg2)', animation:'pulse 1.5s infinite' }} />
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
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:10 }}>
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
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        input:focus { border-color: rgba(110,84,255,0.5) !important; }
      `}</style>
    </Layout>
  )
}

function TokenCard({ token: t, monPrice, isLive, onClick }) {
  const color   = COLORS[t.colorIdx % COLORS.length]
  const pct     = Math.min(100, Number(t.bondedBps) / 100)
  const mc      = fmtUSD(t.marketCap || t.monRaisedNet, monPrice)
  const change  = t.change24h || 0
  const isUp    = change >= 0
  const holders = t.uniqueBuyers || 0
  const symbol  = t.symbol || '??'
  const name    = t.name   || 'Unknown'
  const desc    = t.desc   || ''
  const imgUrl  = t.pfpUrl || ''
  const contract = t.token || ''

  // ATH market cap
  const athWei  = t.ath > 0 ? BigInt(Math.floor(t.ath * 1_000_000_000 * 1e18)) : null
  const athDisp = athWei ? fmtUSD(athWei, monPrice) : null

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--bd)',
        borderRadius: 16,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'transform .15s, border-color .15s, box-shadow .15s',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = `${color}55`
        e.currentTarget.style.boxShadow = `0 8px 30px rgba(0,0,0,0.3)`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'var(--bd)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* ── TOP ROW: image + info ── */}
      <div style={{ display:'flex', flexDirection:'row' }}>

        {/* Image */}
        <div style={{
          width: 110, height: 110, flexShrink: 0,
          background: imgUrl ? '#000' : `linear-gradient(135deg,${color}44,${color}11)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {imgUrl
            ? <img src={imgUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.target.style.display='none' }} />
            : <span style={{ fontSize:32, fontWeight:900, color, textShadow:`0 0 24px ${color}` }}>{symbol.slice(0,2).toUpperCase()}</span>
          }
          {/* badges */}
          {t.graduated && (
            <div style={{ position:'absolute', top:5, left:5, background:'#d97706', color:'white', fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:5 }}>🎓 GRAD</div>
          )}
          {isLive && !t.graduated && (
            <div style={{ position:'absolute', top:5, left:5, background:'#ef4444', color:'white', fontSize:9, fontWeight:800, padding:'2px 6px', borderRadius:5, display:'flex', alignItems:'center', gap:3 }}>
              <span style={{ width:5, height:5, background:'white', borderRadius:'50%', animation:'blink 1.5s infinite' }} />LIVE
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex:1, padding:'10px 12px', minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>

          {/* Symbol + change */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{
              background: `${color}30`, color, border: `1px solid ${color}55`,
              borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 800, fontFamily:'var(--mono)',
            }}>
              ${symbol}
            </span>
            {change !== 0 && (
              <span style={{ fontSize:11, fontWeight:700, color: isUp ? '#22c55e' : '#ef4444', fontFamily:'var(--mono)' }}>
                {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
              </span>
            )}
          </div>

          {/* Name */}
          <div style={{ fontSize:16, fontWeight:800, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {name}
          </div>

          {/* Description */}
          {desc ? (
            <div style={{ fontSize:11, color:'var(--t3)', lineHeight:1.4, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
              {desc}
            </div>
          ) : (
            <div style={{ fontSize:11, color:'var(--t3)', fontStyle:'italic' }}>No description</div>
          )}

          {/* Holders + contract */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:'auto' }}>
            <span style={{ fontSize:10, color:'var(--t3)', display:'flex', alignItems:'center', gap:3 }}>
              👥 <span style={{ color:'var(--t2)', fontWeight:600 }}>{fmtNum(holders)} holders</span>
            </span>
            <span style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--mono)' }}>
              {fmtAddr(contract)}
            </span>
          </div>

        </div>
      </div>

      {/* ── BOTTOM: MC / ATH / progress ── */}
      <div style={{ padding:'8px 12px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ fontSize:12 }}>
            <span style={{ color:'var(--t3)', marginRight:4 }}>MC</span>
            <span style={{ fontWeight:800, color:'var(--t1)', fontFamily:'var(--mono)' }}>{mc}</span>
          </div>
          {athDisp && (
            <div style={{ fontSize:12 }}>
              <span style={{ color:'var(--t3)', marginRight:4 }}>ATH</span>
              <span style={{ fontWeight:800, color:'var(--p2)', fontFamily:'var(--mono)' }}>{athDisp}</span>
            </div>
          )}
          <div style={{ fontSize:11, color: t.graduated ? '#22c55e' : 'var(--t3)', fontWeight:700, fontFamily:'var(--mono)' }}>
            {t.graduated ? '✓ Graduated' : `${pct.toFixed(1)}%`}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height:5, background:'rgba(255,255,255,0.06)', borderRadius:999, overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:999,
            width: `${pct}%`,
            background: t.graduated
              ? 'linear-gradient(90deg,#d97706,#FFAE45)'
              : `linear-gradient(90deg,${color},${color}99)`,
            transition: 'width .4s ease',
            boxShadow: `0 0 8px ${color}88`,
          }} />
        </div>
      </div>

    </div>
  )
}

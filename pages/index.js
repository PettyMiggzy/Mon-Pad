import { useState, useEffect, useRef, useMemo } from 'react'
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
  const [visibleCount, setVisibleCount] = useState(16)
  const carouselRef = useRef(null)
  const loadMoreRef = useRef(null)

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

  useEffect(() => {
    setVisibleCount(16)
  }, [tab, search, tokens.length])

  useEffect(() => {
    if (!loadMoreRef.current || loading) return
    const el = loadMoreRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 12, list.length || prev + 12))
        }
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [list.length, loading])

  const visibleList = useMemo(() => list.slice(0, visibleCount), [list, visibleCount])

  return (
    <Layout>

      {/* ═══ MOBILE-ONLY TOPBAR ═══ */}
      <div className="mobile-only-bar" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 12px',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 110,
        background: '#000',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <img src="/monpad-text-logo.png" alt="MonPad"
          style={{ height: 32, width: 120, objectFit: 'contain', objectPosition: 'left' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Telegram */}
          <a href="https://t.me/Monpadlounge" target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, background: 'transparent', flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" fill="white" width="22" height="22">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </a>
          {/* Wallet */}
          <button onClick={() => router.push('/portfolio')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
              <path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/>
              <circle cx="17" cy="13" r="1.5" fill="white" stroke="none"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ═══ HERO BANNER — desktop only ═══ */}
      <div className="desktop-only" style={{
        margin: '16px 16px',
        padding: '36px 24px',
        background: 'linear-gradient(135deg, rgba(110,84,255,0.18) 0%, rgba(133,230,255,0.06) 100%)',
        border: '1px solid rgba(110,84,255,0.3)',
        borderRadius: 22,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, fontWeight: 900, color: '#fff', marginBottom: 10, letterSpacing: '-2px', lineHeight: 1 }}>MonPad</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', fontWeight: 500, marginBottom: 28, lineHeight: 1.5 }}>Fair launch · No presale · Devs earn 1.5% forever · 10 MON to launch</div>
        <button
          onClick={() => router.push('/create')}
          style={{
            padding: '18px 56px',
            background: 'linear-gradient(135deg,#6E54FF,#85E6FF)',
            border: 'none', borderRadius: 16,
            color: 'white', fontWeight: 900, fontSize: 20,
            cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: '0 6px 28px rgba(110,84,255,0.55)',
            transition: 'transform .15s, box-shadow .15s',
            width: '100%',
          }}
          onMouseEnter={e => { e.target.style.transform='translateY(-1px)'; e.target.style.boxShadow='0 8px 36px rgba(110,84,255,0.7)' }}
          onMouseLeave={e => { e.target.style.transform='translateY(0)';    e.target.style.boxShadow='0 6px 28px rgba(110,84,255,0.55)' }}
        >
          + Launch Token
        </button>
      </div>

      {/* ═══ TRENDING CAROUSEL — desktop only ═══ */}
      <div className="desktop-only" style={{ padding: '12px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: '#ffffff' }}>🔥 Trending</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['‹','›'].map((ch, i) => (
            <button key={ch} onClick={() => carouselRef.current?.scrollBy({ left: i === 0 ? -220 : 220, behavior: 'smooth' })}
              style={{ width:28, height:28, borderRadius:'50%', background:'var(--bg2)', border:'1px solid var(--bd2)', color:'var(--t2)', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="desktop-only"><div ref={carouselRef} style={{ display:'flex', gap:12, padding:'0 16px 16px', overflowX:'auto', scrollbarWidth:'none', WebkitOverflowScrolling:'touch' }}>
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
      </div></div>

      {/* ═══ SEARCH + TABS ═══ */}
      <div className="mobile-sticky-filters" style={{ padding: '8px 12px 10px', background:'#000', zIndex:99 }}>
        <div style={{ position:'relative', marginBottom:8 }}>
          <svg style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', width:16, height:16, color:'rgba(255,255,255,0.35)', pointerEvents:'none' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="Search tokens..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width:'100%', background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, padding:'11px 12px 11px 38px', fontSize:16, color:'#fff', outline:'none', fontFamily:'var(--sans)' }}
          />
        </div>

        <div style={{ display:'flex', gap:6, overflowX:'auto', scrollbarWidth:'none' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                flexShrink:0, padding:'8px 14px', borderRadius:10, fontSize:15, fontWeight:700, border:'none', cursor:'pointer', whiteSpace:'nowrap', transition:'all .15s',
                background: tab === t.id ? 'var(--p)' : 'rgba(255,255,255,0.09)',
                color:      tab === t.id ? 'white'    : 'rgba(255,255,255,0.75)',
                boxShadow:  tab === t.id ? '0 4px 16px rgba(110,84,255,0.4)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TOKEN GRID ═══ */}
      <div className="mobile-list-offset" style={{ padding:'0 16px 100px' }}>

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
              {visibleList.map(t => (
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
              {visibleList.map(t => (
                <TokenRow
                  key={t.token}
                  token={t}
                  monPrice={monPrice}
                  isLive={liveSet.has(t.token?.toLowerCase())}
                  onClick={() => router.push(`/token/${t.token}`)}
                />
              ))}
            </div>

            {visibleCount < list.length && (
              <div ref={loadMoreRef} style={{ height: 24, width: '100%' }} />
            )}
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

        .token-card:hover  { background: rgba(255,255,255,0.04) !important; }
        .token-row:hover   { background: #0a0a0a !important; }

        /* Mobile: hide hero/carousel, show minimal bar */
        @media (max-width: 767px) {
          .desktop-only          { display: none !important; }
          .mobile-only-bar       { display: flex !important; }
          .mobile-sticky-filters {
            position: fixed;
            top: 61px;
            left: 0;
            right: 0;
          }
          .mobile-list-offset    { padding-top: 142px !important; }
        }
        /* Desktop: hide mobile bar only — desktop-only elements keep their own inline display */
        @media (min-width: 768px) {
          .mobile-only-bar       { display: none !important; }
          .mobile-sticky-filters { position: static; }
        }
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

// ─── Jagged sparkline ────────────────────────────────────────────────────────
function SparklineFill({ prices, color, height = 72 }) {
  const lineColor = color || '#a855f7'

  if (!prices || prices.length < 2) {
    return (
      <svg width="100%" height={height} viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={0} y1={60} x2={100} y2={60}
          stroke={lineColor} strokeWidth={2.5} strokeOpacity={1} strokeLinecap="round" />
      </svg>
    )
  }

  const W = 100, H = 100
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const padY = 6

  // Straight line segments (jagged) — exactly like pump.fun
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W
    const y = padY + (1 - (p - min) / range) * (H - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const polyline = pts.join(' ')

  const uid = `spk-${Math.abs(prices[0] * 1000 | 0)}`

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <filter id={uid} x="-10%" y="-30%" width="120%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* glow halo */}
      <polyline points={polyline} fill="none"
        stroke={lineColor} strokeWidth={5} strokeOpacity={0.15}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* sharp jagged line */}
      <polyline points={polyline} fill="none"
        stroke={lineColor} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round"
        filter={`url(#${uid})`} />
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
  const lineColor = color || '#a855f7'
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

  const sparkColor = '#a855f7'

  return (
    <div
      className="token-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#000',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Image: large square, barely rounded like pump.fun ── */}
      <div style={{
        width: 72, height: 72, borderRadius: 10, flexShrink: 0,
        background: imgUrl ? '#111' : `linear-gradient(135deg,${color}44,${color}11)`,
        overflow: 'hidden', position: 'relative',
      }}>
        {imgUrl
          ? <img src={imgUrl} alt={name} style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display='none' }} />
          : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:900, color }}>
              {symbol.slice(0,2).toUpperCase()}
            </div>
        }
        {t.graduated && (
          <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'#92400ecc', color:'#fbbf24', fontSize:9, fontWeight:900, textAlign:'center', padding:'2px 0' }}>GRAD</div>
        )}
        {isLive && (
          <div style={{ position:'absolute', top:4, right:4, width:8, height:8, borderRadius:'50%', background:'#ef4444', boxShadow:'0 0 6px #ef4444', animation:'blink 1.5s infinite' }} />
        )}
      </div>

      {/* ── Middle: name + sub-line (flex grows) ── */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
        <div style={{
          fontWeight: 600, fontSize: 17, color: '#fff',
          lineHeight: 1.25, marginBottom: 4,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {name}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:13, color:'rgba(255,255,255,0.45)' }}>
          <span>{symbol.slice(0,1).toUpperCase()}...</span>
          <span style={{ color:'#22c55e' }}>♥</span>
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* ── Right side: sparkline + MC stacked ── */}
      <div style={{ flexShrink: 0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 4 }}>
        {/* Sparkline — flat line if no data, chart if data */}
        <div style={{ width: 90, height: 48 }}>
          <SparklineFill prices={sparkPrices && sparkPrices.length >= 2 ? sparkPrices : null} color={sparkColor} height={48} />
        </div>
        {/* MC */}
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>
          {mc}
        </div>
        {t.graduated && (
          <div style={{ fontSize: 10, color: '#00ff7f', fontWeight: 700 }}>✓ Grad</div>
        )}
      </div>
    </div>
  )
}

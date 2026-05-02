import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import Link from 'next/link'
import { fmtUSD, fmtAddr, fmtMON, fmtTokens, timeAgo } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

// ── helpers ──
function fixUrl(url) {
  if (!url) return null
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  if (url.startsWith('http://api.monpad.net')) return url.replace('http://api.monpad.net', 'https://api.monpad.net')
  return url
}

const TABS = [
  { id: 'trending',  label: '🔥 Trending' },
  { id: 'live',      label: '🔴 Live', blink: true },
  { id: 'new',       label: '🌱 New' },
  { id: 'mcap',      label: '📈 Top MCap' },
  { id: 'about-grad', label: '⚡ About to Grad' },
  { id: 'graduated', label: '🎓 Graduated' },
]

const SORT_OPTS = [
  { id: 'mcap_desc', label: 'Market Cap ↓' },
  { id: 'mcap_asc',  label: 'Market Cap ↑' },
  { id: 'new_desc',  label: 'Newest First' },
  { id: 'new_asc',   label: 'Oldest First' },
  { id: 'vol_desc',  label: 'Volume ↓' },
  { id: 'grad_desc', label: '% to Grad ↓' },
]

export default function Home() {
  const router = useRouter()
  const [tab, setTab] = useState('trending')
  const [sort, setSort] = useState('mcap_desc')
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [monPrice, setMonPrice] = useState(0)
  const [search, setSearch] = useState('')
  const [recentBuys, setRecentBuys] = useState([])
  const [livePulse, setLivePulse] = useState({})
  const trendingRef = useRef(null)

  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
    loadTokens()
    const iv = setInterval(loadTokens, 30000)
    return () => clearInterval(iv)
  }, [])

  // WebSocket live updates
  useEffect(() => {
    if (!SERVER) return
    const wsUrl = SERVER.replace('https://', 'wss://').replace('http://', 'ws://')
    let ws, retry
    function connect() {
      try {
        ws = new WebSocket(wsUrl)
        ws.onmessage = e => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'price_update') {
              const addr = msg.tokenAddress?.toLowerCase()
              setTokens(prev => prev.map(t => t.token?.toLowerCase() === addr
                ? { ...t, marketCap: BigInt(msg.marketCap || '0'), monRaisedNet: BigInt(msg.monRaisedNet || '0'), bondedBps: BigInt(msg.bondedBps || '0') }
                : t))
              if (addr) {
                setLivePulse(p => ({ ...p, [addr]: Date.now() }))
              }
            }
            if (msg.type === 'trade') {
              setRecentBuys(prev => [msg, ...prev].slice(0, 30))
            }
          } catch {}
        }
        ws.onclose = () => { retry = setTimeout(connect, 3000) }
      } catch {}
    }
    connect()
    return () => { if (ws) try { ws.close() } catch {}; clearTimeout(retry) }
  }, [])

  async function loadTokens() {
    if (!SERVER) { setLoading(false); return }
    try {
      const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
      const list = (data || []).map((t, i) => ({
        ...t,
        token: t.tokenAddress,
        curve: t.curveAddress,
        monRaisedNet: BigInt(t.monRaisedNet || '0'),
        capMon: BigInt(t.capMon || '0'),
        bondedBps: BigInt(t.bondedBps || '0'),
        marketCap: BigInt(t.marketCap || '0'),
        blockNumber: BigInt(t.blockNumber || '0'),
        idx: i,
      }))
      setTokens(list)
    } catch (e) { console.warn('loadTokens', e) }
    setLoading(false)
  }

  function filtered() {
    const q = search.trim().toLowerCase()
    let base = q
      ? tokens.filter(t =>
          (t.name || '').toLowerCase().includes(q) ||
          (t.symbol || '').toLowerCase().includes(q) ||
          (t.token || '').toLowerCase().includes(q)
        )
      : tokens

    // Tab filtering
    if (tab === 'graduated') base = base.filter(t => t.graduated)
    else if (tab === 'live') base = base.filter(t => livePulse[t.token?.toLowerCase()] && Date.now() - livePulse[t.token?.toLowerCase()] < 60000)
    else if (tab === 'about-grad') base = base.filter(t => !t.graduated && Number(t.bondedBps) >= 7000)
    else if (tab === 'new') base = [...base].sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber))
    else if (tab === 'mcap') base = [...base].sort((a, b) => Number(b.marketCap) - Number(a.marketCap))
    else /* trending */ base = [...base].sort((a, b) => Number(b.monRaisedNet) - Number(a.monRaisedNet))

    // Apply sort within tab
    if (sort === 'mcap_desc') base = [...base].sort((a, b) => Number(b.marketCap || b.monRaisedNet) - Number(a.marketCap || a.monRaisedNet))
    else if (sort === 'mcap_asc') base = [...base].sort((a, b) => Number(a.marketCap || a.monRaisedNet) - Number(b.marketCap || b.monRaisedNet))
    else if (sort === 'new_desc') base = [...base].sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber))
    else if (sort === 'new_asc') base = [...base].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber))
    else if (sort === 'vol_desc') base = [...base].sort((a, b) => (Number(b.volumeMon) || 0) - (Number(a.volumeMon) || 0))
    else if (sort === 'grad_desc') base = [...base].sort((a, b) => Number(b.bondedBps) - Number(a.bondedBps))

    return base
  }

  const list = filtered()
  const trending = [...tokens].sort((a, b) => Number(b.monRaisedNet) - Number(a.monRaisedNet)).slice(0, 8)

  return (
    <Layout>
      {/* HERO */}
      <div className="container">
        <div className="hero">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h1 className="hero-title">Launch on the fairest pad on Monad</h1>
            <p className="hero-sub">No presale. No insider games. <strong style={{color:'var(--p2)'}}>Devs earn 2% of all volume forever.</strong></p>
            <div className="flex gap-3 justify-center" style={{flexWrap:'wrap'}}>
              <Link href="/create" className="btn btn-primary btn-lg" style={{textDecoration:'none'}}>🚀 Launch Token</Link>
              <Link href="/staking" className="btn btn-cyan btn-lg" style={{textDecoration:'none'}}>🥩 Stake & Earn</Link>
            </div>
            <div className="flex gap-6 justify-center mt-6" style={{flexWrap:'wrap', fontSize:13}}>
              <div className="text-center">
                <div className="text-purple font-mono font-bold text-lg">{tokens.length}</div>
                <div className="text-t4 text-xs">TOKENS</div>
              </div>
              <div className="text-center">
                <div className="text-green font-mono font-bold text-lg">{tokens.filter(t => t.graduated).length}</div>
                <div className="text-t4 text-xs">GRADUATED</div>
              </div>
              <div className="text-center">
                <div className="text-gold font-mono font-bold text-lg">425K</div>
                <div className="text-t4 text-xs">MON TO GRAD</div>
              </div>
              <div className="text-center">
                <div className="text-cyan font-mono font-bold text-lg">100</div>
                <div className="text-t4 text-xs">MON TO LAUNCH</div>
              </div>
            </div>
          </div>
        </div>

        {/* SEARCH */}
        <div style={{position:'relative', marginBottom:14}}>
          <input className="input" placeholder="Search by name, ticker, or address..." value={search} onChange={e => setSearch(e.target.value)} style={{paddingLeft:42}} />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18" style={{position:'absolute',left:14,top:14,color:'var(--t4)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          {search && <button onClick={() => setSearch('')} className="text-t3" style={{position:'absolute', right:12, top:10, fontSize:18, padding:'4px 8px'}}>✕</button>}
        </div>

        {/* TRENDING CAROUSEL */}
        {!search && trending.length > 0 && (
          <>
            <div className="flex justify-between items-center mb-3 mt-4">
              <h2 className="text-lg font-black flex items-center gap-2">🔥 <span>Trending Now</span></h2>
              <div className="flex gap-1">
                <button onClick={() => trendingRef.current?.scrollBy({left:-260, behavior:'smooth'})} className="btn-ghost btn btn-sm">‹</button>
                <button onClick={() => trendingRef.current?.scrollBy({left:260, behavior:'smooth'})} className="btn-ghost btn btn-sm">›</button>
              </div>
            </div>
            <div ref={trendingRef} style={{display:'flex', gap:12, overflowX:'auto', scrollSnapType:'x mandatory', scrollbarWidth:'none', paddingBottom:8}}>
              {trending.map(t => <TrendingCard key={t.token} token={t} monPrice={monPrice} onClick={() => router.push(`/token/${t.token}`)} />)}
            </div>
          </>
        )}

        {/* TABS */}
        <div className="flex justify-between items-center mt-6 mb-2 gap-3" style={{flexWrap:'wrap'}}>
          <div className="tabs flex-1" style={{margin:0, padding:0}}>
            {TABS.map(t => (
              <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} className="input" style={{width:'auto', padding:'8px 12px', fontSize:13}}>
            {SORT_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>

        {/* TOKEN GRID */}
        <div style={{paddingBottom:32}}>
          {loading ? (
            <div className="token-grid">
              {Array.from({length:9}).map((_,i) => <div key={i} className="skeleton" style={{aspectRatio:'1', borderRadius:'var(--r-lg)'}} />)}
            </div>
          ) : list.length === 0 ? (
            <div style={{padding:'80px 20px', textAlign:'center'}}>
              <div style={{fontSize:64, marginBottom:16}}>🚀</div>
              <div className="text-xl font-bold mb-2">{search ? 'No tokens found' : tab === 'live' ? 'Nobody live right now' : tab === 'graduated' ? 'No graduations yet' : 'No tokens yet'}</div>
              <p className="text-t3 mb-6">{search ? `No matches for "${search}"` : 'Be the first to launch on the new MonPad'}</p>
              {!search && <Link href="/create" className="btn btn-primary btn-lg" style={{textDecoration:'none'}}>🚀 Launch the First Token</Link>}
            </div>
          ) : (
            <div className="token-grid">
              {list.map(t => {
                const isLive = livePulse[t.token?.toLowerCase()] && Date.now() - livePulse[t.token?.toLowerCase()] < 60000
                return <TokenCard key={t.token} token={t} monPrice={monPrice} isLive={isLive} onClick={() => router.push(`/token/${t.token}`)} />
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

function TrendingCard({ token: t, monPrice, onClick }) {
  const pct = Number(t.bondedBps) / 100
  const meta = t.meta || {}
  const banner = fixUrl(meta.bannerUrl || meta.pfpUrl)
  return (
    <div onClick={onClick} style={{flexShrink:0, width:240, scrollSnapAlign:'start', cursor:'pointer'}} className="card">
      <div style={{height:120, borderRadius:'var(--r)', overflow:'hidden', marginBottom:10, background:'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(34,211,238,0.05))', display:'flex', alignItems:'center', justifyContent:'center'}}>
        {banner ? <img src={banner} alt="" style={{width:'100%', height:'100%', objectFit:'cover'}} /> : <div style={{fontSize:48, fontWeight:900, color:'rgba(168,85,247,0.3)'}}>{(t.symbol || '?').slice(0,2)}</div>}
      </div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6}}>
        <div style={{minWidth:0, flex:1}}>
          <div className="font-bold text-base" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.name}</div>
          <div className="font-mono text-xs text-t3">${t.symbol}</div>
        </div>
        {t.graduated && <span className="tag tag-gold">GRAD</span>}
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-t3">MCap</span>
        <span className="font-mono font-bold">{fmtUSD(t.marketCap || t.monRaisedNet, monPrice)}</span>
      </div>
      <div className="token-card-progress" style={{marginTop:6}}>
        <div className="token-card-progress-fill" style={{width:`${Math.min(pct, 100)}%`}}></div>
      </div>
      <div className="text-xs text-t4 mt-1 font-mono">{pct.toFixed(1)}% bonded</div>
    </div>
  )
}

function TokenCard({ token: t, monPrice, isLive, onClick }) {
  const pct = Number(t.bondedBps) / 100
  const meta = t.meta || {}
  const pfp = fixUrl(meta.pfpUrl)
  return (
    <div onClick={onClick} className={`token-card ${isLive ? 'live' : ''} ${t.graduated ? 'graduated' : ''}`}>
      <div className="token-card-img">
        {pfp ? <img src={pfp} alt="" /> : <div>{(t.symbol || '?').slice(0,2)}</div>}
        {t.graduated && <span className="token-card-badge" style={{background:'var(--gold)', color:'#000'}}>GRAD</span>}
        {isLive && !t.graduated && <span className="token-card-badge" style={{background:'var(--red)'}}>● LIVE</span>}
      </div>
      <div className="token-card-body">
        <div className="token-card-name">{t.name}</div>
        <div className="token-card-symbol">${t.symbol}</div>
        <div className="token-card-stats">
          <span className="text-t3 text-xs">MC</span>
          <span className="token-card-mcap">{fmtUSD(t.marketCap || t.monRaisedNet, monPrice)}</span>
        </div>
        <div className="token-card-progress">
          <div className="token-card-progress-fill" style={{width:`${Math.min(pct, 100)}%`}}></div>
        </div>
        <div className="text-xs text-t4 mt-1 flex justify-between">
          <span className="font-mono">{pct.toFixed(1)}%</span>
          <span>to grad</span>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { usePublicClient } from 'wagmi'
import Layout from '../components/Layout'
import { fmtUSD, fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

function fixUrl(url) {
      if (!url) return url
      if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
      if (url.startsWith('http://api.monpad.net')) return url.replace('http://api.monpad.net', 'https://api.monpad.net')
      return url
}

const TABS = [
    { id: 'movers',    label: '\u2B50 Movers' },
    { id: 'live',      label: '\uD83D\uDD34 Live', blink: true },
    { id: 'new',       label: '\uD83C\uDF31 New' },
    { id: 'marketcap', label: '\uD83D\uDD25 Market cap' },
    { id: 'trenches',  label: '\u2694\uFE0F Trenches' },
    { id: 'oldest',    label: '\uD83D\uDD70 Oldest' },
    { id: 'grad',      label: '\uD83C\uDF93 Graduated' },
    ]

const GRAD_COLORS = ['#6E54FF','#a78bfa','#85E6FF','#FF8EE4','#FFAE45','#22c55e']

function makeSparkline(seed, pct) {
      const n = 8, w = 80, h = 36
      const rand = i => { let x = Math.sin(seed * 9301 + i * 49297 + 233720) * 10000; return x - Math.floor(x) }
      const pts = Array.from({ length: n }, (_, i) => Math.max(0.05, Math.min(0.95, 0.3 + rand(i) * 0.5 + (pct / 100) * (i / (n-1)) * 0.4)))
      const xs = pts.map((_, i) => (i / (n-1)) * w)
      const ys = pts.map(v => h - v * h)
      return xs.map((x, i) => (i === 0 ? `M${x.toFixed(1)},${ys[i].toFixed(1)}` : `L${x.toFixed(1)},${ys[i].toFixed(1)}`)).join(' ')
}

export default function Home() {
      const router = useRouter()
      const [tab, setTab] = useState('movers')
      const [tokens, setTokens] = useState([])
      const [metas, setMetas] = useState({})
      const [liveRooms, setLive] = useState([])
      const [loading, setLoading] = useState(true)
      const [monPrice, setMonPrice] = useState(0)
      const [recentTrades, setRecentTrades] = useState({})
      const [mobileSearch, setMobileSearch] = useState('')
      const carouselRef = useRef(null)
      const mobileSearchRef = useRef(null)

  useEffect(() => { fetch(`${SERVER}/api/mon-price`).then(r=>r.json()).then(d=>setMonPrice(d.price||0)).catch(()=>{}) }, [])
      useEffect(() => { if (router.query.tab) setTab(router.query.tab) }, [router.query.tab])
      useEffect(() => { if (router.query.focus === 'search' && mobileSearchRef.current) setTimeout(() => mobileSearchRef.current?.focus(), 100) }, [router.query.focus])
      useEffect(() => { loadTokens() }, [])

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
                                                              const addr = msg.tokenAddress?.toLowerCase()
                                                              setTokens(prev => prev.map(t => t.token?.toLowerCase() === addr ? { ...t, marketCap: BigInt(msg.marketCap||'0'), monRaisedNet: BigInt(msg.monRaisedNet||'0'), bondedBps: BigInt(msg.bondedBps||'0') } : t))
                                                              if (addr) setRecentTrades(prev => ({ ...prev, [addr]: Date.now() }))
                                              }
                                } catch {}
                    }
                    ws.onclose = () => { retryTimeout = setTimeout(connect, 3000) }
          }
          connect()
          return () => { if (ws) ws.close(); clearTimeout(retryTimeout) }
  }, [])

  useEffect(() => {
          if (!SERVER) return
          const poll = () => fetch(`${SERVER}/api/live`).then(r=>r.json()).then(d=>setLive(d.live||[])).catch(()=>{})
          poll(); const iv = setInterval(poll, 15000); return () => clearInterval(iv)
  }, [])

  async function loadTokens() {
          if (!SERVER) return
          try {
                    const data = await fetch(`${SERVER}/api/tokens`).then(r => r.json())
                    const map = {}
                              const list = data.map((t, i) => { map[t.tokenAddress?.toLowerCase()] = t; return { token: t.tokenAddress, curve: t.curveAddress, creator: t.creator, name: t.name, symbol: t.symbol, graduated: t.graduated, monRaisedNet: BigInt(t.monRaisedNet||'0'), capMon: BigInt(t.capMon||'0'), bondedBps: BigInt(t.bondedBps||'0'), marketCap: BigInt(t.marketCap||'0'), blockNumber: BigInt(t.blockNumber||'0'), colorIdx: i } })
                    setTokens(list); setMetas(map)
          } catch {} finally { setLoading(false) }
  }

  function filtered() {
          const live = new Set(liveRooms.map(a=>a.toLowerCase()))
          const q = mobileSearch.trim().toLowerCase()
          let base = q ? tokens.filter(t => { const m = metas[t.token?.toLowerCase()]||{}; return (t.name||'').toLowerCase().includes(q)||(t.symbol||'').toLowerCase().includes(q)||(m.name||'').toLowerCase().includes(q)||(m.symbol||'').toLowerCase().includes(q)||(t.token||'').toLowerCase().includes(q) }) : tokens
          if (tab === 'grad') return base.filter(t => t.graduated)
          if (tab === 'live') return base.filter(t => live.has(t.token?.toLowerCase()))
          if (tab === 'new') return [...base]
          if (tab === 'oldest') return [...base].reverse()
          if (tab === 'marketcap') return [...base].sort((a,b) => Number(b.marketCap||b.monRaisedNet) - Number(a.marketCap||a.monRaisedNet))
          if (tab === 'trenches') return base.filter(t => !t.graduated && Number(t.bondedBps) >= 5000)
          return [...base].sort((a,b) => Number(b.marketCap||b.monRaisedNet) - Number(a.marketCap||a.monRaisedNet))
  }

  const list = filtered()
      const live = new Set(liveRooms.map(a=>a.toLowerCase()))
      const trending = [...tokens].sort((a,b) => Number(b.monRaisedNet)-Number(a.monRaisedNet)).slice(0,6)

  return (
          <Layout>
            <div className="mobile-search-bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{color:'var(--t3)',flexShrink:0}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input ref={mobileSearchRef} className="mobile-search-input" placeholder="Search tokens..." type="search" value={mobileSearch} onChange={e=>setMobileSearch(e.target.value)} onFocus={()=>{ if (router.query.focus!=='search') router.replace('/?focus=search',undefined,{shallow:true}) }} />
{mobileSearch && <button onClick={()=>setMobileSearch('')} style={{background:'none',border:'none',color:'var(--t3)',fontSize:16,cursor:'pointer',padding:'0 4px'}}>&#x2715;</button>}
    </div>

      <div style={{margin:'12px 16px',padding:'24px',background:'linear-gradient(135deg,rgba(110,84,255,0.15),rgba(133,230,255,0.08))',border:'1px solid rgba(110,84,255,0.25)',borderRadius:16,textAlign:'center'}}>
        <div style={{fontSize:22,fontWeight:900,marginBottom:6}}>MonPad</div>
        <div style={{fontSize:13,color:'var(--t3)',marginBottom:16}}>Fair launch · No presale · Devs earn 2% forever · 100 MON to launch</div>
        <button onClick={()=>router.push('/create')} style={{padding:'12px 32px',background:'linear-gradient(90deg,var(--p),var(--cyan))',border:'none',borderRadius:12,color:'white',fontWeight:800,fontSize:15,cursor:'pointer'}}>+ Launch Token</button>
    </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 16px 10px'}}>
        <div style={{fontSize:17,fontWeight:800}}>🔥 Trending</div>
        <div style={{display:'flex',gap:6}}>
{['‹','›'].map((ch,i) => <button key={ch} onClick={()=>carouselRef.current?.scrollBy({left:i===0?-240:240,behavior:'smooth'})} style={{width:30,height:30,borderRadius:'50%',background:'var(--bg2)',border:'1px solid var(--bd2)',color:'var(--t2)',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>{ch}</button>)}
    </div>
    </div>
      <div ref={carouselRef} style={{display:'flex',gap:10,padding:'0 16px 8px',overflowX:'auto',scrollSnapType:'x mandatory',scrollbarWidth:'none'}}>
{loading && [0,1,2,3].map(i => <div key={i} style={{flexShrink:0,width:230,height:145,borderRadius:12,background:'var(--bg2)',scrollSnapAlign:'start',animation:'pulse 1.5s infinite'}} />)}
{!loading && trending.length === 0 && <div style={{color:'var(--t3)',fontSize:13,padding:'20px 0'}}>No tokens yet — launch the first one!</div>}
{trending.map(t => {
              const meta = metas[t.token?.toLowerCase()]||{}
                            const isLive = live.has(t.token?.toLowerCase())
              const color = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]
              const bannerSrc = meta?.bannerUrl && meta.bannerUrl !== 'default_image_uri' ? fixUrl(meta.bannerUrl) : null
              return (
                              <div key={t.token} onClick={()=>router.push(`/token/${t.token}`)} style={{flexShrink:0,width:230,borderRadius:12,overflow:'hidden',position:'relative',cursor:'pointer',scrollSnapAlign:'start',background:bannerSrc?'#000':`linear-gradient(135deg,${color}22,${color}08)`,border:`1px solid ${color}22`}}>
{bannerSrc ? <img src={bannerSrc} alt="" onError={e=>{e.target.style.display='none'}} style={{width:'100%',height:145,objectFit:'cover',display:'block'}} /> : <div style={{height:145,display:'flex',alignItems:'center',justifyContent:'center',fontSize:54,fontWeight:900,color:`${color}20`}}>{(t.symbol||'?').slice(0,2)}</div>}
{isLive && <div style={{position:'absolute',top:8,left:8,background:'#ef4444',color:'white',fontSize:10,fontWeight:800,padding:'3px 8px',borderRadius:99,display:'flex',alignItems:'center',gap:4}}><span style={{width:6,height:6,background:'white',borderRadius:'50%',animation:'blink 1.5s infinite'}}/>LIVE</div>}
                  <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(0,0,0,0.85) 0%,transparent 55%)',pointerEvents:'none'}}/>
              <div style={{position:'absolute',bottom:0,left:0,right:0,padding:'10px 12px',zIndex:2}}>
                <div style={{fontSize:18,fontWeight:800,color:'white',lineHeight:1.1}}>{fmtUSD(t.marketCap||t.monRaisedNet,monPrice)}</div>
                <div style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)'}}>{t.name} · ${t.symbol}</div>
    </div>
    </div>
          )
})}
</div>

      <div className="tab-bar" style={{overflowX:'auto',scrollbarWidth:'none',flexWrap:'nowrap'}}>
{TABS.map(t => (
              <button key={t.id} className={`tab-pill ${tab===t.id?'on':'off'}`} onClick={()=>setTab(t.id)} style={{flexShrink:0}}>
{t.blink && tab===t.id && <span style={{width:7,height:7,background:'white',borderRadius:'50%',animation:'blink 1.5s infinite',display:'inline-block',marginRight:5}}/>}
{t.label}
{t.id==='live' && liveRooms.length>0 && <span style={{marginLeft:5,background:'#ef4444',color:'white',fontSize:10,fontWeight:800,padding:'1px 5px',borderRadius:99}}>{liveRooms.length}</span>}
    </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:0,flexShrink:0}}>
          <button className="tab-pill on" style={{background:'none',border:'none',borderBottom:'2px solid var(--p1)',borderRadius:0,color:'var(--p2)',padding:'10px 14px'}}>Explore</button>
          <button className="tab-pill off" style={{background:'none',border:'none',borderRadius:0,padding:'10px 14px'}}>Watchlist</button>
            </div>
            </div>

      <div style={{padding:'12px 16px'}}>
{loading && <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>{[...Array(9)].map((_,i) => <div key={i} style={{height:110,borderRadius:12,background:'var(--bg2)',animation:'pulse 1.5s infinite'}}/>)}</div>}
{!loading && list.length === 0 && (
              <div style={{padding:'60px 0',textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:12}}>🚀</div>
            <div style={{fontSize:16,fontWeight:800,marginBottom:8}}>{mobileSearch?'No tokens found':tab==='live'?'Nobody is live right now':tab==='grad'?'No graduated tokens yet':tab==='trenches'?'No tokens in the trenches yet':'No tokens yet'}</div>
            <div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>{mobileSearch?`No results for "${mobileSearch}"`:tab==='live'?'Go live on your token page':tab==='grad'?'Tokens graduate at 425K MON':tab==='trenches'?'Tokens past 50% bonding show here':'Be the first to launch on MonPad'}</div>
{(tab==='movers'||tab==='new') && !mobileSearch && <button onClick={()=>router.push('/create')} style={{padding:'12px 28px',background:'var(--p)',border:'none',borderRadius:10,color:'white',fontWeight:800,fontSize:14,cursor:'pointer'}}>Launch Now</button>}
    </div>
        )}
{!loading && list.length > 0 && (
              <div className="token-grid">
{list.map(t => {
                  const lastTrade = recentTrades[t.token?.toLowerCase()]||0
                  const age = Date.now()-lastTrade
                  const pulseIntensity = lastTrade>0 && age<30000 ? Math.max(0.2, 1-age/30000) : 0
                  return <TokenCard key={t.token} token={t} meta={metas[t.token?.toLowerCase()]} isLive={live.has(t.token?.toLowerCase())} monPrice={monPrice} onClick={()=>router.push(`/token/${t.token}`)} pulseIntensity={pulseIntensity}/>
    })}
    </div>
        )}
</div>
            </Layout>
  )
}

function TokenCard({ token: t, meta, isLive, monPrice, onClick, pulseIntensity = 0 }) {
      const rawPct = Number(t.bondedBps) / 100
      const pct = isNaN(rawPct) ? 0 : rawPct
      const color = GRAD_COLORS[t.colorIdx % GRAD_COLORS.length]
      const sparkColor = t.graduated ? '#FFAE45' : color
      const seed = t.token ? parseInt(t.token.slice(2,10), 16) : t.colorIdx
      const sparkPath = makeSparkline(seed, pct)

  const pulseStyle = pulseIntensity > 0 ? {
          boxShadow: `0 0 ${Math.round(pulseIntensity*18)}px ${Math.round(pulseIntensity*6)}px ${color}55`,
          borderColor: `${color}88`,
  } : {}

        return (
                <div className="tcard" onClick={onClick} style={pulseStyle}>
                  <div className="tcard-img" style={{background:meta?.pfpUrl?'#000':`linear-gradient(135deg,${color}30,${color}10)`,position:'relative',overflow:'hidden'}}>
{meta?.pfpUrl ? <img src={fixUrl(meta.pfpUrl)} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:24,fontWeight:900,color:`${color}50`}}>{(t.symbol||'?').slice(0,2)}</span>}
{t.graduated && <div className="tcard-badge" style={{background:'var(--gold)',color:'#000'}}>GRAD</div>}
{isLive && !t.graduated && <div className="tcard-badge" style={{display:'flex',alignItems:'center',gap:3}}><span style={{width:5,height:5,background:'white',borderRadius:'50%',animation:'blink 1.5s infinite'}}/>LIVE</div>}
    </div>
      <div className="tcard-body">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:2}}>
          <div style={{fontWeight:800,fontSize:13,lineHeight:1.2,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{meta?.name||t.name}</div>
          <div style={{fontSize:11,fontWeight:800,fontFamily:'var(--mono)',color:'var(--t1)',flexShrink:0,marginLeft:6}}>{fmtUSD(t.marketCap||t.monRaisedNet,monPrice)}</div>
    </div>
        <div style={{fontSize:11,color:'var(--t3)',fontFamily:'var(--mono)',marginBottom:4}}>${meta?.symbol||t.symbol}</div>
        <div style={{width:'100%',height:36,marginBottom:4}}>
          <svg width="100%" height="36" viewBox="0 0 80 36" preserveAspectRatio="none">
                <path d={sparkPath} fill="none" stroke={sparkColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9"/>
    </svg>
    </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <div style={{flex:1,height:3,background:'var(--bg3)',borderRadius:999,overflow:'hidden'}}>
            <div style={{height:'100%',background:t.graduated?'linear-gradient(90deg,#d97706,#FFAE45)':`linear-gradient(90deg,${color},${color}88)`,borderRadius:999,width:`${Math.min(pct,100)}%`}}/>
    </div>
          <span style={{fontSize:10,fontWeight:700,color:pct>=70?'var(--gold)':sparkColor,fontFamily:'var(--mono)',flexShrink:0}}>↑{pct.toFixed(1)}%</span>
    </div>
    </div>
    </div>
  )
}

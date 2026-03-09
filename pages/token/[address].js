import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { usePublicClient, useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, parseAbiItem } from 'viem'
import Head from 'next/head'
import Layout from '../../components/Layout'
import { CURVE_ABI, TOKEN_ABI, fmtMON, fmtAddr, fmtTokens, MONADSCAN, START_BLOCK } from '../../lib/constants'
import { monad } from '../../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const DETAIL_TABS = ['Comments', 'Trades', 'Holders']
const TF_OPTIONS  = ['15m', '1h', '4h', '1d']

export default function TokenDetail() {
  const router = useRouter()
  const { address: tokenAddr } = router.query
  const client = usePublicClient({ chainId: monad.id })
  const { address: userAddr } = useAccount()

  const [meta, setMeta]         = useState(null)
  const [info, setInfo]         = useState(null)
  const [curveAddr, setCurve]   = useState(null)
  const [trades, setTrades]     = useState([])
  const [holders, setHolders]   = useState([])
  const [tab, setTab]           = useState('Comments')
  const [mode, setMode]         = useState('buy')
  const [amt, setAmt]           = useState('')
  const [showPanel, setShow]    = useState(false)
  const [tf, setTf]             = useState('15m')
  const [chartStats, setStats]  = useState({ vol24h: 0, price: 0, pct5m: 0, pct1h: 0 })
  const [newComment, setNewComment] = useState('')
  const [sellStep, setSellStep] = useState('idle')
  const [comments, setComments] = useState([
    { id: 1, user: 'monad_degen', text: 'MonPad gonna be the pump.fun of Monad 👀', time: '2h', likes: 1 },
    { id: 2, user: 'Dev', text: 'Welcome! Dev fees hit your wallet every trade 💜', time: '1h', likes: 2, dev: true },
  ])

  const chartContainerRef = useRef(null)
  const chartRef          = useRef(null)
  const candleRef         = useRef(null)
  const volRef            = useRef(null)
  // refs to prevent stale closures in async sell flow
  const sellStepRef  = useRef('idle')
  const amtRef       = useRef('')
  const curveAddrRef = useRef(null)

  const { writeContract, data: txHash, isPending }                  = useWriteContract()
  const { isLoading: isConfirming, isSuccess }                      = useWaitForTransactionReceipt({ hash: txHash })

  // metadata from server
  useEffect(() => {
    if (!tokenAddr || !SERVER) return
    fetch(`${SERVER}/api/token/meta/${tokenAddr}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setMeta(d)).catch(() => {})
  }, [tokenAddr])

  // on-chain
  useEffect(() => { if (tokenAddr && client) loadChain() }, [tokenAddr, client])

  async function loadChain() {
    if (!tokenAddr || !client) return
    try {
      const curve = await client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'curve' })
      setCurve(curve)
      const [name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWei, creator] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'name' }),
        client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'symbol' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'graduated' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'monRaisedNet' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'capMon' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'bondedBps' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'priceWeiPerToken' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'creator' }),
      ])
      setInfo({ name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWei, creator })
      loadEvents(curve, tokenAddr)
    } catch (e) { console.error(e) }
  }

  async function loadEvents(curve, token) {
    try {
      const [buyLogs, sellLogs, txLogs] = await Promise.all([
        client.getLogs({ address: curve, event: parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)'), fromBlock: START_BLOCK, toBlock: 'latest' }),
        client.getLogs({ address: curve, event: parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)'), fromBlock: START_BLOCK, toBlock: 'latest' }),
        client.getLogs({ address: token, event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'), fromBlock: START_BLOCK, toBlock: 'latest' }),
      ])
      const all = [
        ...buyLogs.map(l  => ({ type:'buy',  addr: l.args.buyer,  mon: l.args.monIn,  tokens: l.args.tokensOut, block: l.blockNumber })),
        ...sellLogs.map(l => ({ type:'sell', addr: l.args.seller, mon: l.args.monOut, tokens: l.args.tokensIn,  block: l.blockNumber })),
      ].sort((a,b) => Number(b.block) - Number(a.block))
      setTrades(all)

      const bal = {}
      for (const l of txLogs) {
        const { from, to, value } = l.args
        if (from !== '0x0000000000000000000000000000000000000000') bal[from] = (bal[from]||0n) - value
        bal[to] = (bal[to]||0n) + value
      }
      setHolders(Object.entries(bal).filter(([a,v]) => v > 0n && a.toLowerCase() !== curve.toLowerCase()).sort((a,b) => Number(b[1])-Number(a[1])))
    } catch(e) { console.error(e) }
  }

  // build chart
  useEffect(() => {
    if (!chartContainerRef.current) return
    let destroyed = false

    async function init() {
      const LW = await import('lightweight-charts')
      if (destroyed || !chartContainerRef.current) return

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

      const chart = LW.createChart(chartContainerRef.current, {
        width:  chartContainerRef.current.clientWidth,
        height: 240,
        layout: { background: { color: '#111118' }, textColor: '#3a3458' },
        grid:   { vertLines: { color: 'rgba(110,84,255,0.04)' }, horzLines: { color: 'rgba(110,84,255,0.04)' } },
        crosshair: { mode: LW.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e1e2a', textColor: '#3a3458' },
        timeScale: { borderColor: '#1e1e2a', textColor: '#3a3458', timeVisible: true },
      })

      const candle = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
        borderVisible: false,
      })

      const vol = chart.addHistogramSeries({
        priceScaleId: 'vol',
        scaleMargins: { top: 0.85, bottom: 0 },
      })

      chartRef.current = chart
      candleRef.current = candle
      volRef.current = vol

      fetchCandles(candle, vol, chart)

      const ro = new ResizeObserver(() => { if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth }) })
      ro.observe(chartContainerRef.current)
    }

    init()
    return () => { destroyed = true; if (chartRef.current) { chartRef.current.remove(); chartRef.current = null } }
  }, [curveAddr])

  useEffect(() => {
    if (candleRef.current && volRef.current && chartRef.current && curveAddr) fetchCandles(candleRef.current, volRef.current, chartRef.current)
  }, [tf, curveAddr, info?.creator])  // re-run when creator known so dev markers render

  async function fetchCandles(candle, vol, chart) {
    if (!curveAddr) return
    try {
      const res = await fetch(`${SERVER}/api/candles/${curveAddr}?interval=${tf}`)
      if (!res.ok) throw new Error('no data')
      const { candles, trades: tm } = await res.json()
      if (!candles?.length) throw new Error('empty')

      candle.setData(candles)
      vol.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' })))

      // current price line
      const last = candles[candles.length - 1]
      if (last) {
        candle.createPriceLine({ price: last.close, color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, axisLabelColor: '#ef4444', axisLabelTextColor: '#fff' })
      }

      // trade markers — green ▲D for dev buys, red ▼D for dev sells
      const creatorAddr = info?.creator?.toLowerCase()
      const devTrades = (tm || []).filter(t => creatorAddr && t.addr?.toLowerCase() === creatorAddr)
      if (devTrades.length) {
        candle.setMarkers(
          devTrades
            .sort((a, b) => a.ts - b.ts)  // lightweight-charts requires ascending time
            .map(t => ({
              time:     t.ts,
              position: t.type === 'buy' ? 'belowBar' : 'aboveBar',
              color:    t.type === 'buy' ? '#22c55e'  : '#ef4444',
              shape:    t.type === 'buy' ? 'arrowUp'  : 'arrowDown',
              text: 'D',
              size: 1,
            }))
        )
      }

      chart.timeScale().fitContent()

      // stats
      const now = Date.now() / 1000
      const vol24 = (tm || []).filter(t => t.ts > now - 86400).reduce((s,t) => s + t.volume, 0)
      const c5m = candles.filter(c => c.time > now - 300)
      const c1h = candles.filter(c => c.time > now - 3600)
      setStats({
        vol24h: vol24,
        price: last?.close || 0,
        pct5m: c5m.length >= 2 ? (c5m[c5m.length-1].close - c5m[0].open) / c5m[0].open * 100 : 0,
        pct1h: c1h.length >= 2 ? (c1h[c1h.length-1].close - c1h[0].open) / c1h[0].open * 100 : 0,
      })
    } catch {
      // fallback placeholder candles
      const now = Math.floor(Date.now()/1000), int = tf === '15m' ? 900 : tf === '1h' ? 3600 : tf === '4h' ? 14400 : 86400
      let p = 150000
      const fake = []
      for (let i = 48; i >= 0; i--) {
        const t = now - i*int, o = p
        p = Math.max(10000, p + (Math.random()-.48)*15000)
        const c = p, h = Math.max(o,c)+Math.random()*8000, l = Math.max(Math.min(o,c)-Math.random()*5000,1)
        fake.push({ time:t, open:o, high:h, low:l, close:c, volume: Math.random()*15 })
      }
      candle.setData(fake)
      vol.setData(fake.map(c => ({ time:c.time, value:c.volume, color: c.close>=c.open?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)' })))
      chart.timeScale().fitContent()
    }
  }

  function handleBuy() {
    if (!curveAddr || !amt) return
    writeContract({ address: curveAddr, abi: CURVE_ABI, functionName: 'buy', args: [0n], value: parseEther(amt), chainId: monad.id })
  }

  function handleSell() {
    if (!curveAddr || !amt || !tokenAddr) return
    // snapshot values into refs so the async effect reads correct values
    sellStepRef.current  = 'approving'
    amtRef.current       = amt
    curveAddrRef.current = curveAddr
    setSellStep('approving')
    writeContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'approve', args: [curveAddr, parseEther(amt)], chainId: monad.id })
  }

  // After approve confirms → fire sell. After sell confirms → refresh.
  useEffect(() => {
    if (!isSuccess) return
    if (sellStepRef.current === 'approving') {
      const savedAmt   = amtRef.current
      const savedCurve = curveAddrRef.current
      if (!savedAmt || !savedCurve) return
      sellStepRef.current = 'selling'
      setSellStep('selling')
      try {
        writeContract({ address: savedCurve, abi: CURVE_ABI, functionName: 'sell', args: [parseEther(savedAmt), 0n], chainId: monad.id })
      } catch(e) { console.error('sell error', e); sellStepRef.current = 'idle'; setSellStep('idle') }
      return
    }
    if (sellStepRef.current === 'selling') {
      sellStepRef.current = 'idle'
      setSellStep('idle')
      loadChain()
      return
    }
    // buy confirmed — just refresh
    loadChain()
  }, [isSuccess])

  if (!info) return <Layout showBack><div style={{ padding:'60px 14px', textAlign:'center', color:'var(--t3)' }}>Loading…</div></Layout>

  const pct         = Number(info.bondedBps) / 100
  const priceNum    = Number(info.priceWei) / 1e18
  const tokensEst   = (amt && priceNum > 0) ? Math.floor(parseFloat(amt) / priceNum / 1.02).toLocaleString() : '0'
  const isCreator   = userAddr?.toLowerCase() === info.creator?.toLowerCase()
  const dName       = meta?.name    || info.name
  const dSym        = meta?.symbol  || info.symbol

  return (
    <>
      <Head><title>{dName} (${dSym}) — MonPad</title></Head>
      <Layout showBack title={`${dName} · $${dSym}`}>

        {/* ── BANNER ── */}
        <div style={{ width:'100%', aspectRatio:'3/1', position:'relative', overflow:'hidden', background:'#120830' }}>
          {meta?.bannerUrl
            ? <img src={meta.bannerUrl} alt="banner" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <div style={{ width:'100%', height:'100%', background:'radial-gradient(circle at 30% 40%,rgba(110,84,255,0.5),transparent 60%),#120830', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:64, fontWeight:900, color:'rgba(255,255,255,0.06)' }}>{dSym.slice(0,2)}</span>
              </div>
          }
          <div style={{ position:'absolute', bottom:0, left:0, right:0, height:'60%', background:'linear-gradient(to top,var(--bg),transparent)' }} />
        </div>

        {/* ── TOKEN HEADER ── */}
        <div style={{ padding:'14px 14px 10px', display:'flex', gap:12 }}>
          <div style={{ width:56, height:56, borderRadius:12, border:'2px solid rgba(110,84,255,0.25)', flexShrink:0, overflow:'hidden', background:'radial-gradient(circle at 35% 35%,#3b1d9e,#120830)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:'rgba(255,255,255,0.12)' }}>
            {meta?.pfpUrl ? <img src={meta.pfpUrl} alt="pfp" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : dSym.slice(0,2)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:800 }}>{dName}</div>
            <div style={{ fontSize:12, color:'var(--t3)', fontFamily:'var(--mono)', marginBottom:4 }}>${dSym} · {fmtAddr(tokenAddr)}</div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:18, height:18, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, color:'white' }}>{(info.creator||'?').slice(2,4).toUpperCase()}</div>
              <span style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>{fmtAddr(info.creator)}</span>
              {isCreator && <span style={{ fontSize:10, background:'rgba(255,174,69,0.15)', color:'var(--gold)', padding:'1px 6px', borderRadius:4, fontWeight:700 }}>You 👑</span>}
            </div>
          </div>
        </div>

        {/* ── CTA ── */}
        <div style={{ padding:'0 14px 14px', display:'flex', gap:8 }}>
          <button className="btn-primary" style={{ flex:1 }} onClick={() => setShow(true)}>{userAddr ? 'Trade' : 'Connect to trade'}</button>
          <button onClick={() => navigator.clipboard.writeText(tokenAddr||'')}
            style={{ width:46, height:46, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, cursor:'pointer', flexShrink:0 }}>⎘</button>
        </div>

        {/* ── MC STATS ── */}
        <div style={{ padding:'0 14px 10px' }}>
          <div style={{ fontSize:12, color:'var(--t2)', marginBottom:2 }}>Market Cap</div>
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:28, fontWeight:800, letterSpacing:'-.5px' }}>{fmtMON(info.monRaisedNet)} MON</div>
              <div style={{ fontSize:12, color:'var(--g)', marginTop:2 }}>+0 MON (+0.00%) 24hr</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ width:100, height:5, background:'var(--bg3)', borderRadius:999, overflow:'hidden', marginBottom:4, marginLeft:'auto' }}>
                <div style={{ height:'100%', background:'linear-gradient(90deg,var(--g),var(--cyan))', borderRadius:999, width:`${Math.min(pct,100)}%` }} />
              </div>
              <div style={{ fontSize:11, color:'var(--t3)' }}>ATH <span style={{ color:'var(--t2)', fontWeight:700 }}>{fmtMON(info.monRaisedNet)} MON</span></div>
            </div>
          </div>
        </div>

        {/* ── CHART TOOLBAR ── */}
        <div style={{ display:'flex', alignItems:'center', padding:'0 14px 6px', overflowX:'auto', fontSize:12, color:'var(--t3)' }}>
          {TF_OPTIONS.map((t,i) => (
            <button key={t} onClick={() => setTf(t)}
              style={{ padding:'6px 10px', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--sans)', fontSize:12, fontWeight:tf===t?700:400, color:tf===t?'var(--t1)':'var(--t3)', borderRight:i<TF_OPTIONS.length-1?'1px solid var(--bd)':'none' }}>
              {t}
            </button>
          ))}
          <div style={{ width:1, height:16, background:'var(--bd)', margin:'0 4px' }} />
          <span style={{ padding:'6px 8px', whiteSpace:'nowrap', cursor:'pointer' }}>Trade Display</span>
          <span style={{ padding:'6px 8px', whiteSpace:'nowrap', cursor:'pointer' }}>Hide Bubbles</span>
          <span style={{ padding:'6px 8px', whiteSpace:'nowrap', cursor:'pointer' }}>Price/MC</span>
        </div>

        {/* ── CHART ── */}
        <div style={{ margin:'0 14px 6px', borderRadius:12, overflow:'hidden', background:'var(--bg2)', border:'1px solid var(--bd)', padding:'10px 6px 6px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'0 6px 6px' }}>
            <div>
              <div style={{ fontSize:11, color:'var(--t2)', fontFamily:'var(--mono)' }}>{dSym}/MON Market Cap · MonPad</div>
              <div style={{ display:'flex', gap:8, marginTop:2 }}>
                <span style={{ fontSize:12, fontWeight:700, fontFamily:'var(--mono)', color:'var(--p2)' }}>{fmtMON(info.monRaisedNet)}</span>
                <span style={{ fontSize:11, color:'var(--r)', fontFamily:'var(--mono)' }}>0 (0.00%)</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>Volume</div>
            </div>
            <div style={{ width:28, height:28, borderRadius:6, background:'var(--bg3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'var(--t3)' }}>TV</div>
          </div>

          <div ref={chartContainerRef} style={{ width:'100%', height:240 }} />

          <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 6px 0' }}>
            <div style={{ display:'flex', gap:2 }}>
              {['1D','5D','1M'].map(t => (
                <button key={t} style={{ padding:'4px 8px', borderRadius:5, fontSize:11, fontWeight:600, cursor:'pointer', color:'var(--t3)', background:'transparent', border:'none', fontFamily:'var(--sans)' }}>{t}</button>
              ))}
            </div>
            <div style={{ fontSize:10, color:'var(--t3)', fontFamily:'var(--mono)' }}>{new Date().toISOString().slice(11,19)} UTC · % log auto</div>
          </div>
        </div>

        {/* ── STATS ROW ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:1, margin:'0 14px 14px', background:'var(--bd)', borderRadius:10, overflow:'hidden' }}>
          {[
            ['Vol 24h', chartStats.vol24h > 0 ? `${chartStats.vol24h.toFixed(1)} MON` : '—', null],
            ['Price',   `${priceNum.toFixed(6)}`.slice(0,10), null],
            ['5m',      `${chartStats.pct5m >= 0?'+':''}${chartStats.pct5m.toFixed(2)}%`, chartStats.pct5m],
            ['1h',      `${chartStats.pct1h >= 0?'+':''}${chartStats.pct1h.toFixed(2)}%`, chartStats.pct1h],
          ].map(([l,v,chg]) => (
            <div key={l} style={{ background:'var(--bg2)', padding:'10px 8px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.3px', marginBottom:3 }}>{l}</div>
              <div style={{ fontSize:12, fontWeight:800, fontFamily:'var(--mono)', color: chg!=null?(chg>=0?'var(--g)':'var(--r)'):'var(--t1)' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* ── BONDING CURVE ── */}
        <div style={{ margin:'0 14px 14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:15, fontWeight:800 }}>Bonding Curve Progress</span>
            <span style={{ fontSize:15, fontWeight:800, fontFamily:'var(--mono)', color:info.graduated?'var(--gold)':'var(--p2)' }}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{ height:12, background:'var(--bg3)', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
            <div style={{ height:'100%', borderRadius:999, width:`${Math.min(pct,100)}%`, background:info.graduated?'linear-gradient(90deg,#d97706,#FFAE45)':'linear-gradient(90deg,#6E54FF,#a78bfa)', boxShadow:info.graduated?'0 0 12px rgba(255,174,69,0.4)':'0 0 12px rgba(110,84,255,0.4)', transition:'width .5s ease' }} />
          </div>
          <div style={{ fontSize:12, color:info.graduated?'var(--gold)':'var(--t3)' }}>
            {info.graduated ? '🎓 Coin has graduated! LP permanently burned on Uniswap V3' : `Graduates at ${fmtMON(info.capMon)} MON → Uniswap V3, LP burned 🔥`}
          </div>
          {meta?.desc && <div style={{ fontSize:13, color:'var(--t3)', lineHeight:1.6, marginTop:10 }}>{meta.desc}</div>}
        </div>

        {/* ── SOCIALS ── */}
        <div style={{ margin:'0 14px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {meta?.twitter && (
            <a href={meta.twitter} target="_blank" rel="noreferrer"
              style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:10, padding:'12px 14px', fontSize:14, fontWeight:600, color:'var(--t1)' }}>
              <span>𝕏</span><span>{dName} community</span><span style={{ marginLeft:'auto', color:'var(--t3)' }}>↗</span>
            </a>
          )}
          {meta?.website && (
            <a href={meta.website} target="_blank" rel="noreferrer"
              style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:10, padding:'12px 14px', fontSize:14, fontWeight:600, color:'var(--t1)' }}>
              <span>🌐</span><span>{meta.website.replace('https://','')}</span><span style={{ marginLeft:'auto', color:'var(--t3)' }}>↗</span>
            </a>
          )}
          <a href={`${MONADSCAN}/token/${tokenAddr}`} target="_blank" rel="noreferrer"
            style={{ display:'flex', alignItems:'center', gap:10, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:10, padding:'12px 14px', fontSize:14, fontWeight:600, color:'var(--t1)' }}>
            <span>🔍</span><span>View on Monadscan</span><span style={{ marginLeft:'auto', color:'var(--t3)' }}>↗</span>
          </a>
        </div>

        {/* ── COMMUNITY ── */}
        <div style={{ margin:'0 14px 14px', display:'flex', alignItems:'center', gap:12, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:12, padding:'12px 14px' }}>
          <div style={{ width:44, height:44, borderRadius:'50%', overflow:'hidden', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, flexShrink:0 }}>
            {meta?.pfpUrl ? <img src={meta.pfpUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : dSym.slice(0,1)}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700 }}>{dName} chat</div>
            <div style={{ fontSize:11, color:'var(--t3)' }}>{holders.length} holders</div>
          </div>
          <button style={{ background:'var(--bg3)', border:'1px solid var(--bd2)', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:700, color:'var(--t1)', cursor:'pointer', fontFamily:'var(--sans)' }}>💬 Join chat</button>
        </div>

        {/* ── TABS ── */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--bd)', margin:'0 14px', position:'sticky', top:53, background:'var(--bg)', zIndex:10 }}>
          {DETAIL_TABS.map(t => (
            <div key={t} onClick={() => setTab(t)}
              style={{ flex:1, padding:'12px 0', textAlign:'center', fontSize:13, fontWeight:700, color:tab===t?'var(--t1)':'var(--t3)', cursor:'pointer', borderBottom:tab===t?'2px solid var(--p)':'2px solid transparent', marginBottom:-1 }}>
              {t}{t==='Trades'&&trades.length>0?` (${trades.length})`:''}{t==='Holders'&&holders.length>0?` (${holders.length})`:''}
            </div>
          ))}
        </div>

        {/* COMMENTS */}
        {tab === 'Comments' && (
          <div>
            <div style={{ display:'flex', gap:8, padding:'12px 14px', borderBottom:'1px solid var(--bd)', alignItems:'center' }}>
              <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'white', flexShrink:0 }}>
                {userAddr ? userAddr.slice(2,4).toUpperCase() : '?'}
              </div>
              <input className="input-field" style={{ flex:1, padding:'9px 12px', fontSize:13 }} placeholder="Add a comment…" value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter'&&newComment.trim()) { setComments(p => [{ id:Date.now(), user:fmtAddr(userAddr)||'anon', text:newComment, time:'now', likes:0 }, ...p]); setNewComment('') }}} />
              <button className="btn-ghost" style={{ padding:'8px 10px', fontSize:11, whiteSpace:'nowrap' }}>↓≡ Newest</button>
            </div>
            {comments.map(c => (
              <div key={c.id} style={{ display:'flex', gap:10, padding:'14px', borderBottom:'1px solid var(--bd)' }}>
                <div style={{ width:34, height:34, borderRadius:'50%', background:c.dev?'var(--gold)':'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:c.dev?'#000':'white', flexShrink:0 }}>
                  {c.user.slice(0,1).toUpperCase()}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:700 }}>{c.user}</span>
                    {c.dev && <span style={{ fontSize:10, background:'rgba(255,174,69,0.15)', color:'var(--gold)', padding:'1px 6px', borderRadius:4, fontWeight:700 }}>Dev 👑</span>}
                    <span style={{ fontSize:11, color:'var(--t3)' }}>{c.time}</span>
                  </div>
                  <div style={{ fontSize:13, color:'var(--t2)', lineHeight:1.5 }}>{c.text}</div>
                  <div style={{ fontSize:11, color:'var(--t3)', marginTop:4, cursor:'pointer' }}>Reply</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                  <span style={{ fontSize:16, cursor:'pointer', color:'var(--t3)' }}>♡</span>
                  <span style={{ fontSize:10, color:'var(--t3)' }}>{c.likes}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TRADES */}
        {tab === 'Trades' && (
          <div style={{ padding:'0 14px' }}>
            {trades.length === 0 && <div style={{ padding:'30px 0', textAlign:'center', color:'var(--t3)', fontSize:13 }}>No trades yet</div>}
            {trades.map((t,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 0', borderBottom:'1px solid var(--bd)' }}>
                <div style={{ fontSize:11, fontWeight:800, padding:'3px 8px', borderRadius:5, background:t.type==='buy'?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)', color:t.type==='buy'?'var(--g)':'var(--r)', flexShrink:0 }}>{t.type.toUpperCase()}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--t2)' }}>{fmtAddr(t.addr)}</div>
                  <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{fmtTokens(t.tokens)} {dSym}</div>
                </div>
                <div style={{ fontSize:13, fontWeight:800, fontFamily:'var(--mono)', color:t.type==='buy'?'var(--g)':'var(--r)' }}>{t.type==='buy'?'+':'-'}{fmtMON(t.mon)} MON</div>
              </div>
            ))}
          </div>
        )}

        {/* HOLDERS */}
        {tab === 'Holders' && (
          <div style={{ padding:'0 14px' }}>
            {holders.length === 0 && <div style={{ padding:'30px 0', textAlign:'center', color:'var(--t3)', fontSize:13 }}>No holders yet</div>}
            {holders.slice(0,20).map(([addr,bal],i) => {
              const total = holders.reduce((s,[,v]) => s+Number(v), 0)
              const p = total > 0 ? (Number(bal)/total*100).toFixed(1) : '0'
              return (
                <div key={addr} style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 0', borderBottom:'1px solid var(--bd)' }}>
                  <div style={{ fontSize:i<3?16:13, fontWeight:800, color:['var(--gold)','#aaa','#cd7f32'][i]||'var(--t3)', width:24, textAlign:'center', flexShrink:0 }}>{i<3?['🥇','🥈','🥉'][i]:i+1}</div>
                  <div style={{ width:34, height:34, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'white', flexShrink:0 }}>{addr.slice(2,4).toUpperCase()}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontFamily:'var(--mono)', color:'var(--t2)' }}>{fmtAddr(addr)}</div>
                    {addr.toLowerCase()===info.creator?.toLowerCase()&&<div style={{ fontSize:10, color:'var(--gold)' }}>Creator 👑</div>}
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:13, fontWeight:800, fontFamily:'var(--mono)' }}>{p}%</div>
                    <div style={{ width:60, height:4, background:'var(--bg3)', borderRadius:999, overflow:'hidden', marginTop:3, marginLeft:'auto' }}>
                      <div style={{ height:'100%', background:'var(--p)', borderRadius:999, width:`${p}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── STICKY TRADE BUTTON ── */}
        <div style={{ position:'sticky', bottom:62, background:'var(--bg)', borderTop:'1px solid var(--bd)', padding:'12px 14px', zIndex:50 }}>
          <button className="btn-primary" style={{ width:'100%', padding:16, fontSize:16, fontWeight:800, borderRadius:14 }} onClick={() => setShow(true)}>
            {userAddr ? 'Trade' : 'Connect to trade'}
          </button>
        </div>

        {/* ── TRADE PANEL ── */}
        {showPanel && (
          <div className="sheet-overlay" onClick={() => setShow(false)}>
            <div className="sheet" onClick={e => e.stopPropagation()}>
              <div className="sheet-handle" />
              <div style={{ display:'flex', gap:2, background:'var(--bg3)', borderRadius:12, padding:3, marginBottom:16 }}>
                {['buy','sell'].map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ flex:1, padding:11, borderRadius:9, fontSize:14, fontWeight:800, border:'none', fontFamily:'var(--sans)', cursor:'pointer',
                      background: mode===m?(m==='buy'?'var(--p)':'var(--r)'):'transparent',
                      color: mode===m?'white':'var(--t3)' }}>
                    {m.charAt(0).toUpperCase()+m.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ position:'relative', marginBottom:10 }}>
                <input type="number" placeholder={`0.0 ${mode==='buy'?'MON':dSym}`} value={amt} onChange={e => setAmt(e.target.value)}
                  className="input-field" style={{ fontSize:22, fontWeight:800, padding:'14px 60px 14px 16px', fontFamily:'var(--mono)' }} />
                <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'rgba(110,84,255,0.15)', color:'var(--p2)', fontSize:11, fontWeight:700, padding:'4px 8px', borderRadius:6, cursor:'pointer' }}>MAX</div>
              </div>
              <div style={{ display:'flex', gap:6, marginBottom:14 }}>
                {['1','10','50','100'].map(n => (
                  <div key={n} onClick={() => setAmt(n)}
                    style={{ flex:1, padding:'9px 0', textAlign:'center', background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.2)', borderRadius:8, fontSize:13, fontWeight:700, color:'var(--p2)', cursor:'pointer' }}>{n}</div>
                ))}
              </div>
              <div style={{ background:'var(--bg3)', border:'1px solid var(--bd2)', borderRadius:12, padding:'12px 14px', marginBottom:14 }}>
                {[
                  ['You receive',      mode==='buy'?`${tokensEst} ${dSym}`:`${((parseFloat(amt)||0)*priceNum*0.98).toFixed(4)} MON`],
                  ['Platform fee (1%)',`${((parseFloat(amt)||0)*0.01).toFixed(4)} ${mode==='buy'?'MON':''}`],
                  ['Dev fee (0.5%)',   `${((parseFloat(amt)||0)*0.005).toFixed(4)} ${mode==='buy'?'MON':''}`],
                ].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'3px 0' }}>
                    <span style={{ color:'var(--t3)' }}>{l}</span><span style={{ fontFamily:'var(--mono)', fontWeight:600 }}>{v}</span>
                  </div>
                ))}
                <div style={{ height:1, background:'var(--bd)', margin:'6px 0' }} />
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
                  <span style={{ color:'var(--t3)' }}>Total</span>
                  <span style={{ fontWeight:800, fontFamily:'var(--mono)' }}>{amt||'0'} {mode==='buy'?'MON':dSym}</span>
                </div>
              </div>
              <button className="btn-primary"
                style={{ width:'100%', padding:16, fontSize:16, fontWeight:800, borderRadius:14, marginBottom:10, background:mode==='sell'?'var(--r)':'var(--p)' }}
                onClick={mode==='buy'?handleBuy:handleSell} disabled={isPending||isConfirming||sellStep!=='idle'}>
                {sellStep==='approving'?'Approving tokens…':sellStep==='selling'?'Confirm sell…':isPending?'Confirm in wallet…':isConfirming?'Confirming…':userAddr?`${mode==='buy'?'Buy':'Sell'} ${dSym}`:'Connect Wallet'}
              </button>
              <button className="btn-ghost" style={{ width:'100%' }} onClick={() => setShow(false)}>Cancel</button>
              <div style={{ display:'flex', justifyContent:'center', gap:16, marginTop:12 }}>
                <a href={`${MONADSCAN}/token/${tokenAddr}`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--t3)' }}>Monadscan ↗</a>
                <a href={`${MONADSCAN}/address/${curveAddr}`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--t3)' }}>Curve Contract ↗</a>
              </div>
            </div>
          </div>
        )}

      </Layout>
    </>
  )
}
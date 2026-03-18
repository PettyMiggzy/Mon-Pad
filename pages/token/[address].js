import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { usePublicClient, useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
import Head from 'next/head'
import Layout from '../../components/Layout'
import LiveStream from '../../components/LiveStream'
import { CURVE_ABI, TOKEN_ABI, fmtMON, fmtUSD, fmtAddr, fmtTokens, MONADSCAN } from '../../lib/constants'
import { monad } from '../../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

// rewrite old http droplet URLs to go through the proxy
function fixUrl(url) {
  if (!url) return url
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  if (url.startsWith('http://api.monpad.net')) return url.replace('http://api.monpad.net', 'https://api.monpad.net')
  return url
}
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
  const [monPrice, setMonPrice] = useState(0)
  const [trades, setTrades]     = useState([])
  const [holders, setHolders]   = useState([])
  const [tab, setTab]           = useState('Comments')
  const [mode, setMode]         = useState('buy')
  const [amt, setAmt]           = useState('')
  const [customAmt, setCustomAmt] = useState(false)
  const customInputRef            = useRef(null)
  const [tokenBalance, setTokenBalance] = useState(0n)
  const [showPanel, setShow]    = useState(false)
  const [tf, setTf]             = useState('15m')
  const [chartStats, setStats]  = useState({ vol24h: 0, totalVol: 0, devFees: 0, price: 0, pct5m: 0, pct1h: 0 })
  const [newComment, setNewComment] = useState('')
  const [sellStep, setSellStep] = useState('idle')
  const [txErrMsg, setTxErrMsg] = useState('')
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

  const { writeContract: writeApprove, data: approveTxHash, isPending: approvePending, error: approveWriteErr } = useWriteContract()
  const { writeContract: writeSell,    data: sellTxHash,    isPending: sellPending,    error: sellWriteErr }    = useWriteContract()
  const { writeContract: writeBuy,     data: buyTxHash,     isPending: buyPending,     error: buyWriteErr }     = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess, isError: approveErr } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: sellConfirming,    isSuccess: sellSuccess,    isError: sellErr }    = useWaitForTransactionReceipt({ hash: sellTxHash })
  const { isLoading: buyConfirming,     isSuccess: buySuccess,     isError: buyErr }     = useWaitForTransactionReceipt({ hash: buyTxHash })
  const isPending    = approvePending || sellPending || buyPending
  const isConfirming = approveConfirming || sellConfirming || buyConfirming
  const txError      = approveWriteErr || sellWriteErr || buyWriteErr

  // fetch MON price
  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/mon-price`).then(r=>r.json()).then(d=>setMonPrice(d.price||0)).catch(()=>{})
  }, [])

  // metadata from server
  useEffect(() => {
    if (!tokenAddr || !SERVER) return
    const fetchMeta = (attempt = 0) => {
      fetch(`${SERVER}/api/token/meta/${tokenAddr}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) setMeta(d)
          else if (attempt < 3) setTimeout(() => fetchMeta(attempt + 1), 2000)
        })
        .catch(() => { if (attempt < 3) setTimeout(() => fetchMeta(attempt + 1), 2000) })
    }
    fetchMeta()
  }, [tokenAddr])

  // on-chain
  useEffect(() => { if (tokenAddr && client) loadChain() }, [tokenAddr, client])

  // poll price every 10s
  useEffect(() => {
    if (!tokenAddr || !client) return
    const iv = setInterval(async () => {
      try {
        const curve = curveAddr || await client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'curve' })
        const [priceWei, monRaisedNet, bondedBps, graduated] = await Promise.all([
          client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'priceWeiPerToken' }),
          client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'monRaisedNet' }),
          client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'bondedBps' }),
          client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'graduated' }),
        ])
        setInfo(p => p ? { ...p, priceWei, monRaisedNet, bondedBps, graduated } : p)
      } catch {}
    }, 10000)
    return () => clearInterval(iv)
  }, [tokenAddr, client, curveAddr])

  async function loadChain() {
    if (!tokenAddr || !client) return
    try {
      const curve = await client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'curve' })
      const [name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWei, creator, pauseBuys, pauseSells, delisted] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'name' }),
        client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'symbol' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'graduated' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'monRaisedNet' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'capMon' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'bondedBps' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'priceWeiPerToken' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'creator' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'pauseBuys' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'pauseSells' }),
        client.readContract({ address: curve,     abi: CURVE_ABI, functionName: 'delisted' }),
      ])
      // setInfo FIRST so full JSX renders and chart div appears in DOM
      setInfo({ name, symbol, graduated, monRaisedNet, capMon, bondedBps, priceWei, creator, pauseBuys, pauseSells, delisted })
      // setCurve AFTER — triggers chart useEffect once div is mounted
      setCurve(curve)
      if (userAddr) {
        const bal = await client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'balanceOf', args: [userAddr] })
        setTokenBalance(bal)
      }
    } catch (e) { console.error(e) }
  }

  // trades + holders come from server cache — no getLogs from browser
  async function loadTradesAndHolders(curveAddr) {
    try {
      const res = await fetch(`${SERVER}/api/candles/${curveAddr}?interval=15m`)
      if (!res.ok) return
      const { trades: tm } = await res.json()
      if (!tm?.length) return
      const sorted = [...tm].sort((a,b) => b.ts - a.ts)
      setTrades(sorted.map(t => ({ type:t.type, addr:t.addr, mon: BigInt(Math.floor(t.volume*1e18)), tokens:0n, block:0n })))
    } catch {}
  }

  // build chart
  useEffect(() => {
    const el = chartContainerRef.current
    if (!el || !curveAddr) return
    let cancelled = false
    let chart = null, candle = null, vol = null

    import('lightweight-charts')
      .then(({ createChart }) => {
        if (cancelled || !chartContainerRef.current) return
        const el = chartContainerRef.current
        const w = el.getBoundingClientRect().width || 800
        chart = createChart(el, {
          width: w, height: 340,
          layout: { background: { type: 'solid', color: '#0E091C' }, textColor: '#9ca3af' },
          grid: { vertLines: { color: 'rgba(110,84,255,0.08)' }, horzLines: { color: 'rgba(110,84,255,0.08)' } },
          rightPriceScale: { borderColor: '#2a2a3a', textColor: '#9ca3af' },
          timeScale: { borderColor: '#2a2a3a', textColor: '#9ca3af', timeVisible: true },
          crosshair: { mode: 1 },
        })

        candle = chart.addCandlestickSeries({
          upColor: '#22c55e', downColor: '#ef4444',
          wickUpColor: '#22c55e', wickDownColor: '#ef4444',
          borderVisible: false,
        })

        vol = chart.addHistogramSeries({ priceScaleId: 'vol', color: 'rgba(110,84,255,0.3)' })
        try { chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } }) } catch {}

        chartRef.current = chart
        candleRef.current = candle
        volRef.current = vol

        // flat line at launch price — always visible
        const price = 0.00015
        const now = Math.floor(Date.now() / 1000)
        const flat = Array.from({ length: 60 }, (_, i) => ({
          time: now - (60 - i) * 900,
          open: price, high: price * 1.002,
          low: price * 0.998, close: price, volume: 0
        }))
        candle.setData(flat)
        chart.timeScale().fitContent()

        const ro = new ResizeObserver(() => {
          const el = chartContainerRef.current
          if (el && chart) chart.applyOptions({ width: el.getBoundingClientRect().width })
        })
        ro.observe(el)

        // fetch real candles from server
        fetchCandles(candle, vol, chart)
      })
      .catch(e => console.error('❌ LW import error:', e))

    return () => {
      cancelled = true
      if (chart) { try { chart.remove() } catch {} }
      chartRef.current = null; candleRef.current = null; volRef.current = null
    }
  }, [curveAddr])

  useEffect(() => {
    if (candleRef.current && volRef.current && chartRef.current && curveAddr) fetchCandles(candleRef.current, volRef.current, chartRef.current)
  }, [tf, curveAddr, info?.creator, info?.priceWei])  // re-run when price/creator known

  async function fetchCandles(candle, vol, chart) {
    if (!curveAddr) return
    const now = Math.floor(Date.now()/1000)
    const int = tf==='15m'?900 : tf==='1h'?3600 : tf==='4h'?14400 : 86400
    const currentPrice = Number(info?.priceWei || 150000000000000n) / 1e18

    // flat candles at current price — always shown as baseline
    function flatLine(price) {
      if (!price || price <= 0) price = 0.00015
      const out = []
      // start from a clean aligned boundary, step forward
      const startT = Math.floor((now - 48*int) / int) * int
      for (let i = 0; i < 48; i++) {
        out.push({ time: startT + i*int, open:price, high:price*1.002, low:price*0.998, close:price, volume:0 })
      }
      return out
    }

    try {
      const res = await fetch(`${SERVER}/api/candles/${curveAddr}?interval=${tf}`)
      if (!res.ok) throw new Error('no data')
      const { candles, trades: tm } = await res.json()

      const data = (candles?.length) ? candles : flatLine(currentPrice)

      try {
        candle.setData(data)
        vol.setData(data.map(c => ({ time:c.time, value:c.volume||0, color: c.close>=c.open?'rgba(34,197,94,0.3)':'rgba(239,68,68,0.3)' })))
      } catch(e) { console.error('chart setData error:', e, 'data sample:', data[0]) }

      const last = data[data.length-1]
      if (last) {
        try { candle.createPriceLine({ price:last.close, color:'#6E54FF', lineWidth:1, lineStyle:2, axisLabelVisible:true, axisLabelColor:'#6E54FF', axisLabelTextColor:'#fff' }) } catch {}
      }

      if (candles?.length) {
        const creatorAddr = info?.creator?.toLowerCase()
        const devTrades = (tm||[]).filter(t => creatorAddr && t.addr?.toLowerCase()===creatorAddr)
        if (devTrades.length) {
          candle.setMarkers(devTrades.sort((a,b)=>a.ts-b.ts).map(t => ({
            time:t.ts, position:t.type==='buy'?'belowBar':'aboveBar',
            color:t.type==='buy'?'#22c55e':'#ef4444',
            shape:t.type==='buy'?'arrowUp':'arrowDown', text:'D', size:1,
          })))
        }
      }

      chart.timeScale().fitContent()

      const vol24 = (tm||[]).filter(t=>t.ts>now-86400).reduce((s,t)=>s+t.volume,0)
      const totalVol = (tm||[]).reduce((s,t)=>s+t.volume,0)
      const c5m = data.filter(c=>c.time>now-300)
      const c1h = data.filter(c=>c.time>now-3600)
      setStats({
        vol24h:vol24, totalVol, devFees:totalVol*0.015,
        price: last?.close||currentPrice,
        pct5m: c5m.length>=2?(c5m[c5m.length-1].close-c5m[0].open)/c5m[0].open*100:0,
        pct1h: c1h.length>=2?(c1h[c1h.length-1].close-c1h[0].open)/c1h[0].open*100:0,
      })
    } catch {
      const data = flatLine(currentPrice)
      try {
        candle.setData(data)
        vol.setData(data.map(c => ({ time:c.time, value:0, color:'rgba(110,84,255,0.15)' })))
        chart.timeScale().fitContent()
      } catch(e) { console.error('chart fallback error:', e, data[0]) }
    }
  }

  function handleBuy() {
    if (!curveAddr || !amt) return
    writeBuy({ address: curveAddr, abi: CURVE_ABI, functionName: 'buy', args: [0n], value: parseEther(amt), chainId: monad.id })
  }

  function handleSell() {
    if (!curveAddr || !amt || !tokenAddr) return
    // snapshot values into refs so the async effect reads correct values
    sellStepRef.current  = 'approving'
    amtRef.current       = amt
    curveAddrRef.current = curveAddr
    setSellStep('approving')
    writeApprove({ address: tokenAddr, abi: TOKEN_ABI, functionName: 'approve', args: [curveAddr, parseEther(amt)], chainId: monad.id })
  }

  // buy confirmed → refresh
  useEffect(() => { if (buySuccess) loadChain() }, [buySuccess])

  // approve confirmed → fire sell
  useEffect(() => {
    if (!approveSuccess) return
    const savedAmt   = amtRef.current
    const savedCurve = curveAddrRef.current
    if (!savedAmt || !savedCurve) return
    setSellStep('selling')
    sellStepRef.current = 'selling'
    writeSell({ address: savedCurve, abi: CURVE_ABI, functionName: 'sell', args: [parseEther(savedAmt), 0n], chainId: monad.id })
  }, [approveSuccess])

  // sell confirmed → refresh
  useEffect(() => {
    if (!sellSuccess) return
    sellStepRef.current = 'idle'
    setSellStep('idle')
    setTxErrMsg('')
    loadChain()
  }, [sellSuccess])

  // handle tx errors
  useEffect(() => {
    if (!sellErr && !approveErr && !buyErr) return
    sellStepRef.current = 'idle'
    setSellStep('idle')
    const msg = sellWriteErr?.shortMessage || approveWriteErr?.shortMessage || buyWriteErr?.shortMessage || 'Transaction failed'
    setTxErrMsg(msg)
    setTimeout(() => setTxErrMsg(''), 6000)
  }, [sellErr, approveErr, buyErr, sellWriteErr, approveWriteErr, buyWriteErr])

  // handle wallet rejection
  useEffect(() => {
    if (!txError) return
    sellStepRef.current = 'idle'
    setSellStep('idle')
    const msg = txError?.shortMessage || txError?.message || 'Transaction rejected'
    if (!msg.includes('user rejected') && !msg.includes('User denied')) {
      setTxErrMsg(msg)
      setTimeout(() => setTxErrMsg(''), 6000)
    }
  }, [txError])

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
      <Layout showBack title={`${dName}`}>
        <div style={{ maxWidth:1400, margin:'0 auto', padding:'0 0 80px' }}>

          {/* ── TOP HEADER BAR ── */}
          <div style={{ padding:'12px 16px 10px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid var(--bd)' }}>
            <div style={{ width:42, height:42, borderRadius:10, flexShrink:0, overflow:'hidden', background:'var(--bg3)', border:'1px solid var(--bd2)' }}>
              {meta?.pfpUrl
                ? <img src={fixUrl(meta.pfpUrl)} alt="pfp" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'var(--p2)' }}>{dSym.slice(0,2)}</div>
              }
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:18, fontWeight:800 }}>{dName}</span>
                <span style={{ fontSize:13, color:'var(--t3)', fontFamily:'var(--mono)' }}>${dSym}</span>
                {info.graduated && <span style={{ fontSize:10, background:'rgba(34,197,94,0.15)', color:'var(--g)', padding:'2px 7px', borderRadius:4, fontWeight:700 }}>🎓 Graduated</span>}
                {info.delisted  && <span style={{ fontSize:10, background:'rgba(239,68,68,0.15)', color:'var(--r)', padding:'2px 7px', borderRadius:4, fontWeight:700 }}>Delisted</span>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:2 }}>
                <div style={{ width:16, height:16, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:800, color:'white', flexShrink:0 }}>{(info.creator||'?').slice(2,4).toUpperCase()}</div>
                <span style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>by {fmtAddr(info.creator)}</span>
                {isCreator && <span style={{ fontSize:10, background:'rgba(255,174,69,0.15)', color:'#FFAE45', padding:'1px 6px', borderRadius:4, fontWeight:700 }}>You 👑</span>}
              </div>
            </div>
            {/* action buttons */}
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              <button onClick={() => navigator.clipboard.writeText(tokenAddr||'')}
                style={{ padding:'7px 12px', background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:8, fontSize:12, color:'var(--t2)', cursor:'pointer', fontFamily:'var(--mono)', whiteSpace:'nowrap' }}>
                {fmtAddr(tokenAddr)} ⎘
              </button>
              <button onClick={() => navigator.share?.({ url: window.location.href }) || navigator.clipboard.writeText(window.location.href)}
                style={{ padding:'7px 12px', background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:8, fontSize:12, color:'var(--t2)', cursor:'pointer' }}>
                Share ↗
              </button>
            </div>
          </div>

          {/* ── MAIN 2-COL LAYOUT ── */}
          <div style={{ display:'flex', gap:0, alignItems:'flex-start' }}>

            {/* ════ LEFT COLUMN — chart + info ════ */}
            <div style={{ flex:1, minWidth:0, borderRight:'1px solid var(--bd)' }}>

              {/* CHART */}
              <div style={{ padding:'0' }}>
                {/* chart header */}
                <div style={{ padding:'10px 14px 6px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--t2)' }}>{dSym}/MON Market Cap</span>
                  <span style={{ fontSize:20, fontWeight:800, color:'var(--p2)', fontFamily:'var(--mono)' }}>{fmtUSD((info.priceWei||0n)*1_000_000_000n, monPrice)}</span>
                  <span style={{ fontSize:12, color: chartStats.pct5m >= 0 ? 'var(--g)' : 'var(--r)', fontWeight:600 }}>
                    {chartStats.pct5m >= 0 ? '+' : ''}{chartStats.pct5m.toFixed(2)}%
                  </span>
                </div>

                {/* timeframe selector */}
                <div style={{ padding:'0 14px 8px', display:'flex', gap:6, alignItems:'center' }}>
                  {TF_OPTIONS.map(t => (
                    <button key={t} onClick={() => setTf(t)}
                      style={{ padding:'4px 10px', borderRadius:6, border:'none', fontSize:12, fontWeight:700, cursor:'pointer',
                        background: tf===t ? 'rgba(110,84,255,0.2)' : 'transparent',
                        color: tf===t ? 'var(--p2)' : 'var(--t3)' }}>
                      {t}
                    </button>
                  ))}
                </div>

                {/* chart canvas */}
                <div ref={chartContainerRef} style={{ height:340, width:'100%', minWidth:0, background:'#0E091C' }}></div>

                {/* stats bar */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderTop:'1px solid var(--bd)', borderBottom:'1px solid var(--bd)' }}>
                  {[
                    ['VOL 24H', chartStats.vol24h > 0 ? fmtMON(BigInt(Math.floor(chartStats.vol24h*1e18))) + ' MON' : '—'],
                    ['PRICE',   `${(Number(info.priceWei)/1e18).toFixed(8)} MON`],
                    ['5M',      { val: chartStats.pct5m, pct: true }],
                    ['1H',      { val: chartStats.pct1h, pct: true }],
                  ].map(([label, v]) => (
                    <div key={label} style={{ padding:'10px 14px', borderRight:'1px solid var(--bd)', textAlign:'center' }}>
                      <div style={{ fontSize:10, color:'var(--t3)', fontWeight:600, marginBottom:4, letterSpacing:'.5px' }}>{label}</div>
                      {typeof v === 'object' && v.pct
                        ? <div style={{ fontSize:14, fontWeight:800, color: v.val >= 0 ? 'var(--g)' : 'var(--r)' }}>{v.val >= 0 ? '+' : ''}{v.val.toFixed(2)}%</div>
                        : <div style={{ fontSize:14, fontWeight:800, fontFamily:'var(--mono)', color:'var(--t1)' }}>{v}</div>
                      }
                    </div>
                  ))}
                </div>
              </div>

              {/* LIVE STREAM */}
              <div style={{ borderBottom:'1px solid var(--bd)' }}>
                <LiveStream tokenAddress={tokenAddr} isCreator={isCreator} userAddr={userAddr} tokenName={dName} tokenSymbol={dSym} server={SERVER} />
              </div>

              {/* TOKEN DESCRIPTION / SOCIAL */}
              <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--bd)', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                {meta?.twitter && <a href={meta.twitter} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--t3)', display:'flex', alignItems:'center', gap:4, textDecoration:'none' }}>𝕏 {meta.twitter.replace('https://twitter.com/','').replace('https://x.com/','')}</a>}
                {meta?.telegram && <a href={meta.telegram} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--t3)', display:'flex', alignItems:'center', gap:4, textDecoration:'none' }}>✈️ Telegram</a>}
                {meta?.website && <a href={meta.website} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--t3)', display:'flex', alignItems:'center', gap:4, textDecoration:'none' }}>🌐 Website</a>}
                <a href={`https://monadexplorer.com/address/${tokenAddr}`} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--t3)', textDecoration:'none' }}>Contract ↗</a>
                <a href={`https://monadexplorer.com/address/${curveAddr}`} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--t3)', textDecoration:'none' }}>Curve ↗</a>
                {meta?.description && <span style={{ fontSize:12, color:'var(--t2)', width:'100%' }}>{meta.description}</span>}
                {!meta?.description && <span style={{ fontSize:12, color:'var(--t3)', fontStyle:'italic' }}>No description</span>}
              </div>

              {/* COMMENTS / TRADES / HOLDERS TABS */}
              <div>
                <div style={{ display:'flex', borderBottom:'1px solid var(--bd)' }}>
                  {DETAIL_TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      style={{ flex:1, padding:'12px 0', border:'none', borderBottom: tab===t ? '2px solid var(--p)' : '2px solid transparent',
                        background:'transparent', color: tab===t ? 'var(--t1)' : 'var(--t3)', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:-1 }}>
                      {t}
                    </button>
                  ))}
                </div>

                {/* COMMENTS */}
                {tab==='Comments' && (
                  <div style={{ padding:'12px 14px' }}>
                    {userAddr && (
                      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                        <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--p)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'white' }}>
                          {userAddr.slice(2,4).toUpperCase()}
                        </div>
                        <div style={{ flex:1, display:'flex', gap:6 }}>
                          <input className="input-field" style={{ flex:1, padding:'9px 12px', fontSize:13 }} placeholder="Add a comment…" value={newComment} onChange={e => setNewComment(e.target.value)}
                            onKeyDown={e => { if (e.key==='Enter' && newComment.trim()) { setComments(p => [{ id:Date.now(), user:fmtAddr(userAddr), text:newComment.trim(), time:'now', likes:0 }, ...p]); setNewComment('') }}} />
                          <button onClick={() => { if (newComment.trim()) { setComments(p => [{ id:Date.now(), user:fmtAddr(userAddr), text:newComment.trim(), time:'now', likes:0 }, ...p]); setNewComment('') }}}
                            className="btn-primary" style={{ padding:'9px 14px', fontSize:13 }}>Post</button>
                        </div>
                      </div>
                    )}
                    <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                      {['Newest','Likes'].map(s => (
                        <button key={s} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid var(--bd)', background:'transparent', fontSize:11, color:'var(--t3)', cursor:'pointer' }}>{s}</button>
                      ))}
                    </div>
                    {comments.map(c => (
                      <div key={c.id} style={{ display:'flex', gap:10, padding:'10px 0', borderBottom:'1px solid var(--bd)' }}>
                        <div style={{ width:32, height:32, borderRadius:'50%', background: c.dev ? 'linear-gradient(135deg,var(--p),var(--cyan))' : 'var(--bg3)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'white', border: c.dev ? 'none' : '1px solid var(--bd2)' }}>
                          {c.user.slice(-4,-2).toUpperCase()||'??'}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                            <span style={{ fontSize:12, fontWeight:700, color: c.dev ? 'var(--p2)' : 'var(--t2)' }}>{c.user}</span>
                            {c.dev && <span style={{ fontSize:9, background:'rgba(110,84,255,0.2)', color:'var(--p2)', padding:'1px 5px', borderRadius:3, fontWeight:700 }}>DEV</span>}
                            <span style={{ fontSize:10, color:'var(--t3)' }}>{c.time}</span>
                          </div>
                          <div style={{ fontSize:13, color:'var(--t1)', lineHeight:1.5 }}>{c.text}</div>
                          <button style={{ fontSize:11, color:'var(--t3)', background:'none', border:'none', cursor:'pointer', marginTop:4, padding:0 }}>
                            ♡ {c.likes} · Reply
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* TRADES */}
                {tab==='Trades' && (
                  <div style={{ padding:'12px 14px' }}>
                    {trades.length === 0
                      ? <div style={{ textAlign:'center', color:'var(--t3)', padding:'40px 0', fontSize:13 }}>No trades yet</div>
                      : trades.slice(0,50).map((t,i) => (
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--bd)', fontSize:12 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <span style={{ color: t.type==='buy' ? 'var(--g)' : 'var(--r)', fontWeight:700 }}>{t.type.toUpperCase()}</span>
                              <span style={{ color:'var(--t3)', fontFamily:'var(--mono)' }}>{fmtAddr(t.addr)}</span>
                            </div>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ color:'var(--t1)', fontFamily:'var(--mono)', fontWeight:600 }}>{t.volume?.toFixed(4)} MON</div>
                              <div style={{ color:'var(--t3)', fontSize:11 }}>{new Date(t.ts*1000).toLocaleTimeString()}</div>
                            </div>
                          </div>
                        ))
                    }
                  </div>
                )}

                {/* HOLDERS */}
                {tab==='Holders' && (
                  <div style={{ padding:'12px 14px' }}>
                    {holders.length === 0
                      ? <div style={{ textAlign:'center', color:'var(--t3)', padding:'40px 0', fontSize:13 }}>Holder data loading…</div>
                      : holders.map((h,i) => (
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--bd)', fontSize:12 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <span style={{ color:'var(--t3)', minWidth:20, fontFamily:'var(--mono)' }}>#{i+1}</span>
                              <span style={{ color: h.addr?.toLowerCase()===curveAddr?.toLowerCase() ? 'var(--cyan)' : 'var(--t2)', fontFamily:'var(--mono)' }}>
                                {h.addr?.toLowerCase()===curveAddr?.toLowerCase() ? '🔒 Curve' : fmtAddr(h.addr)}
                              </span>
                            </div>
                            <span style={{ color:'var(--t1)', fontFamily:'var(--mono)', fontWeight:600 }}>{(Number(h.balance)/1e18).toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                          </div>
                        ))
                    }
                  </div>
                )}
              </div>
            </div>

            {/* ════ RIGHT COLUMN — trade panel + info ════ */}
            <div style={{ width:320, flexShrink:0, position:'sticky', top:56, maxHeight:'calc(100vh - 56px)', overflowY:'auto' }}>

              {/* BUY / SELL TOGGLE */}
              <div style={{ padding:'12px 14px 0' }}>
                <div style={{ display:'flex', background:'var(--bg3)', borderRadius:10, padding:3, marginBottom:12 }}>
                  {['buy','sell'].map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      style={{ flex:1, padding:'9px 0', borderRadius:8, border:'none', fontWeight:800, fontSize:14, cursor:'pointer', transition:'all .15s',
                        background: mode===m ? (m==='buy'?'var(--p)':'var(--r)') : 'transparent',
                        color: mode===m ? 'white' : 'var(--t3)' }}>
                      {m.charAt(0).toUpperCase()+m.slice(1)}
                    </button>
                  ))}
                </div>

                {/* balance */}
                {mode==='sell' && tokenBalance > 0n && (
                  <div style={{ fontSize:12, color:'var(--t3)', marginBottom:8, display:'flex', justifyContent:'space-between' }}>
                    <span>Balance</span>
                    <span style={{ color:'var(--t2)', fontWeight:600 }}>{(Number(tokenBalance)/1e18).toLocaleString(undefined,{maximumFractionDigits:0})} {dSym}</span>
                  </div>
                )}

                {/* amount input */}
                {!customAmt && (
                <div style={{ position:'relative', marginBottom:8 }}>
                  <input type="number" placeholder={`0.0 ${mode==='buy'?'MON':dSym}`} value={amt} onChange={e => setAmt(e.target.value)}
                    style={{ width:'100%', padding:'14px 60px 14px 14px', fontSize:20, fontWeight:800, fontFamily:'var(--mono)',
                      background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:10, color:'var(--t1)', outline:'none', boxSizing:'border-box' }} />
                  <button onClick={() => { mode==='sell' ? setAmt((Number(tokenBalance)/1e18).toFixed(0)) : setAmt('') }}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'rgba(110,84,255,0.15)', color:'var(--p2)', fontSize:10, fontWeight:700, padding:'4px 8px', borderRadius:5, border:'none', cursor:'pointer' }}>
                    {mode==='sell'?'MAX':'CLR'}
                  </button>
                </div>
                )}

                {/* quick buttons */}
                <div style={{ display:'flex', gap:5, marginBottom:customAmt?4:12, flexWrap:'wrap' }}>
                  {mode==='buy'
                    ? ['100','500','1000','2000'].map(n => (
                        <button key={n} onClick={() => { setAmt(n); setCustomAmt(false) }}
                          style={{ flex:1, padding:'8px 0', textAlign:'center', background: amt===n?'rgba(110,84,255,0.25)':'rgba(110,84,255,0.08)', border: amt===n?'1px solid var(--p)':'1px solid rgba(110,84,255,0.15)', borderRadius:7, fontSize:12, fontWeight:700, color:'var(--p2)', cursor:'pointer' }}>
                          {n}
                        </button>
                      ))
                    : ['25%','50%','75%','100%'].map(pct => (
                        <button key={pct} onClick={() => { setAmt((Number(tokenBalance)/1e18*(parseInt(pct)/100)).toFixed(0)); setCustomAmt(false) }}
                          style={{ flex:1, padding:'8px 0', textAlign:'center', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.15)', borderRadius:7, fontSize:12, fontWeight:700, color:'var(--r)', cursor:'pointer' }}>
                          {pct}
                        </button>
                      ))
                  }
                  <button onClick={() => { setCustomAmt(true); setAmt(''); setTimeout(()=>customInputRef.current?.focus(),50) }}
                    style={{ flex:1, padding:'8px 0', textAlign:'center', background: customAmt?'rgba(133,230,255,0.15)':'rgba(133,230,255,0.06)', border: customAmt?'1px solid var(--cyan)':'1px solid rgba(133,230,255,0.15)', borderRadius:7, fontSize:12, fontWeight:700, color:'var(--cyan)', cursor:'pointer' }}>
                    Custom
                  </button>
                </div>
                {customAmt && (
                  <div style={{ position:'relative', marginBottom:12 }}>
                    <input ref={customInputRef} type="number" placeholder={`Enter amount (${mode==='buy'?'MON':dSym})`} value={amt} onChange={e => setAmt(e.target.value)}
                      style={{ width:'100%', padding:'10px 50px 10px 12px', fontSize:15, fontWeight:700, fontFamily:'var(--mono)',
                        background:'rgba(133,230,255,0.06)', border:'1px solid var(--cyan)', borderRadius:8, color:'var(--t1)', outline:'none', boxSizing:'border-box' }} />
                    <button onClick={() => setCustomAmt(false)}
                      style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'var(--t3)', fontSize:16, cursor:'pointer', lineHeight:1 }}>✕</button>
                  </div>
                )}

                {/* estimate */}
                <div style={{ background:'var(--bg2)', border:'1px solid var(--bd)', borderRadius:10, padding:'10px 12px', marginBottom:12 }}>
                  {[
                    ['You receive', mode==='buy' ? `${tokensEst} ${dSym}` : `${((parseFloat(amt)||0)*priceNum*0.97).toFixed(6)} MON`],
                    ['Platform fee (1%)', `${((parseFloat(amt)||0)*(mode==='buy'?0.01:priceNum*0.01)).toFixed(mode==='buy'?4:6)} MON`],
                    ['Dev fee (0.5%)',    `${((parseFloat(amt)||0)*(mode==='buy'?0.005:priceNum*0.005)).toFixed(mode==='buy'?4:6)} MON`],
                  ].map(([l,v]) => (
                    <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                      <span style={{ color:'var(--t3)' }}>{l}</span>
                      <span style={{ fontFamily:'var(--mono)', fontWeight:600, color:'var(--t2)' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ height:1, background:'var(--bd)', margin:'6px 0' }} />
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
                    <span style={{ color:'var(--t3)' }}>Total</span>
                    <span style={{ fontWeight:800, fontFamily:'var(--mono)' }}>{amt||'0'} {mode==='buy'?'MON':dSym}</span>
                  </div>
                </div>

                {/* tx error toast */}
                {txErrMsg && (
                  <div style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:13, color:'var(--r)', fontWeight:600 }}>
                    ❌ {txErrMsg}
                  </div>
                )}

                {/* warnings */}
                {info.delisted && (
                  <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:'9px 12px', marginBottom:8, fontSize:12, color:'var(--r)', fontWeight:600 }}>
                    ⚠️ Token delisted — trading disabled
                  </div>
                )}
                {!info.delisted && info.pauseSells && mode==='sell' && (
                  <div style={{ background:'rgba(255,174,69,0.1)', border:'1px solid rgba(255,174,69,0.25)', borderRadius:8, padding:'9px 12px', marginBottom:8, fontSize:12, color:'#FFAE45', fontWeight:600 }}>
                    ⚠️ Sells currently paused
                  </div>
                )}
                {!info.delisted && info.pauseBuys && mode==='buy' && (
                  <div style={{ background:'rgba(255,174,69,0.1)', border:'1px solid rgba(255,174,69,0.25)', borderRadius:8, padding:'9px 12px', marginBottom:8, fontSize:12, color:'#FFAE45', fontWeight:600 }}>
                    ⚠️ Buys currently paused
                  </div>
                )}

                {/* action button */}
                <button
                  style={{ width:'100%', padding:15, borderRadius:10, border:'none', fontWeight:800, fontSize:16, cursor:'pointer', marginBottom:6,
                    background: mode==='buy' ? 'var(--p)' : 'var(--r)',
                    color: 'white',
                    opacity: (info.delisted||(info.pauseSells&&mode==='sell')||(info.pauseBuys&&mode==='buy')) ? 0.4 : 1 }}
                  onClick={mode==='buy' ? handleBuy : handleSell}
                  disabled={isPending||isConfirming||sellStep!=='idle'||!!info.delisted||(!!info.pauseSells&&mode==='sell')||(!!info.pauseBuys&&mode==='buy')}>
                  {sellStep==='approving' ? '1/2 Approve tokens…'
                    : sellStep==='selling' ? '2/2 Confirm sell…'
                    : isPending ? 'Confirm in wallet…'
                    : isConfirming ? 'Confirming tx…'
                    : userAddr ? `${mode==='buy'?'Buy':'Sell'} ${dSym}` : 'Connect Wallet'}
                </button>
              </div>

              {/* DIVIDER */}
              <div style={{ height:1, background:'var(--bd)', margin:'14px 0 0' }} />

              {/* CREATOR REWARDS */}
              <div style={{ padding:'14px' }}>
                <div style={{ fontSize:12, fontWeight:800, color:'var(--t3)', letterSpacing:'.5px', marginBottom:10, textTransform:'uppercase' }}>Creator Rewards</div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'white', flexShrink:0 }}>
                    {(info.creator||'?').slice(2,4).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, fontFamily:'var(--mono)' }}>{fmtAddr(info.creator)}</div>
                    <div style={{ fontSize:11, color:'var(--g)' }}>● {fmtMON(BigInt(Math.floor(chartStats.devFees*1e18)))} MON earned</div>
                  </div>
                </div>
              </div>

              <div style={{ height:1, background:'var(--bd)' }} />

              {/* BONDING CURVE PROGRESS */}
              <div style={{ padding:'14px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'var(--t3)', letterSpacing:'.5px', textTransform:'uppercase' }}>Bonding Curve</div>
                  <div style={{ fontSize:13, fontWeight:800, color:'var(--p2)' }}>{Math.min(pct,100).toFixed(1)}%</div>
                </div>
                <div style={{ height:8, background:'var(--bg3)', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                  <div style={{ height:'100%', background:'linear-gradient(90deg,var(--p),var(--cyan))', borderRadius:999, width:`${Math.min(pct,100)}%`, transition:'width .5s' }} />
                </div>
                <div style={{ fontSize:11, color:'var(--t3)' }}>
                  {info.graduated
                    ? '🎓 Coin has graduated! LP burned on Uniswap V3'
                    : `${fmtMON(info.monRaisedNet)} / ${fmtMON(info.capMon)} MON → Uniswap V3`}
                </div>
              </div>

              <div style={{ height:1, background:'var(--bd)' }} />

              {/* MC + VOLUME STATS */}
              <div style={{ padding:'14px' }}>
                <div style={{ fontSize:12, fontWeight:800, color:'var(--t3)', letterSpacing:'.5px', marginBottom:10, textTransform:'uppercase' }}>Stats</div>
                {[
                  ['Market Cap', fmtUSD((info.priceWei||0n)*1_000_000_000n, monPrice)],
                  ['Total Volume', fmtMON(BigInt(Math.floor(chartStats.totalVol*1e18))) + ' MON'],
                  ['Dev Fees', fmtMON(BigInt(Math.floor(chartStats.devFees*1e18))) + ' MON'],
                  ['MON Raised', fmtMON(info.monRaisedNet) + ' MON'],
                ].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:8 }}>
                    <span style={{ color:'var(--t3)' }}>{l}</span>
                    <span style={{ fontWeight:700, color:'var(--t1)', fontFamily:'var(--mono)' }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ height:1, background:'var(--bd)' }} />

              {/* CREATOR IMAGE UPDATE (only visible to creator) */}
              {isCreator && (
                <div style={{ padding:'14px' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'var(--t3)', letterSpacing:'.5px', marginBottom:10, textTransform:'uppercase' }}>👑 Update Images</div>
                  <div style={{ display:'flex', gap:8 }}>
                    <label style={{ flex:1, cursor:'pointer', fontSize:12, padding:'8px 0', background:'var(--bg3)', border:'1px solid var(--bd2)', borderRadius:8, color:'var(--t2)', textAlign:'center' }}>
                      📷 PFP
                      <input type="file" accept="image/*" style={{ display:'none' }} onChange={async e => {
                        const f = e.target.files?.[0]; if (!f) return
                        const fd = new FormData(); fd.append('file',f); fd.append('address',tokenAddr)
                        await fetch(`${SERVER}/api/upload/pfp`, { method:'POST', body:fd })
                        const r = await fetch(`${SERVER}/api/token/meta/${tokenAddr}`); const d = await r.json(); setMeta(d)
                      }} />
                    </label>
                    <label style={{ flex:1, cursor:'pointer', fontSize:12, padding:'8px 0', background:'var(--bg3)', border:'1px solid var(--bd2)', borderRadius:8, color:'var(--t2)', textAlign:'center' }}>
                      🖼 Banner
                      <input type="file" accept="image/*" style={{ display:'none' }} onChange={async e => {
                        const f = e.target.files?.[0]; if (!f) return
                        const fd = new FormData(); fd.append('file',f); fd.append('address',tokenAddr)
                        await fetch(`${SERVER}/api/upload/banner`, { method:'POST', body:fd })
                        const r = await fetch(`${SERVER}/api/token/meta/${tokenAddr}`); const d = await r.json(); setMeta(d)
                      }} />
                    </label>
                  </div>
                </div>
              )}

            </div>
          </div>

        </div>
      </Layout>
    </>
  )
}

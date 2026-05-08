import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import Layout from '../../components/Layout'
import { CURVE_ABI, TOKEN_ABI, FACTORY_ADDRESS, FACTORY_ABI, GRADUATION_TARGET, MAX_SUPPLY, fmtMON, fmtUSD, fmtAddr, fmtTokens, timeAgo, MONADSCAN, POOL_FACTORY_V2, BUYBACK_WALLET } from '../../lib/constants'
import { monad } from '../../lib/wagmi'

// Curve x*y=k math, kept in sync with MonPadCurveV2.sol:
//   currentMon    = vm + rm
//   currentTokens = vt - (1B*1e18 - rt)
//   buy:  monForBuy = monIn * (10000 - 200) / 10000  (2% buy fee total)
//         tokensOut = currentTokens - (currentMon * currentTokens) / (currentMon + monForBuy)
//   sell: tokensIn already in pool
//         grossMonOut = currentMon - (currentMon * currentTokens) / (currentTokens + tokensIn)
//         monOut      = grossMonOut * (10000 - 200) / 10000  (2% sell fee total)
function estimateBuyOut(monIn, vm, vt, rm, rt) {
  if (monIn === 0n) return 0n
  const currentMon = vm + rm
  const currentTokens = vt - (MAX_SUPPLY - rt)
  const monForBuy = (monIn * 9800n) / 10000n
  const newMon = currentMon + monForBuy
  if (newMon === 0n) return 0n
  const k = currentMon * currentTokens
  const newTokens = k / newMon
  return currentTokens > newTokens ? currentTokens - newTokens : 0n
}
function estimateSellOut(tokensIn, vm, vt, rm, rt) {
  if (tokensIn === 0n) return 0n
  const currentMon = vm + rm
  const currentTokens = vt - (MAX_SUPPLY - rt)
  const newTokens = currentTokens + tokensIn
  if (newTokens === 0n) return 0n
  const k = currentMon * currentTokens
  const newMon = k / newTokens
  const grossMonOut = currentMon > newMon ? currentMon - newMon : 0n
  return (grossMonOut * 9800n) / 10000n
}
// Apply user slippage to expected output. slippagePct is 1..20 (integer).
function withSlippage(expected, slippagePct) {
  const bps = BigInt(Math.max(0, Math.min(10000, Math.floor(slippagePct * 100))))
  return (expected * (10000n - bps)) / 10000n
}

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false })

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

function fixUrl(url) {
  if (!url) return null
  if (url.startsWith('http://138.68.248.211:3001')) return url.replace('http://138.68.248.211:3001', SERVER)
  return url
}

export default function TokenDetail() {
  const router = useRouter()
  const { address: tokenAddr } = router.query
  const { address: wallet, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: monad.id })

  const [data, setData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [trades, setTrades] = useState([])
  const [holders, setHolders] = useState([])
  const [candles, setCandles] = useState([])
  const [monPrice, setMonPrice] = useState(0)
  const [tab, setTab] = useState('chart')

  // Trade form
  const [tradeTab, setTradeTab] = useState('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(5)
  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Two-step sell coordination: when allowance is insufficient, the first click
  // approves; on approve confirm we automatically fire the sell. Without this, the
  // user had to click Sell twice (and the UX gave no indication of the two-step).
  const pendingSellRef = useRef(null) // { tokenAmt, minOut } | null

  useEffect(() => {
    if (!tokenAddr || !SERVER) return
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
    loadAll()
    const iv = setInterval(loadAll, 8000)
    return () => clearInterval(iv)
  }, [tokenAddr])

  // Reload on successful tx
  useEffect(() => {
    if (isSuccess) { loadAll(); setAmount('') }
  }, [isSuccess])

  // After approve confirms, automatically fire the queued sell.
  useEffect(() => {
    if (!isSuccess) return
    const pending = pendingSellRef.current
    if (!pending || !data?.curveAddress) return
    pendingSellRef.current = null
    writeContract({
      address: data.curveAddress,
      abi: CURVE_ABI,
      functionName: 'sell',
      args: [pending.tokenAmt, pending.minOut],
      chainId: monad.id,
    })
  }, [isSuccess, data?.curveAddress, writeContract])

  async function loadAll() {
    if (!tokenAddr || !SERVER) return
    try {
      const t = await fetch(`${SERVER}/api/token/${tokenAddr}`).then(r => r.json())
      if (t) {
        setData({
          ...t,
          monRaisedNet: BigInt(t.monRaisedNet || '0'),
          marketCap: BigInt(t.marketCap || '0'),
          bondedBps: BigInt(t.bondedBps || '0'),
          priceWeiPerToken: BigInt(t.priceWeiPerToken || '0'),
          totalCreatorFees: BigInt(t.totalCreatorFees || '0'),
          totalPlatformFees: BigInt(t.totalPlatformFees || '0'),
          totalStakingFees: BigInt(t.totalStakingFees || '0'),
        })
      }
      const m = await fetch(`${SERVER}/api/token/${tokenAddr}/meta`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (m) setMeta(m)
      const tr = await fetch(`${SERVER}/api/token/${tokenAddr}/trades?limit=50`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (tr && Array.isArray(tr)) setTrades(tr)
      const h = await fetch(`${SERVER}/api/token/${tokenAddr}/holders?limit=50`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (h && Array.isArray(h)) setHolders(h)
      const c = await fetch(`${SERVER}/api/token/${tokenAddr}/candles?interval=5m&limit=200`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (c && Array.isArray(c)) setCandles(c)
    } catch (e) { console.warn(e) }
  }

  // Read live curve reserves to compute slippage-adjusted minOut.
  async function getReserves() {
    if (!data?.curveAddress || !publicClient) throw new Error('no client')
    const r = await publicClient.readContract({
      address: data.curveAddress,
      abi: CURVE_ABI,
      functionName: 'getReserves',
    })
    return { vm: BigInt(r[0]), vt: BigInt(r[1]), rm: BigInt(r[2]), rt: BigInt(r[3]) }
  }

  async function executeBuy() {
    if (!data || !amount || parseFloat(amount) <= 0) return
    const value = parseEther(amount.toString())
    let minOut = 0n
    try {
      const { vm, vt, rm, rt } = await getReserves()
      const expected = estimateBuyOut(value, vm, vt, rm, rt)
      minOut = withSlippage(expected, slippage)
    } catch (e) {
      console.warn('reserve read failed; falling back to 0n minOut (NO slippage protection)', e)
    }
    writeContract({
      address: data.curveAddress,
      abi: CURVE_ABI,
      functionName: 'buy',
      args: [minOut],
      value,
      chainId: monad.id,
    })
  }

  async function executeSell() {
    if (!data || !amount || parseFloat(amount) <= 0) return
    const tokenAmt = parseEther(amount.toString())
    let minOut = 0n
    try {
      const { vm, vt, rm, rt } = await getReserves()
      const expected = estimateSellOut(tokenAmt, vm, vt, rm, rt)
      minOut = withSlippage(expected, slippage)
    } catch (e) {
      console.warn('reserve read failed; falling back to 0n minMonOut (NO slippage protection)', e)
    }

    try {
      const allowance = await publicClient.readContract({
        address: tokenAddr,
        abi: TOKEN_ABI,
        functionName: 'allowance',
        args: [wallet, data.curveAddress],
      })
      if (BigInt(allowance) < tokenAmt) {
        // Queue the sell; the useEffect on isSuccess will auto-fire it once the
        // approve confirms. User clicks Sell once, confirms two wallet popups.
        pendingSellRef.current = { tokenAmt, minOut }
        writeContract({
          address: tokenAddr,
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [data.curveAddress, BigInt(2) ** BigInt(256) - BigInt(1)],
          chainId: monad.id,
        })
        return
      }
      writeContract({
        address: data.curveAddress,
        abi: CURVE_ABI,
        functionName: 'sell',
        args: [tokenAmt, minOut],
        chainId: monad.id,
      })
    } catch (e) { console.error(e) }
  }

  if (!data) {
    return <Layout showBack><div className="container" style={{padding:40, textAlign:'center'}}><div className="dots text-t3">Loading token</div></div></Layout>
  }

  const pct = Number(data.bondedBps) / 100
  const banner = fixUrl(meta?.bannerUrl)
  const pfp = fixUrl(meta?.pfpUrl)

  return (
    <Layout showBack title={data.name}>
      <div className="container" style={{paddingBottom:40}}>
        {/* HEADER STRIP */}
        <div className="card" style={{padding:0, overflow:'hidden', marginBottom:16, position:'relative'}}>
          {banner ? <img src={banner} alt="" style={{width:'100%', height:140, objectFit:'cover', display:'block'}} /> : <div style={{height:80, background:'linear-gradient(135deg, var(--p), var(--p-deep))'}} />}
          <div style={{padding:'16px 18px', display:'flex', alignItems:'center', gap:14, marginTop: banner ? -40 : 0, position:'relative'}}>
            <div style={{width:72, height:72, borderRadius:'var(--r-lg)', background:'var(--bg-card)', border:'2px solid var(--bd-glow)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:28, fontWeight:900, color:'var(--p2)'}}>
              {pfp ? <img src={pfp} alt="" style={{width:'100%', height:'100%', objectFit:'cover'}} /> : (data.symbol || '?').slice(0,2)}
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div className="flex items-center gap-2 mb-1" style={{flexWrap:'wrap'}}>
                <h1 className="text-xl font-black" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{data.name}</h1>
                <span className="font-mono text-sm text-t3">${data.symbol}</span>
                {data.graduated && <span className="tag tag-gold">🎓 GRADUATED</span>}
              </div>
              <div className="flex gap-3 text-xs text-t3" style={{flexWrap:'wrap'}}>
                <a href={`${MONADSCAN}/address/${tokenAddr}`} target="_blank" rel="noreferrer" className="font-mono">{fmtAddr(tokenAddr)} ↗</a>
                {data.creator && <span>by <span className="font-mono">{fmtAddr(data.creator)}</span></span>}
                {meta?.twitter && <a href={meta.twitter} target="_blank" rel="noreferrer">𝕏</a>}
                {meta?.telegram && <a href={meta.telegram} target="_blank" rel="noreferrer">TG</a>}
                {meta?.website && <a href={meta.website} target="_blank" rel="noreferrer">🌐</a>}
              </div>
            </div>
          </div>
        </div>

        {/* STATS BAR */}
        <div className="card mb-4" style={{padding:14}}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:14}}>
            <div className="stat"><div className="stat-val">{fmtUSD(data.marketCap || data.monRaisedNet, monPrice)}</div><div className="stat-label">Market Cap</div></div>
            <div className="stat"><div className="stat-val cyan">{fmtMON(data.priceWeiPerToken)}</div><div className="stat-label">Price (MON)</div></div>
            <div className="stat"><div className="stat-val purple">{fmtMON(data.monRaisedNet)} / 425K</div><div className="stat-label">MON Raised</div></div>
            <div className="stat"><div className="stat-val gold">{fmtMON(data.totalCreatorFees)}</div><div className="stat-label">Dev Fees Collected</div></div>
            <div className="stat"><div className="stat-val green">{(data.holderCount || holders.length) || '—'}</div><div className="stat-label">Holders</div></div>
            <div className="stat"><div className="stat-val">{data.launchedAt ? timeAgo(data.launchedAt) : '—'}</div><div className="stat-label">Age</div></div>
          </div>

          {/* Graduation milestone bar (V2.1 UI beefup) */}
          <GraduationMilestoneBar pct={pct} monRaised={data.monRaisedNet} target={GRADUATION_TARGET} />

          {/* Buy/Sell pressure for last 24h */}
          <BuyPressure trades={trades} />
        </div>

        {/* MAIN GRID — Chart + Terminal */}
        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:16, marginBottom:16}}>
          <div className="card" style={{padding:0, overflow:'hidden'}}>
            <div className="flex" style={{borderBottom:'1px solid var(--bd)'}}>
              <button onClick={() => setTab('chart')} className={`flex-1 ${tab === 'chart' ? 'text-t1' : 'text-t3'}`} style={{padding:'12px', fontWeight:700, fontSize:13, borderBottom: tab==='chart' ? '2px solid var(--p)' : '2px solid transparent'}}>📊 Chart</button>
              <button onClick={() => setTab('trades')} className={`flex-1 ${tab === 'trades' ? 'text-t1' : 'text-t3'}`} style={{padding:'12px', fontWeight:700, fontSize:13, borderBottom: tab==='trades' ? '2px solid var(--p)' : '2px solid transparent'}}>💱 Trades ({trades.length})</button>
              <button onClick={() => setTab('holders')} className={`flex-1 ${tab === 'holders' ? 'text-t1' : 'text-t3'}`} style={{padding:'12px', fontWeight:700, fontSize:13, borderBottom: tab==='holders' ? '2px solid var(--p)' : '2px solid transparent'}}>👥 Holders ({holders.length})</button>
            </div>

            {tab === 'chart' && <PriceChart candles={candles} monPrice={monPrice} />}
            {tab === 'trades' && <TradesList trades={trades} monPrice={monPrice} />}
            {tab === 'holders' && <HoldersList holders={holders} totalSupply={data.totalSupply} />}
          </div>

          {/* Trade Terminal */}
          <div className="terminal">
            {data.graduated ? (
              <div className="text-center" style={{padding:'30px 0'}}>
                <div style={{fontSize:36, marginBottom:8}}>🎓</div>
                <div className="font-bold text-lg mb-2">Graduated to LP</div>
                <p className="text-t3 text-sm mb-4">This token has graduated. Trade it on the open market.</p>
                <a href={`https://monadex.exchange/swap?outputCurrency=${tokenAddr}`} target="_blank" rel="noreferrer" className="btn btn-primary">Trade on DEX →</a>
              </div>
            ) : (
              <>
                <div className="terminal-tabs">
                  <button className={`terminal-tab buy ${tradeTab === 'buy' ? 'active' : ''}`} onClick={() => setTradeTab('buy')}>BUY</button>
                  <button className={`terminal-tab sell ${tradeTab === 'sell' ? 'active' : ''}`} onClick={() => setTradeTab('sell')}>SELL</button>
                </div>

                <label className="input-label">{tradeTab === 'buy' ? 'Amount (MON)' : `Tokens to sell ($${data.symbol})`}</label>
                <input className="input" type="number" placeholder="0.0" value={amount} onChange={e => setAmount(e.target.value)} />

                {tradeTab === 'buy' && (
                  <div className="flex gap-2 mt-2">
                    {['0.5', '1', '5', '10'].map(v => (
                      <button key={v} className="btn btn-ghost btn-sm" style={{flex:1}} onClick={() => setAmount(v)}>{v}</button>
                    ))}
                  </div>
                )}

                <div className="text-xs text-t3 mt-3">Slippage: {slippage}%</div>
                <input type="range" min="1" max="20" value={slippage} onChange={e => setSlippage(parseInt(e.target.value))} style={{marginTop:6, marginBottom:14}} />

                {!isConnected ? (
                  <div className="text-center text-t3 text-sm mb-3">Connect wallet to trade</div>
                ) : tradeTab === 'buy' ? (
                  <button className="btn btn-green btn-block" disabled={isPending || isConfirming || !amount} onClick={executeBuy}>
                    {isPending ? '✍️ Confirm in wallet' : isConfirming ? '⏳ Buying...' : `🟢 Buy with ${amount || '0'} MON`}
                  </button>
                ) : (
                  <button className="btn btn-red btn-block" disabled={isPending || isConfirming || !amount} onClick={executeSell}>
                    {isPending ? '✍️ Confirm in wallet' : isConfirming ? '⏳ Selling...' : `🔴 Sell ${amount || '0'} ${data.symbol}`}
                  </button>
                )}

                {/* Fee breakdown */}
                <div className="mt-4 p-3 rounded" style={{background:'rgba(0,0,0,0.3)', fontSize:11}}>
                  <div className="text-t3 mb-2 font-bold" style={{letterSpacing:1, textTransform:'uppercase'}}>{tradeTab === 'buy' ? 'Buy fees (2%)' : 'Sell fees (2%)'}</div>
                  {tradeTab === 'buy' ? (
                    <>
                      <div className="flex justify-between text-t2"><span>1% to creator</span><span className="font-mono">{amount ? (parseFloat(amount) * 0.01).toFixed(4) : '0'} MON</span></div>
                      <div className="flex justify-between text-t2"><span>1% buffer (paid at grad)</span><span className="font-mono">{amount ? (parseFloat(amount) * 0.01).toFixed(4) : '0'} MON</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-t2"><span>0.5% to creator</span></div>
                      <div className="flex justify-between text-t2"><span>0.5% to staking pool</span></div>
                      <div className="flex justify-between text-t2"><span>1% to platform</span></div>
                    </>
                  )}
                </div>

                {isSuccess && <div className="card mt-3" style={{background:'rgba(74,222,128,0.08)', borderColor:'rgba(74,222,128,0.3)', color:'var(--green)', padding:10}}>✅ Trade successful!</div>}
              </>
            )}
          </div>
        </div>

        {/* DEV FEES BREAKDOWN CARD */}
        <div className="card mb-4">
          <div className="flex justify-between items-center mb-3">
            <div className="font-bold text-base">💸 Fees Distributed</div>
            <span className="text-t3 text-xs font-mono">on-chain</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12}}>
            <div className="p-3 rounded" style={{background:'rgba(168,85,247,0.06)', border:'1px solid var(--bd)'}}>
              <div className="text-xs text-t3 mb-1">Creator earned</div>
              <div className="font-mono font-bold text-purple text-lg">{fmtMON(data.totalCreatorFees)} MON</div>
            </div>
            <div className="p-3 rounded" style={{background:'rgba(34,211,238,0.06)', border:'1px solid var(--bd)'}}>
              <div className="text-xs text-t3 mb-1">Platform earned</div>
              <div className="font-mono font-bold text-cyan text-lg">{fmtMON(data.totalPlatformFees)} MON</div>
            </div>
            <div className="p-3 rounded" style={{background:'rgba(74,222,128,0.06)', border:'1px solid var(--bd)'}}>
              <div className="text-xs text-t3 mb-1">Staking/buyback</div>
              <div className="font-mono font-bold text-green text-lg">{fmtMON(data.totalStakingFees)} MON</div>
            </div>
          </div>
        </div>

        {/* TOP TRADERS + LIVE ACTIVITY (V2.1 UI beefup) */}
        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:16, marginBottom:16}}>
          <div className="card">
            <div className="font-bold text-base mb-3">🔥 Top Traders</div>
            <TopTradersList trades={trades} />
          </div>
          <div className="card">
            <div className="font-bold text-base mb-3">📡 Live Activity</div>
            <ActivityTicker trades={trades} />
          </div>
        </div>

        {/* STAKING WIDGET */}
        <StakingWidget tokenAddr={tokenAddr} symbol={data.symbol} />

        {/* DESCRIPTION */}
        {meta?.desc && (
          <div className="card mb-4">
            <div className="font-bold text-base mb-2">About</div>
            <p className="text-t2 text-sm" style={{lineHeight:1.6}}>{meta.desc}</p>
          </div>
        )}
      </div>
    </Layout>
  )
}

function PriceChart({ candles, monPrice }) {
  if (!candles || candles.length === 0) {
    return <div style={{height:320, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', fontSize:13}} className="dots">Waiting for trades</div>
  }

  const series = [{
    data: candles.map(c => ({
      x: new Date(c.timestamp * 1000),
      y: [c.open, c.high, c.low, c.close]
    }))
  }]

  const options = {
    chart: { type: 'candlestick', background: 'transparent', toolbar: { show: false }, animations: { enabled: false } },
    theme: { mode: 'dark' },
    plotOptions: { candlestick: { colors: { upward: '#4ADE80', downward: '#F87171' } } },
    xaxis: { type: 'datetime', labels: { style: { colors: '#71717A' } } },
    yaxis: { labels: { style: { colors: '#71717A' }, formatter: (v) => v.toFixed(8) }, tooltip: { enabled: true } },
    grid: { borderColor: 'rgba(168,85,247,0.1)' },
    tooltip: { theme: 'dark' }
  }

  return (
    <div style={{padding:'12px'}}>
      <Chart options={options} series={series} type="candlestick" height={340} />
    </div>
  )
}

function TradesList({ trades, monPrice }) {
  if (!trades.length) return <div style={{padding:30, textAlign:'center', color:'var(--t3)', fontSize:13}}>No trades yet — be the first 🎯</div>
  return (
    <div style={{maxHeight:340, overflowY:'auto'}}>
      <table style={{width:'100%', fontSize:12}}>
        <thead style={{position:'sticky', top:0, background:'var(--bg-card)', backdropFilter:'blur(8px)'}}>
          <tr style={{borderBottom:'1px solid var(--bd)'}}>
            <th style={{textAlign:'left', padding:'10px 14px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Type</th>
            <th style={{textAlign:'right', padding:'10px 14px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>MON</th>
            <th style={{textAlign:'right', padding:'10px 14px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Tokens</th>
            <th style={{textAlign:'left', padding:'10px 14px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Trader</th>
            <th style={{textAlign:'right', padding:'10px 14px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <td style={{padding:'10px 14px'}}><span className={t.type === 'buy' ? 'tag-green' : 'tag'} style={{fontSize:10, padding:'2px 6px', borderRadius:4, background: t.type === 'buy' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: t.type === 'buy' ? 'var(--green)' : 'var(--red)', fontWeight:700}}>{(t.type || 'BUY').toUpperCase()}</span></td>
              <td style={{padding:'10px 14px', textAlign:'right', fontFamily:'var(--mono)'}}>{fmtMON(t.monAmount || t.value || '0')}</td>
              <td style={{padding:'10px 14px', textAlign:'right', fontFamily:'var(--mono)', color:'var(--t3)'}}>{fmtTokens(t.tokenAmount || '0')}</td>
              <td style={{padding:'10px 14px', fontFamily:'var(--mono)', fontSize:11, color:'var(--t2)'}}>{fmtAddr(t.who || t.user || '')}</td>
              <td style={{padding:'10px 14px', textAlign:'right', color:'var(--t4)', fontSize:11}}>{t.timestamp ? timeAgo(t.timestamp) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HoldersList({ holders, totalSupply }) {
  if (!holders.length) return <div style={{padding:30, textAlign:'center', color:'var(--t3)', fontSize:13}}>Loading holders…</div>
  const supply = Number(totalSupply) || 1e27
  return (
    <div style={{maxHeight:340, overflowY:'auto', padding:14}}>
      {holders.map((h, i) => {
        const pct = (Number(h.balance) / supply) * 100
        return (
          <div key={i} className="flex justify-between items-center" style={{padding:'10px 0', borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
            <div className="flex items-center gap-3" style={{flex:1, minWidth:0}}>
              <span className="text-t4 font-mono text-xs" style={{width:28}}>#{i+1}</span>
              <span className="font-mono text-sm" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{fmtAddr(h.address)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{fmtTokens(h.balance)}</span>
              <span className="font-mono text-xs text-purple" style={{minWidth:48, textAlign:'right'}}>{pct.toFixed(2)}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StakingWidget({ tokenAddr, symbol }) {
  return (
    <div className="card mb-4" style={{background:'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(34,211,238,0.04))', borderColor:'var(--bd2)'}}>
      <div className="flex justify-between items-center" style={{flexWrap:'wrap', gap:10}}>
        <div>
          <div className="font-bold text-base mb-1">🥩 Stake ${symbol}</div>
          <div className="text-t3 text-xs">Earn MON rewards from sell-tax. 4 lock tiers up to 4x boost.</div>
        </div>
        <a href={`/stake/${tokenAddr}`} className="btn btn-primary">Stake →</a>
      </div>
    </div>
  )
}

// ── V2.1 UI BEEFUP: graduation milestones, buy pressure, activity, top traders ──

const GRAD_MILESTONES = [
  { pct: 0,   emoji: '🌱' },
  { pct: 25,  emoji: '🚀' },
  { pct: 50,  emoji: '🔥' },
  { pct: 75,  emoji: '⚡' },
  { pct: 100, emoji: '🎓' },
]

function GraduationMilestoneBar({ pct, monRaised, target }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs mb-2">
        <span className="text-t3">{clamped.toFixed(2)}% to graduation</span>
        <span className="font-mono text-t2">{fmtMON(monRaised)} / {fmtMON(target)} MON</span>
      </div>
      <div className="gradbar">
        {GRAD_MILESTONES.map(m => (
          <div key={m.pct}
            className={`gradbar-milestone ${clamped >= m.pct ? 'reached' : ''}`}
            style={{ left: `${m.pct}%` }}>
            <span>{m.emoji}</span>
            <span className="gradbar-milestone-pct">{m.pct === 100 ? 'GRAD' : `${m.pct}%`}</span>
          </div>
        ))}
        <div className="gradbar-track">
          <div className="gradbar-fill" style={{ width: `${clamped}%` }} />
        </div>
      </div>
    </div>
  )
}

function BuyPressure({ trades }) {
  // Last 24h buy vs sell volume share. Falls back to all-time if no recent activity.
  if (!trades || trades.length === 0) return null
  const now = Date.now() / 1000
  const day = 86400
  const recent = trades.filter(t => (Number(t.timestamp || t.ts) || 0) > now - day)
  const window = recent.length > 0 ? recent : trades
  let buyVol = 0, sellVol = 0
  for (const t of window) {
    const monAmt = Number(t.monAmount || t.value || 0) / 1e18 // wei → MON
    if (t.type === 'buy') buyVol += monAmt
    else if (t.type === 'sell') sellVol += monAmt
  }
  const total = buyVol + sellVol
  if (total === 0) return null
  const buyPct = (buyVol / total) * 100
  const sellPct = 100 - buyPct
  return (
    <div className="pressure">
      <span className="pressure-label-buy">{buyPct.toFixed(0)}% Buys</span>
      <div className="pressure-bar">
        <div className="pressure-buy" style={{ width: `${buyPct}%` }} />
        <div className="pressure-sell" style={{ width: `${sellPct}%` }} />
      </div>
      <span className="pressure-label-sell">Sells {sellPct.toFixed(0)}%</span>
    </div>
  )
}

function ActivityTicker({ trades }) {
  if (!trades || trades.length === 0) {
    return <div className="text-center text-t3 text-sm" style={{padding:20}}>No trades yet</div>
  }
  const recent = trades.slice(0, 10)
  return (
    <div className="ticker">
      {recent.map((t, i) => {
        const isBuy = t.type === 'buy'
        const mon = Number(t.monAmount || t.value || 0) / 1e18
        const ts = Number(t.timestamp || t.ts) || 0
        return (
          <div key={i} className={`ticker-row ${isBuy ? 'buy' : 'sell'}`}>
            <span className={`ticker-pill ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? 'B' : 'S'}</span>
            <span className="ticker-addr">{fmtAddr(t.who || t.user || t.addr || '')}</span>
            <span className="ticker-amt">{mon.toFixed(mon >= 1 ? 2 : 4)} MON</span>
            <span className="ticker-time">{ts ? timeAgo(ts) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

function TopTradersList({ trades }) {
  if (!trades || trades.length === 0) {
    return <div className="text-center text-t3 text-sm" style={{padding:20}}>No traders yet</div>
  }
  // Aggregate volume per wallet across all available trades
  const byWallet = new Map()
  for (const t of trades) {
    const w = (t.who || t.user || t.addr || '').toLowerCase()
    if (!w) continue
    const mon = Number(t.monAmount || t.value || 0) / 1e18
    byWallet.set(w, (byWallet.get(w) || 0) + mon)
  }
  const ranked = [...byWallet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (ranked.length === 0) return <div className="text-center text-t3 text-sm" style={{padding:20}}>No traders yet</div>
  const max = ranked[0][1] || 1
  return (
    <div className="toptraders">
      {ranked.map(([w, vol], i) => {
        const rankClass = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : 'rN'
        const pct = (vol / max) * 100
        return (
          <div key={w} className="toptrader">
            <span className={`toptrader-rank ${rankClass}`}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div className="font-mono" style={{ fontSize: 12 }}>{fmtAddr(w)}</div>
              <div className="toptrader-volbar">
                <div className="toptrader-volbar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="font-mono font-bold" style={{ fontSize: 12 }}>{vol.toFixed(2)} MON</div>
          </div>
        )
      })}
    </div>
  )
}

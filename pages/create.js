import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { decodeEventLog, parseEther, formatEther } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CREATION_FEE, MIN_DEV_BUY, MAX_SUPPLY, MAX_DEV_BUY_BPS } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

export default function Create() {
  const router = useRouter()
  const { query } = router
  const { address, isConnected } = useAccount()

  const [form, setForm] = useState({ name: '', symbol: '', desc: '', twitter: '', telegram: '', website: '' })
  const [banner, setBanner] = useState(null)
  const [bannerPreview, setBannerP] = useState(null)
  const [pfp, setPfp] = useState(null)
  const [pfpPreview, setPfpP] = useState(null)
  const [devBuyPct, setDevBuyPct] = useState(0)  // 0-2% slider
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [step, setStep] = useState('')

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash })
  const pendingMetaRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const referrer = query?.ref && query.ref.startsWith('0x') && query.ref.length === 42 ? query.ref : ZERO_ADDR

  // Calculate dev buy MON from % slider
  // We want: at slider X%, dev tries to buy enough MON to get X% of supply
  // Curve formula at start: virtualMonReserve=30, virtualTokenReserve=1.073B
  // Tokens out for monIn: tokensOut = currentTokens - (k / (currentMon + monIn))
  // Solve for monIn given desired tokensOut
  function calcDevBuyMon(pctOfSupply) {
    if (pctOfSupply <= 0) return 0n
    const targetTokens = (Number(MAX_SUPPLY) / 1e18) * (pctOfSupply / 100)
    const Vm = 30
    const Vt = 1_073_000_191
    // tokensOut = Vt - k/(Vm + monIn) -> monIn = (Vt*Vm)/(Vt - tokensOut) - Vm
    const monIn = (Vt * Vm) / (Vt - targetTokens) - Vm
    return BigInt(Math.ceil(monIn * 1e18))
  }

  const devBuyWei = calcDevBuyMon(devBuyPct)
  const totalCost = CREATION_FEE + devBuyWei
  const totalMON = Number(totalCost) / 1e18

  function handleBanner(e) {
    const f = e.target.files?.[0]; if (!f) return
    setBanner(f); const r = new FileReader(); r.onload = ev => setBannerP(ev.target.result); r.readAsDataURL(f)
  }
  function handlePfp(e) {
    const f = e.target.files?.[0]; if (!f) return
    setPfp(f); const r = new FileReader(); r.onload = ev => setPfpP(ev.target.result); r.readAsDataURL(f)
  }

  function validate() {
    if (!form.name.trim()) return 'Token name required'
    if (!form.symbol.trim()) return 'Ticker symbol required'
    if (form.symbol.length > 10) return 'Symbol max 10 chars'
    if (!isConnected) return 'Connect your wallet first'
    if (devBuyPct > MAX_DEV_BUY_BPS / 100) return `Max dev buy is ${MAX_DEV_BUY_BPS / 100}% of supply`
    return ''
  }

  async function handleCreate() {
    const err = validate(); if (err) { setError(err); return }
    setError('')
    let bannerUrl = null, pfpUrl = null
    if ((banner || pfp) && SERVER) {
      setStep('uploading'); setUploading(true)
      try {
        if (banner) { const fd = new FormData(); fd.append('banner', banner); const r = await fetch(SERVER + '/api/upload/banner', { method: 'POST', body: fd }); const d = await r.json(); bannerUrl = d.url }
        if (pfp) { const fd = new FormData(); fd.append('pfp', pfp); const r = await fetch(SERVER + '/api/upload/pfp', { method: 'POST', body: fd }); const d = await r.json(); pfpUrl = d.url }
      } catch (e) { console.warn('upload failed', e) }
      setUploading(false)
    }
    setStep('confirm')
    writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: 'createLaunch',
      args: [form.name.trim(), form.symbol.trim().toUpperCase(), referrer],
      value: totalCost,
      chainId: monad.id
    })
    pendingMetaRef.current = { bannerUrl, pfpUrl, name: form.name, symbol: form.symbol, desc: form.desc, twitter: form.twitter, telegram: form.telegram, website: form.website, creator: address }
  }

  useEffect(() => {
    if (!isSuccess || !receipt) return
    const meta = pendingMetaRef.current; if (!meta) return
    pendingMetaRef.current = null
    let tokenAddress = null
    try {
      for (const log of receipt.logs) {
        try {
          const d = decodeEventLog({ abi: FACTORY_ABI, data: log.data, topics: log.topics })
          if (d.eventName === 'Launched') { tokenAddress = d.args.token; break }
        } catch {}
      }
    } catch {}
    if (tokenAddress && SERVER) {
      fetch(SERVER + '/api/token/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...meta, tokenAddress }) }).catch(() => {})
    }
    setTimeout(() => router.push(tokenAddress ? '/token/' + tokenAddress : '/'), 1500)
  }, [isSuccess, receipt])

  useEffect(() => {
    if (writeError) {
      const msg = writeError?.shortMessage || writeError?.message || 'Transaction failed'
      if (!msg.toLowerCase().includes('user rejected') && !msg.includes('User denied')) setError(msg)
    }
  }, [writeError])

  const busy = uploading || isPending || isConfirming

  return (
    <Layout showBack title="Launch Token">
      <div className="container" style={{maxWidth:560, paddingBottom:60}}>
        {/* HERO */}
        <div className="hero" style={{padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <div style={{fontSize:36, marginBottom:8}}>🚀</div>
            <div className="text-xl font-black mb-2">Launch on MonPad</div>
            <p className="text-sm text-t2">Earn <strong style={{color:'var(--p2)'}}>2% of every trade</strong> — buys and sells, forever.</p>
            <div className="flex gap-6 justify-center mt-4 text-xs">
              <div><div className="font-mono font-bold text-base text-purple">100 MON</div><div className="text-t4">Launch fee</div></div>
              <div><div className="font-mono font-bold text-base text-cyan">1B</div><div className="text-t4">Total supply</div></div>
              <div><div className="font-mono font-bold text-base text-pink">425K</div><div className="text-t4">To grad</div></div>
            </div>
          </div>
        </div>

        {/* BANNER UPLOAD */}
        <div className="mb-4">
          <label className="input-label">Banner Image (optional)</label>
          <label style={{display:'block', cursor:'pointer'}}>
            <input type="file" accept="image/*" onChange={handleBanner} style={{display:'none'}} />
            <div style={{width:'100%', aspectRatio:'3/1', background:'var(--bg2)', border:`2px dashed ${bannerPreview ? 'var(--p)' : 'var(--bd2)'}`, borderRadius:'var(--r-lg)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s'}}>
              {bannerPreview ? <img src={bannerPreview} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : (
                <div className="text-center text-t3">
                  <div style={{fontSize:32, marginBottom:4}}>🖼️</div>
                  <div className="text-sm">Click to upload banner</div>
                  <div className="text-xs text-t4">PNG/JPG · ~3:1 ratio</div>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* PFP UPLOAD */}
        <div className="mb-4">
          <label className="input-label">Token Icon (optional)</label>
          <label style={{display:'flex', alignItems:'center', gap:14, cursor:'pointer'}}>
            <input type="file" accept="image/*" onChange={handlePfp} style={{display:'none'}} />
            <div style={{width:80, height:80, borderRadius:'var(--r-lg)', background:'var(--bg2)', border:`2px dashed ${pfpPreview ? 'var(--p)' : 'var(--bd2)'}`, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
              {pfpPreview ? <img src={pfpPreview} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : <div style={{fontSize:24}}>🪙</div>}
            </div>
            <div className="text-sm text-t3">{pfpPreview ? '✅ Uploaded — click to change' : 'Click to upload icon'}<div className="text-xs text-t4 mt-1">Square. Shown next to your token everywhere.</div></div>
          </label>
        </div>

        {/* FORM FIELDS */}
        <div className="mb-3"><label className="input-label">Token Name *</label><input className="input" placeholder="e.g. Moon Frog" value={form.name} onChange={e => set('name', e.target.value)} maxLength={50} /></div>
        <div className="mb-3"><label className="input-label">Ticker Symbol *</label><input className="input" placeholder="e.g. MFROG" value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} maxLength={10} /><div className="text-xs text-t4 mt-1">Max 10 chars · auto uppercase</div></div>
        <div className="mb-3"><label className="input-label">Description</label><textarea className="input" placeholder="What's this token about?" value={form.desc} onChange={e => set('desc', e.target.value)} rows={3} maxLength={280} /><div className="text-xs text-t4 mt-1 text-right">{form.desc.length}/280</div></div>
        <div className="mb-3"><label className="input-label">Twitter / X</label><input className="input" placeholder="https://x.com/yourtoken" value={form.twitter} onChange={e => set('twitter', e.target.value)} /></div>
        <div className="mb-3"><label className="input-label">Telegram</label><input className="input" placeholder="https://t.me/yourtoken" value={form.telegram} onChange={e => set('telegram', e.target.value)} /></div>
        <div className="mb-4"><label className="input-label">Website</label><input className="input" placeholder="https://yourtoken.xyz" value={form.website} onChange={e => set('website', e.target.value)} /></div>

        {/* DEV BUY SLIDER 0-2% */}
        <div className="card mb-4" style={{padding:18}}>
          <label className="input-label flex justify-between items-center">
            <span>Dev Buy <span className="text-t3 font-normal" style={{textTransform:'none', letterSpacing:0}}>(0-2% of supply, atomic at launch)</span></span>
            <span className="text-purple font-bold font-mono">{devBuyPct.toFixed(2)}%</span>
          </label>
          <input type="range" min="0" max="2" step="0.1" value={devBuyPct} onChange={e => setDevBuyPct(parseFloat(e.target.value))} />
          <div className="flex justify-between mt-3 text-xs text-t3">
            <span>0%</span>
            <span>0.5%</span>
            <span>1%</span>
            <span>1.5%</span>
            <span className="text-pink font-bold">2% MAX</span>
          </div>
          {devBuyPct > 0 && (
            <div className="flex justify-between items-center mt-3 p-3 rounded" style={{background:'rgba(168,85,247,0.05)', border:'1px solid var(--bd2)'}}>
              <span className="text-sm text-t2">Dev buy cost</span>
              <span className="font-mono font-bold text-purple">{Number(formatEther(devBuyWei)).toFixed(2)} MON</span>
            </div>
          )}
          <div className="text-xs text-t4 mt-2">Locked atomically with launch — no front-running possible. {devBuyPct > 0 ? `You'll get ~${(devBuyPct * 10_000_000).toLocaleString()} tokens.` : ''}</div>
        </div>

        {/* CREATOR EARNINGS */}
        <div className="card mb-4" style={{background:'rgba(168,85,247,0.06)', borderColor:'var(--bd2)'}}>
          <div className="font-bold text-purple mb-2 text-sm">💰 Your earnings as creator</div>
          <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6, fontSize:13}}>
            <li>• <strong>1% of every BUY</strong> — paid instantly</li>
            <li>• <strong>0.5% of every SELL</strong> — paid instantly</li>
            <li>• <strong>25,000 MON</strong> at graduation 🎓</li>
            <li>• <strong>2% lifetime trading volume</strong> share</li>
          </ul>
        </div>

        {/* COST SUMMARY */}
        <div className="card mb-4">
          {[['Launch fee', '100 MON'], [`Dev buy (${devBuyPct.toFixed(2)}% supply)`, devBuyPct > 0 ? `${Number(formatEther(devBuyWei)).toFixed(2)} MON` : '—'], ['Total supply', '1,000,000,000'], ['Graduation target', '425,000 MON'], ['LP after grad', 'Burned forever 🔥']].map(([l, v]) => (
            <div key={l} className="flex justify-between" style={{padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:13}}>
              <span className="text-t3">{l}</span>
              <span className="font-mono font-bold">{v}</span>
            </div>
          ))}
        </div>

        {/* REFERRAL */}
        {referrer !== ZERO_ADDR && <div className="card mb-3" style={{background:'rgba(74,222,128,0.05)', borderColor:'rgba(74,222,128,0.3)'}}>✅ Referral applied: <span className="font-mono">{referrer.slice(0, 6)}...{referrer.slice(-4)}</span></div>}

        {/* ERRORS */}
        {error && <div className="card mb-3" style={{background:'rgba(248,113,113,0.08)', borderColor:'rgba(248,113,113,0.3)', color:'var(--red)'}}>❌ {error}</div>}
        {uploading && <div className="card mb-3" style={{background:'rgba(168,85,247,0.05)', borderColor:'var(--bd2)', color:'var(--p2)'}}>⬆️ Uploading images…</div>}
        {isSuccess && <div className="card mb-3" style={{background:'rgba(74,222,128,0.08)', borderColor:'rgba(74,222,128,0.3)', color:'var(--green)'}}>🎉 Token launched! Redirecting…</div>}

        {/* CTA */}
        <button className="btn btn-primary btn-xl btn-block" onClick={handleCreate} disabled={busy}>
          {uploading ? '⬆️ Uploading…' : isPending ? '✍️ Confirm in wallet…' : isConfirming ? '⏳ Confirming…' : isConnected ? `🚀 Launch (${totalMON.toFixed(2)} MON)` : 'Connect Wallet to Launch'}
        </button>

        <div className="text-xs text-t4 text-center mt-3">By launching you confirm this token is for entertainment. No financial advice. DYOR.</div>
      </div>
    </Layout>
  )
}

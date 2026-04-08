import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { decodeEventLog, parseEther } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CREATION_FEE, MIN_DEV_BUY } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

export default function Create() {
  const router = useRouter()
  const { query } = router
  const { address, isConnected } = useAccount()

  const [form, setForm]             = useState({ name:'', symbol:'', desc:'', twitter:'', telegram:'', website:'' })
  const [banner, setBanner]         = useState(null)
  const [bannerPreview, setBannerP] = useState(null)
  const [pfp, setPfp]               = useState(null)
  const [pfpPreview, setPfpP]       = useState(null)
  const [devBuyAmt, setDevBuyAmt]   = useState('100')
  const [error, setError]           = useState('')
  const [uploading, setUploading]   = useState(false)
  const [step, setStep]             = useState('')

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash })
  const pendingMetaRef = useRef(null)

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  const referrer = query?.ref && query.ref.startsWith('0x') ? query.ref : ZERO_ADDR
  const devBuyWei = (() => { try { return parseEther(devBuyAmt || '0') } catch { return 0n } })()
  const totalCost = CREATION_FEE + (devBuyWei > MIN_DEV_BUY ? devBuyWei : MIN_DEV_BUY)
  const totalMON = Number(totalCost) / 1e18

  function handleBanner(e) {
    const f = e.target.files?.[0]; if (!f) return
    setBanner(f); const r=new FileReader(); r.onload=ev=>setBannerP(ev.target.result); r.readAsDataURL(f)
  }
  function handlePfp(e) {
    const f = e.target.files?.[0]; if (!f) return
    setPfp(f); const r=new FileReader(); r.onload=ev=>setPfpP(ev.target.result); r.readAsDataURL(f)
  }

  function validate() {
    if (!form.name.trim())       return 'Token name is required'
    if (!form.symbol.trim())     return 'Ticker symbol is required'
    if (form.symbol.length > 10) return 'Symbol max 10 chars'
    if (!isConnected)            return 'Connect your wallet first'
    if (devBuyWei < MIN_DEV_BUY) return 'Min dev buy is 100 MON'
    return ''
  }

  async function handleCreate() {
    const err = validate(); if (err) { setError(err); return }
    setError('')
    let bannerUrl=null, pfpUrl=null
    if ((banner||pfp) && SERVER) {
      setStep('uploading'); setUploading(true)
      try {
        if (banner) { const fd=new FormData(); fd.append('banner',banner); const r=await fetch(SERVER+'/api/upload/banner',{method:'POST',body:fd}); const d=await r.json(); bannerUrl=d.url }
        if (pfp)    { const fd=new FormData(); fd.append('pfp',pfp);       const r=await fetch(SERVER+'/api/upload/pfp',   {method:'POST',body:fd}); const d=await r.json(); pfpUrl=d.url }
      } catch(e) { console.warn('upload failed',e) }
      setUploading(false)
    }
    setStep('confirm')
    console.log('🚀 createLaunch:', { factory: FACTORY_ADDRESS, name: form.name.trim(), symbol: form.symbol.trim().toUpperCase(), maxSupply: MAX_SUPPLY.toString(), referrer, totalCost: totalCost.toString(), chainId: monad.id })
    writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: 'createLaunch',
      args: [form.name.trim(), form.symbol.trim().toUpperCase(), MAX_SUPPLY, referrer],
      value: totalCost,
      chainId: monad.id
    })
    pendingMetaRef.current = { bannerUrl, pfpUrl, name:form.name, symbol:form.symbol, desc:form.desc, twitter:form.twitter, telegram:form.telegram, website:form.website, creator:address }
  }

  useEffect(() => {
    if (!isSuccess || !receipt) return
    const meta = pendingMetaRef.current; if (!meta) return
    pendingMetaRef.current = null
    let tokenAddress = null
    try {
      for (const log of receipt.logs) {
        try {
          const d = decodeEventLog({ abi:FACTORY_ABI, data:log.data, topics:log.topics })
          if (d.eventName === 'Launched') { tokenAddress = d.args.token; break }
        } catch {}
      }
    } catch {}
    if (tokenAddress && SERVER) {
      fetch(SERVER+'/api/token/meta', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...meta,tokenAddress}) }).catch(()=>{})
    }
    setTimeout(() => router.push(tokenAddress ? '/token/'+tokenAddress : '/'), 1500)
  }, [isSuccess, receipt])

  useEffect(() => {
    if (writeError) {
      const msg = writeError?.shortMessage || writeError?.message || 'Transaction failed'
      if (!msg.includes('user rejected') && !msg.includes('User denied')) {
        setError(msg)
      }
      console.error('writeContract error:', writeError)
    }
  }, [writeError])

  const busy = uploading||isPending||isConfirming

  return (
    <Layout showBack title="Create Token">
      <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 14px 40px' }}>

        <div style={{ background:'linear-gradient(135deg,rgba(110,84,255,0.12),rgba(133,230,255,0.06))', border:'1px solid rgba(110,84,255,0.2)', borderRadius:16, padding:'20px 18px', marginBottom:24, textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🚀</div>
          <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>Launch on MonPad</div>
          <div style={{ fontSize:13, color:'var(--t2)' }}><span style={{ color:'var(--p2)', fontWeight:700 }}>Earn 2% of every trade</span> — buys and sells, forever.</div>
          <div style={{ display:'flex', justifyContent:'center', gap:24, marginTop:16 }}>
            {[['100 MON','Launch fee'],['1B','Total supply'],['Fair launch','No presale']].map(([v,l]) => (
              <div key={l}><div style={{ fontSize:15, fontWeight:800, color:'var(--p2)' }}>{v}</div><div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>{l}</div></div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <div className="input-label">Banner Image <span style={{ color:'var(--t3)', fontWeight:400 }}>(optional)</span></div>
          <label style={{ display:'block', cursor:'pointer' }}>
            <input type="file" accept="image/*" onChange={handleBanner} style={{ display:'none' }} />
            <div style={{ width:'100%', aspectRatio:'3/1', background:'var(--bg2)', border:'2px dashed '+(bannerPreview?'var(--p)':'var(--bd2)'), borderRadius:14, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {bannerPreview ? <img src={bannerPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <div style={{ textAlign:'center', color:'var(--t3)' }}><div style={{ fontSize:24, marginBottom:4 }}>🖼️</div><div style={{ fontSize:12 }}>Click to upload banner</div><div style={{ fontSize:10 }}>PNG, JPG · max 10MB · 3:1 ratio ideal</div></div>}
            </div>
          </label>
        </div>

        <div style={{ marginBottom:20 }}>
          <div className="input-label">Token Icon <span style={{ color:'var(--t3)', fontWeight:400 }}>(optional)</span></div>
          <label style={{ display:'flex', alignItems:'center', gap:14, cursor:'pointer' }}>
            <input type="file" accept="image/*" onChange={handlePfp} style={{ display:'none' }} />
            <div style={{ width:72, height:72, borderRadius:14, background:'var(--bg2)', border:'2px dashed '+(pfpPreview?'var(--p)':'var(--bd2)'), overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              {pfpPreview ? <img src={pfpPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <div style={{ textAlign:'center', color:'var(--t3)' }}><div style={{ fontSize:20 }}>🪙</div><div style={{ fontSize:9 }}>Icon</div></div>}
            </div>
            <div style={{ fontSize:13, color:'var(--t3)' }}>{pfpPreview ? '✅ Icon uploaded — click to change' : 'Click to upload token icon'}<div style={{ fontSize:11, marginTop:2 }}>Shown next to your token name everywhere</div></div>
          </label>
        </div>

        <div style={{ marginBottom:16 }}><div className="input-label">Token Name *</div><input className="input-field" placeholder="e.g. Petty" value={form.name} onChange={e=>set('name',e.target.value)} maxLength={50} /></div>
        <div style={{ marginBottom:16 }}><div className="input-label">Ticker Symbol *</div><input className="input-field" placeholder="e.g. LFG" value={form.symbol} onChange={e=>set('symbol',e.target.value.toUpperCase())} maxLength={10} /><div style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Max 10 chars · auto uppercase</div></div>
        <div style={{ marginBottom:16 }}><div className="input-label">Description</div><textarea className="input-field" placeholder="Tell people about your token…" value={form.desc} onChange={e=>set('desc',e.target.value)} rows={3} style={{ resize:'none' }} maxLength={280} /><div style={{ fontSize:11, color:'var(--t3)', marginTop:4, textAlign:'right' }}>{form.desc.length}/280</div></div>
        <div style={{ marginBottom:16 }}><div className="input-label">Twitter / X</div><input className="input-field" placeholder="https://x.com/yourtoken" value={form.twitter} onChange={e=>set('twitter',e.target.value)} /></div>
        <div style={{ marginBottom:16 }}><div className="input-label">Telegram</div><input className="input-field" placeholder="https://t.me/yourtoken" value={form.telegram} onChange={e=>set('telegram',e.target.value)} /></div>
        <div style={{ marginBottom:24 }}><div className="input-label">Website</div><input className="input-field" placeholder="https://yourtoken.xyz" value={form.website} onChange={e=>set('website',e.target.value)} /></div>

        <div style={{ marginBottom:20 }}>
          <div className="input-label">Dev Buy Amount <span style={{ color:'var(--p2)', fontWeight:700 }}>(min 100 MON)</span></div>
          <div style={{ position:'relative' }}>
            <input className="input-field" type="number" placeholder="100" value={devBuyAmt} onChange={e=>setDevBuyAmt(e.target.value)} min="100" style={{ paddingRight:52 }} />
            <span style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--t3)', fontWeight:600 }}>MON</span>
          </div>
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Atomic buy at launch — no frontrunning. Tokens locked until graduation.</div>
        </div>

        <div style={{ background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.2)', borderRadius:12, padding:'14px 16px', marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--p2)', marginBottom:8 }}>💰 Your earnings as creator</div>
          {[['1% of every BUY','paid instantly to your wallet'],['0.5% of every SELL','paid instantly to your wallet'],['25K MON graduation reward','paid at graduation']].map(([v,d]) => (
            <div key={v} style={{ fontSize:12, color:'var(--t2)', marginBottom:4 }}>• <strong style={{ color:'var(--t1)' }}>{v}</strong> — {d}</div>
          ))}
          <div style={{ marginTop:8, fontSize:12, color:'var(--p2)', fontWeight:700 }}>Total: 2% of all volume on your token + 25K MON at graduation</div>
        </div>

        <div className="card" style={{ marginBottom:20 }}>
          {[['Launch fee','100 MON'],['Dev buy (min 100 MON)',devBuyAmt+' MON'],['Total supply','1,000,000,000'],['LP after graduation','Burned forever 🔥']].map(([l,v]) => (
            <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
              <span style={{ color:'var(--t3)' }}>{l}</span><span style={{ fontWeight:700, fontFamily:'var(--mono)' }}>{v}</span>
            </div>
          ))}
        </div>

        {referrer !== ZERO_ADDR && <div style={{ background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.2)', borderRadius:10, padding:'10px 14px', fontSize:12, color:'var(--g)', marginBottom:14 }}>✅ Referral applied: {referrer.slice(0,6)}...{referrer.slice(-4)}</div>}
        {error && <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--r)', marginBottom:14 }}>{error}</div>}
        {uploading && <div style={{ background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.2)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--p2)', marginBottom:14 }}>⬆️ Uploading images…</div>}
        {isSuccess && <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--g)', marginBottom:14 }}>🎉 Token launched! Redirecting…</div>}

        <button className="btn-primary" style={{ width:'100%', padding:18, fontSize:16, fontWeight:800, borderRadius:14 }} onClick={handleCreate} disabled={busy}>
          {uploading?'⬆️ Uploading…':isPending?'✍️ Confirm in wallet…':isConfirming?'⏳ Confirming…':isConnected?'🚀 Launch Token ('+totalMON.toFixed(1)+' MON)':'Connect Wallet to Launch'}
        </button>

        <div style={{ textAlign:'center', fontSize:11, color:'var(--t3)', marginTop:12 }}>By launching you agree this token has no inherent value and is for entertainment only.</div>
      </div>
    </Layout>
  )
}

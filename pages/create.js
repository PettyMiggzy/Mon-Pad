import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { decodeEventLog } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, FACTORY_ABI, CREATION_FEE } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n

export default function Create() {
  const router = useRouter()
  const { address, isConnected } = useAccount()

  const [form, setForm]               = useState({ name:'', symbol:'', desc:'', twitter:'', website:'' })
  const [banner, setBanner]           = useState(null)
  const [bannerPreview, setBannerP]   = useState(null)
  const [pfp, setPfp]                 = useState(null)
  const [pfpPreview, setPfpP]         = useState(null)
  const [error, setError]             = useState('')
  const [uploading, setUploading]     = useState(false)
  const [step, setStep]               = useState('')

  const { writeContract, data: txHash, isPending }          = useWriteContract()
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: txHash })
  const pendingMetaRef = useRef(null)

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  function handleBanner(e) {
    const f = e.target.files?.[0]; if (!f) return
    setBanner(f); const r=new FileReader(); r.onload=ev=>setBannerP(ev.target.result); r.readAsDataURL(f)
  }
  function handlePfp(e) {
    const f = e.target.files?.[0]; if (!f) return
    setPfp(f); const r=new FileReader(); r.onload=ev=>setPfpP(ev.target.result); r.readAsDataURL(f)
  }

  function validate() {
    if (!form.name.trim())        return 'Token name is required'
    if (!form.symbol.trim())      return 'Ticker symbol is required'
    if (form.symbol.length > 10)  return 'Symbol max 10 chars'
    if (!isConnected)             return 'Connect your wallet first'
    return ''
  }

  async function handleCreate() {
    const err = validate(); if (err) { setError(err); return }
    setError('')

    let bannerUrl=null, pfpUrl=null

    if ((banner||pfp) && SERVER) {
      setStep('uploading'); setUploading(true)
      try {
        if (banner) {
          const bannerFd=new FormData(); bannerFd.append('banner',banner)
          const br=await fetch(`${SERVER}/api/upload/banner`,{method:'POST',body:bannerFd}); const bd=await br.json(); bannerUrl=bd.url
        }
        if (pfp) {
          const pfpFd=new FormData(); pfpFd.append('pfp',pfp)
          const pr=await fetch(`${SERVER}/api/upload/pfp`,{method:'POST',body:pfpFd}); const pd=await pr.json(); pfpUrl=pd.url
        }
      } catch(e) { console.warn('upload failed',e) }
      setUploading(false)
    }

    setStep('confirm')
    writeContract({ address:FACTORY_ADDRESS, abi:FACTORY_ABI, functionName:'createLaunch', args:[form.name.trim(),form.symbol.trim().toUpperCase(),MAX_SUPPLY], value:CREATION_FEE, chainId:monad.id })

    pendingMetaRef.current = { bannerUrl, pfpUrl, name:form.name, symbol:form.symbol, desc:form.desc, twitter:form.twitter, website:form.website, creator:address }
  }

  // after tx confirms — save metadata to server then redirect
  useEffect(() => {
    if (!isSuccess || !receipt) return
    const meta = pendingMetaRef.current
    if (!meta) return
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
      fetch(`${SERVER}/api/token/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, tokenAddress }),
      }).catch(() => {})
    }
    setTimeout(() => router.push(tokenAddress ? `/token/${tokenAddress}` : '/'), 1500)
  }, [isSuccess, receipt])

  const busy = uploading||isPending||isConfirming

  return (
    <Layout showBack title="Create Token">
      <div style={{ padding:'20px 14px 40px' }}>

        {/* hero */}
        <div style={{ background:'linear-gradient(135deg,rgba(110,84,255,0.12),rgba(133,230,255,0.06))', border:'1px solid rgba(110,84,255,0.2)', borderRadius:16, padding:'20px 18px', marginBottom:24, textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🚀</div>
          <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>Launch on MonPad</div>
          <div style={{ fontSize:13, color:'var(--t2)', lineHeight:1.6 }}>
            <span style={{ color:'var(--p2)', fontWeight:700 }}>Earn 1.5% of every trade</span> — buys and sells, forever.
          </div>
          <div style={{ display:'flex', justifyContent:'center', gap:24, marginTop:16 }}>
            {[['10 MON','Launch fee'],['1B','Total supply'],['400K MON','To graduate']].map(([v,l]) => (
              <div key={l}><div style={{ fontSize:15, fontWeight:800, color:'var(--p2)' }}>{v}</div><div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>{l}</div></div>
            ))}
          </div>
        </div>

        {/* BANNER */}
        <div style={{ marginBottom:16 }}>
          <div className="input-label">Banner Image <span style={{ color:'var(--t3)', fontWeight:400 }}>(optional)</span></div>
          <label style={{ display:'block', cursor:'pointer' }}>
            <input type="file" accept="image/*" onChange={handleBanner} style={{ display:'none' }} />
            <div style={{ width:'100%', aspectRatio:'3/1', background:'var(--bg2)', border:`2px dashed ${bannerPreview?'var(--p)':'var(--bd2)'}`, borderRadius:14, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', transition:'border-color .2s' }}>
              {bannerPreview
                ? <img src={bannerPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ textAlign:'center', color:'var(--t3)' }}><div style={{ fontSize:24, marginBottom:4 }}>🖼️</div><div style={{ fontSize:12, fontWeight:600 }}>Click to upload banner</div><div style={{ fontSize:10, marginTop:2 }}>PNG, JPG · max 10MB · 3:1 ratio ideal</div></div>
              }
            </div>
          </label>
        </div>

        {/* PFP */}
        <div style={{ marginBottom:20 }}>
          <div className="input-label">Token Icon <span style={{ color:'var(--t3)', fontWeight:400 }}>(optional)</span></div>
          <label style={{ display:'flex', alignItems:'center', gap:14, cursor:'pointer' }}>
            <input type="file" accept="image/*" onChange={handlePfp} style={{ display:'none' }} />
            <div style={{ width:72, height:72, borderRadius:14, background:'var(--bg2)', border:`2px dashed ${pfpPreview?'var(--p)':'var(--bd2)'}`, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'border-color .2s' }}>
              {pfpPreview ? <img src={pfpPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <div style={{ textAlign:'center', color:'var(--t3)' }}><div style={{ fontSize:20 }}>🪙</div><div style={{ fontSize:9, marginTop:2 }}>Icon</div></div>}
            </div>
            <div style={{ fontSize:13, color:'var(--t3)' }}>
              {pfpPreview ? '✅ Icon uploaded — click to change' : 'Click to upload token icon'}
              <div style={{ fontSize:11, marginTop:2 }}>Shown next to your token name everywhere</div>
            </div>
          </label>
        </div>

        {/* NAME */}
        <div style={{ marginBottom:16 }}>
          <div className="input-label">Token Name *</div>
          <input className="input-field" placeholder="e.g. Petty" value={form.name} onChange={e=>set('name',e.target.value)} maxLength={50} />
        </div>

        {/* SYMBOL */}
        <div style={{ marginBottom:16 }}>
          <div className="input-label">Ticker Symbol *</div>
          <input className="input-field" placeholder="e.g. LFG" value={form.symbol} onChange={e=>set('symbol',e.target.value.toUpperCase())} maxLength={10} />
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:5 }}>Max 10 chars · auto uppercase</div>
        </div>

        {/* DESC */}
        <div style={{ marginBottom:16 }}>
          <div className="input-label">Description</div>
          <textarea className="input-field" placeholder="Tell people about your token…" value={form.desc} onChange={e=>set('desc',e.target.value)} rows={3} style={{ resize:'none', lineHeight:1.5 }} maxLength={280} />
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:4, textAlign:'right' }}>{form.desc.length}/280</div>
        </div>

        {/* TWITTER */}
        <div style={{ marginBottom:16 }}>
          <div className="input-label">Twitter / X</div>
          <input className="input-field" placeholder="https://x.com/yourtoken" value={form.twitter} onChange={e=>set('twitter',e.target.value)} />
        </div>

        {/* WEBSITE */}
        <div style={{ marginBottom:24 }}>
          <div className="input-label">Website</div>
          <input className="input-field" placeholder="https://yourtoken.xyz" value={form.website} onChange={e=>set('website',e.target.value)} />
        </div>

        {/* DEV FEES */}
        <div style={{ background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.2)', borderRadius:12, padding:'14px 16px', marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--p2)', marginBottom:8 }}>💰 Your earnings as creator</div>
          {[['0.5% of every BUY','paid instantly to your wallet'],['0.5% of every SELL','paid instantly to your wallet'],['0.5% buy buffer','paid in full at graduation']].map(([v,d]) => (
            <div key={v} style={{ fontSize:12, color:'var(--t2)', marginBottom:4 }}>• <strong style={{ color:'var(--t1)' }}>{v}</strong> — {d}</div>
          ))}
          <div style={{ marginTop:8, fontSize:12, color:'var(--p2)', fontWeight:700 }}>Total: 1.5% of all volume on your token</div>
        </div>

        {/* COST */}
        <div className="card" style={{ marginBottom:20 }}>
          {[['Launch fee','10 MON'],['Total supply','1,000,000,000'],['Graduation target','400,000 MON'],['LP after graduation','Burned forever 🔥']].map(([l,v]) => (
            <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
              <span style={{ color:'var(--t3)' }}>{l}</span><span style={{ fontWeight:700, fontFamily:'var(--mono)' }}>{v}</span>
            </div>
          ))}
        </div>

        {error && <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--r)', marginBottom:14 }}>{error}</div>}
        {uploading && <div style={{ background:'rgba(110,84,255,0.08)', border:'1px solid rgba(110,84,255,0.2)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--p2)', marginBottom:14 }}>⬆️ Uploading images…</div>}
        {isSuccess && <div style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'var(--g)', marginBottom:14 }}>🎉 Token launched! Redirecting…</div>}

        <button className="btn-primary" style={{ width:'100%', padding:18, fontSize:16, fontWeight:800, borderRadius:14 }} onClick={handleCreate} disabled={busy}>
          {uploading?'⬆️ Uploading…':isPending?'✍️ Confirm in wallet…':isConfirming?'⏳ Confirming…':isConnected?'🚀 Launch Token (10 MON)':'Connect Wallet to Launch'}
        </button>

        <div style={{ textAlign:'center', fontSize:11, color:'var(--t3)', marginTop:12 }}>
          By launching you agree this token has no inherent value and is for entertainment only.
        </div>
      </div>
    </Layout>
  )
}
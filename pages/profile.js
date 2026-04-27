import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAccount } from 'wagmi'
import Layout from '../components/Layout'
import { fmtMON, fmtUSD, fmtAddr, MONSHI_TOKEN } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Profile() {
  const router = useRouter()
  const { address: wallet, isConnected } = useAccount()
  const [stats, setStats] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!wallet || !SERVER) return
    fetch(`${SERVER}/api/profile/${wallet}`).then(r => r.ok ? r.json() : null).then(d => setStats(d)).catch(() => {})
  }, [wallet])

  const refLink = typeof window !== 'undefined' && wallet ? `${window.location.origin}/create?ref=${wallet}` : ''

  function copyLink() {
    if (!refLink) return
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!isConnected) {
    return (
      <Layout title="Profile">
        <div className="container" style={{padding:40, textAlign:'center'}}>
          <div className="card" style={{padding:40, maxWidth:420, margin:'0 auto'}}>
            <div style={{fontSize:48, marginBottom:14}}>👤</div>
            <div className="text-xl font-bold mb-2">Connect to view profile</div>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="Profile">
      <div className="container" style={{maxWidth:640, paddingBottom:60}}>
        {/* HEADER */}
        <div className="hero" style={{marginTop:16, marginBottom:16, padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <div style={{width:80, height:80, margin:'0 auto 14px', borderRadius:'50%', background:'linear-gradient(135deg, var(--p), var(--p-deep))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:32, fontWeight:900, boxShadow:'var(--glow-p)'}}>{wallet.slice(2, 4).toUpperCase()}</div>
            <div className="font-mono text-base mb-2">{fmtAddr(wallet)}</div>
            <div className="flex gap-3 justify-center text-xs" style={{flexWrap:'wrap'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => router.push('/portfolio')}>💎 Portfolio</button>
              <button className="btn btn-ghost btn-sm" onClick={() => router.push('/staking')}>🥩 Stakes</button>
            </div>
          </div>
        </div>

        {/* REFERRAL */}
        <div className="card mb-4" style={{background:'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(34,211,238,0.04))'}}>
          <div className="font-bold text-base mb-2">🔗 Your Referral Link</div>
          <p className="text-t3 text-xs mb-3">Share this link. When someone launches a token through it, they're tagged as your referral.</p>
          <div className="flex gap-2">
            <input className="input" value={refLink} readOnly style={{fontSize:11, fontFamily:'var(--mono)'}} />
            <button className={`btn ${copied ? 'btn-green' : 'btn-primary'}`} onClick={copyLink}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
          <div className="flex gap-2 mt-3">
            <a className="btn btn-ghost btn-sm" style={{flex:1}} href={`https://twitter.com/intent/tweet?text=${encodeURIComponent('Launching on @Monshi_Monpad — fair launch on @monad_xyz, devs earn 2% forever 🚀')}&url=${encodeURIComponent(refLink)}`} target="_blank" rel="noreferrer">Share on 𝕏</a>
            <a className="btn btn-ghost btn-sm" style={{flex:1}} href={`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Launch your token on MonPad — fair launch on Monad')}`} target="_blank" rel="noreferrer">Share on TG</a>
          </div>
        </div>

        {/* QUICK STATS */}
        {stats && (
          <div className="card mb-4">
            <div className="font-bold text-base mb-3">📊 Activity</div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12}}>
              <div><div className="text-xs text-t3">Tokens launched</div><div className="font-mono font-bold text-base">{stats.tokensLaunched || 0}</div></div>
              <div><div className="text-xs text-t3">Total volume traded</div><div className="font-mono font-bold text-base">{fmtMON(stats.totalVolume || 0)}</div></div>
              <div><div className="text-xs text-t3">Active stakes</div><div className="font-mono font-bold text-base">{stats.activeStakes || 0}</div></div>
              <div><div className="text-xs text-t3">Referrals</div><div className="font-mono font-bold text-base">{stats.referralCount || 0}</div></div>
            </div>
          </div>
        )}

        {/* SETTINGS */}
        <div className="card">
          <div className="font-bold text-base mb-3">⚙️ Settings</div>
          <button className="btn btn-ghost btn-block mb-2" onClick={() => router.push('/portfolio')}>💎 Portfolio</button>
          <button className="btn btn-ghost btn-block mb-2" onClick={() => router.push('/staking')}>🥩 Staking</button>
          <a className="btn btn-ghost btn-block mb-2" href={`https://monadscan.com/address/${wallet}`} target="_blank" rel="noreferrer">🔗 View on Monadscan</a>
        </div>
      </div>
    </Layout>
  )
}

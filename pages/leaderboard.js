import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { fmtMON, fmtAddr } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const TABS = ['Top Traders', 'Top Tokens', 'Top Creators']

export default function Leaderboard() {
  const router = useRouter()
  const [tab, setTab]         = useState('Top Traders')
  const [traders, setTraders] = useState([])
  const [tokens, setTokens]   = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${SERVER}/api/leaderboard`)
      .then(r => r.json())
      .then(d => { setTraders(d.traders||[]); setTokens(d.tokens||[]); setCreators(d.creators||[]) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const COLORS = ['#FFD700','#C0C0C0','#CD7F32']
  const MEDALS = ['🥇','🥈','🥉']

  return (
    <Layout title="Leaderboard">
      <div style={{ padding:'20px 14px 0', textAlign:'center' }}>
        <img src="/badge.png" alt="Top Trader Badge" onError={e => e.target.style.display='none'}
          style={{ width:120, height:120, objectFit:'contain', margin:'0 auto 12px' }} />
        <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>MonPad Top Trader</div>
        <div style={{ fontSize:12, color:'var(--t3)', marginBottom:20 }}>Top trader each week earns the gold badge on their profile</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:1, margin:'0 14px 20px', background:'var(--bd)', borderRadius:12, overflow:'hidden' }}>
        {[['Total Traders', traders.length],['Total Tokens', tokens.length],['Total Creators', creators.length]].map(([l,v]) => (
          <div key={l} style={{ background:'var(--bg2)', padding:'12px 8px', textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:800, color:'var(--p2)' }}>{v}</div>
            <div style={{ fontSize:9, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.3px', marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid var(--bd)', margin:'0 14px 0' }}>
        {TABS.map(t => (
          <div key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:'12px 0', textAlign:'center', fontSize:12, fontWeight:700, color:tab===t?'var(--t1)':'var(--t3)', cursor:'pointer', borderBottom:tab===t?'2px solid var(--p)':'2px solid transparent', marginBottom:-1 }}>
            {t}
          </div>
        ))}
      </div>

      {loading && <div style={{ padding:'40px 14px', textAlign:'center', color:'var(--t3)', fontSize:13 }}>Loading…</div>}

      {!loading && tab==='Top Traders' && (
        <div style={{ padding:'0 14px' }}>
          {traders.length===0 && <div style={{ padding:'40px 0', textAlign:'center', color:'var(--t3)', fontSize:13 }}>No traders yet — start trading!</div>}
          {traders.map(({addr, vol}, i) => (
            <div key={addr} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderBottom:'1px solid var(--bd)' }}>
              <div style={{ fontSize:i<3?20:13, fontWeight:800, color:COLORS[i]||'var(--t3)', width:28, textAlign:'center', flexShrink:0 }}>
                {i<3?MEDALS[i]:i+1}
              </div>
              <div style={{ width:40, height:40, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'white', flexShrink:0 }}>
                {addr.slice(2,4).toUpperCase()}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontFamily:'var(--mono)', color:i===0?'var(--gold)':'var(--t2)' }}>{fmtAddr(addr)}</div>
                {i===0 && <div style={{ fontSize:10, color:'var(--gold)', marginTop:2 }}>👑 Top Trader</div>}
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:14, fontWeight:800, fontFamily:'var(--mono)' }}>{(vol).toFixed(2)} MON</div>
                <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>volume</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab==='Top Tokens' && (
        <div style={{ padding:'0 14px' }}>
          {tokens.length===0 && <div style={{ padding:'40px 0', textAlign:'center', color:'var(--t3)', fontSize:13 }}>No tokens yet</div>}
          {tokens.map((t, i) => (
            <div key={t.token} onClick={() => router.push(`/token/${t.token}`)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderBottom:'1px solid var(--bd)', cursor:'pointer' }}>
              <div style={{ fontSize:i<3?20:13, fontWeight:800, color:COLORS[i]||'var(--t3)', width:28, textAlign:'center', flexShrink:0 }}>
                {i<3?MEDALS[i]:i+1}
              </div>
              <div style={{ width:40, height:40, borderRadius:10, background:'radial-gradient(circle at 35% 35%,#3b1d9e,#120830)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'rgba(255,255,255,0.3)', flexShrink:0 }}>
                {(t.symbol||'?').slice(0,2)}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:800 }}>{t.name}</div>
                <div style={{ fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)' }}>${t.symbol} {t.graduated?'· 🎓':''}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:14, fontWeight:800, fontFamily:'var(--mono)' }}>{(t.volume||0).toFixed(2)} MON</div>
                <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>volume</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab==='Top Creators' && (
        <div style={{ padding:'0 14px' }}>
          {creators.length===0 && <div style={{ padding:'40px 0', textAlign:'center', color:'var(--t3)', fontSize:13 }}>No creators yet</div>}
          {creators.map(({addr, vol}, i) => (
            <div key={addr} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 0', borderBottom:'1px solid var(--bd)' }}>
              <div style={{ fontSize:i<3?20:13, fontWeight:800, color:COLORS[i]||'var(--t3)', width:28, textAlign:'center', flexShrink:0 }}>
                {i<3?MEDALS[i]:i+1}
              </div>
              <div style={{ width:40, height:40, borderRadius:'50%', background:'var(--p)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'white', flexShrink:0 }}>
                {addr.slice(2,4).toUpperCase()}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontFamily:'var(--mono)', color:'var(--t2)' }}>{fmtAddr(addr)}</div>
                <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>Earns 1.5% of all volume</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:14, fontWeight:800, fontFamily:'var(--mono)' }}>{(vol||0).toFixed(2)} MON</div>
                <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>generated</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}

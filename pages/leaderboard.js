import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { fmtMON, fmtUSD, fmtAddr, fmtTokens } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Leaderboard() {
  const router = useRouter()
  const [tab, setTab] = useState('creators')
  const [data, setData] = useState({ creators: [], stakers: [], traders: [], tokens: [] })
  const [monPrice, setMonPrice] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!SERVER) { setLoading(false); return }
    fetch(`${SERVER}/api/mon-price`).then(r => r.json()).then(d => setMonPrice(d.price || 0)).catch(() => {})
    loadAll()
  }, [])

  async function loadAll() {
    if (!SERVER) return
    try {
      const [creators, stakers, traders, tokens] = await Promise.all([
        fetch(`${SERVER}/api/leaderboard/creators?limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/leaderboard/stakers?limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/leaderboard/traders?limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${SERVER}/api/tokens`).then(r => r.ok ? r.json() : []).catch(() => []),
      ])
      setData({
        creators: Array.isArray(creators) ? creators : [],
        stakers: Array.isArray(stakers) ? stakers : [],
        traders: Array.isArray(traders) ? traders : [],
        tokens: Array.isArray(tokens) ? [...tokens].sort((a,b) => Number(b.volumeMon || 0) - Number(a.volumeMon || 0)).slice(0, 50) : []
      })
    } catch {}
    setLoading(false)
  }

  return (
    <Layout title="Leaderboard">
      <div className="container" style={{paddingBottom:60}}>
        <div className="hero" style={{marginTop:16, marginBottom:16, padding:'24px 18px'}}>
          <div style={{position:'relative', zIndex:1}}>
            <h1 className="hero-title" style={{fontSize:'clamp(28px,5vw,40px)'}}>🏆 Leaderboard</h1>
            <p className="text-t2 text-sm">Top creators, stakers, traders, and tokens on MonPad.</p>
          </div>
        </div>

        <div className="tabs" style={{margin:'8px 0 16px'}}>
          {[['creators', '🚀 Top Creators'], ['stakers', '🥩 Top Stakers'], ['traders', '📊 Top Traders'], ['tokens', '🔥 Top Tokens']].map(([id, lbl]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-t3 dots" style={{padding:40}}>Loading rankings</div>
        ) : (
          <div className="card" style={{padding:0, overflow:'hidden'}}>
            {tab === 'creators' && <Table rows={data.creators} cols={[
              { label: 'Wallet', render: r => <span className="font-mono text-xs">{fmtAddr(r.wallet)}</span> },
              { label: 'Tokens', render: r => <span className="font-mono">{r.tokenCount}</span>, right: true },
              { label: 'Volume', render: r => <span className="font-mono font-bold">{fmtMON(r.totalVolume)}</span>, right: true },
              { label: 'Earned', render: r => <span className="font-mono text-green font-bold">{fmtMON(r.totalEarned)} MON</span>, right: true },
            ]} />}

            {tab === 'stakers' && <Table rows={data.stakers} cols={[
              { label: 'Wallet', render: r => <span className="font-mono text-xs">{fmtAddr(r.wallet)}</span> },
              { label: 'Stakes', render: r => <span className="font-mono">{r.activeStakes}</span>, right: true },
              { label: 'Total MON Staked', render: r => <span className="font-mono">{fmtMON(r.totalStakedMon)}</span>, right: true },
              { label: 'Rewards', render: r => <span className="font-mono text-green font-bold">{fmtMON(r.totalRewards)}</span>, right: true },
            ]} />}

            {tab === 'traders' && <Table rows={data.traders} cols={[
              { label: 'Wallet', render: r => <span className="font-mono text-xs">{fmtAddr(r.wallet)}</span> },
              { label: 'Trades', render: r => <span className="font-mono">{r.tradeCount}</span>, right: true },
              { label: 'Volume', render: r => <span className="font-mono font-bold">{fmtMON(r.volume)}</span>, right: true },
              { label: 'P&L', render: r => <span className={`font-mono font-bold ${r.pnl >= 0 ? 'text-green' : 'text-red'}`}>{r.pnl >= 0 ? '+' : ''}{(Number(r.pnl)/1e18).toFixed(2)}</span>, right: true },
            ]} />}

            {tab === 'tokens' && <Table rows={data.tokens} cols={[
              { label: 'Token', render: r => <span onClick={() => router.push(`/token/${r.tokenAddress}`)} style={{cursor:'pointer'}}><span className="font-bold">{r.name}</span> <span className="font-mono text-xs text-t3">${r.symbol}</span></span> },
              { label: 'MCap', render: r => <span className="font-mono font-bold">{fmtUSD(r.marketCap || r.monRaisedNet, monPrice)}</span>, right: true },
              { label: 'Volume', render: r => <span className="font-mono">{fmtMON(r.volumeMon || 0)}</span>, right: true },
              { label: 'Status', render: r => r.graduated ? <span className="tag tag-gold">GRAD</span> : <span className="font-mono text-xs">{(Number(r.bondedBps || 0)/100).toFixed(1)}%</span>, right: true },
            ]} />}
          </div>
        )}
      </div>
    </Layout>
  )
}

function Table({ rows, cols }) {
  if (!rows.length) return <div className="text-center text-t3" style={{padding:40, fontSize:13}}>No data yet</div>
  return (
    <table style={{width:'100%', fontSize:13}}>
      <thead style={{borderBottom:'1px solid var(--bd)'}}>
        <tr>
          <th style={{textAlign:'left', padding:'12px 16px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase', width:48}}>#</th>
          {cols.map(c => <th key={c.label} style={{textAlign: c.right ? 'right' : 'left', padding:'12px 16px', color:'var(--t3)', fontWeight:700, fontSize:11, letterSpacing:1, textTransform:'uppercase'}}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
            <td style={{padding:'12px 16px', color: i < 3 ? ['#FCD34D', '#A1A1AA', '#D97706'][i] : 'var(--t4)', fontWeight:700}}>#{i+1}</td>
            {cols.map(c => <td key={c.label} style={{padding:'12px 16px', textAlign: c.right ? 'right' : 'left'}}>{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

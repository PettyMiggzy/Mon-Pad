import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

export default function Live() {
  const router = useRouter()
  const [liveTokens, setLiveTokens] = useState([])
  const [metas, setMetas] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!SERVER) { setLoading(false); return }
    Promise.all([
      fetch(`${SERVER}/api/live`).then(r => r.json()),
      fetch(`${SERVER}/api/tokens`).then(r => r.json()),
    ]).then(([liveData, tokenData]) => {
      const live = liveData.live || []
      setLiveTokens(live)
      const map = {}
      for (const m of tokenData) map[m.tokenAddress?.toLowerCase()] = m
      setMetas(map)
    }).catch(() => {}).finally(() => setLoading(false))

    const iv = setInterval(() => {
      fetch(`${SERVER}/api/live`).then(r => r.json()).then(d => setLiveTokens(d.live || [])).catch(() => {})
    }, 10000)
    return () => clearInterval(iv)
  }, [])

  return (
    <Layout title="Live">
      <div style={{ padding: '20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '50%', animation: 'blink 1.5s infinite' }} />
          <span style={{ fontSize: 18, fontWeight: 800 }}>Live Now</span>
          {liveTokens.length > 0 && (
            <span style={{ background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>
              {liveTokens.length}
            </span>
          )}
        </div>

        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ height: 140, borderRadius: 12, background: 'var(--bg2)', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        )}

        {!loading && liveTokens.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>📡</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nobody is live right now</div>
            <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 24 }}>Token creators can go live from their token page</div>
            <button onClick={() => router.push('/')}
              style={{ background: 'var(--p)', color: 'white', border: 'none', borderRadius: 10, padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Browse Tokens
            </button>
          </div>
        )}

        {!loading && liveTokens.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {liveTokens.map(addr => {
              const meta = metas[addr?.toLowerCase()]
              return (
                <div key={addr} onClick={() => router.push(`/token/${addr}`)}
                  style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(239,68,68,0.3)', background: 'var(--bg2)', cursor: 'pointer', transition: 'border-color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'}>

                  {/* Banner / placeholder */}
                  <div style={{ height: 120, background: meta?.bannerUrl ? '#000' : 'linear-gradient(135deg,#6E54FF22,#6E54FF08)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {meta?.bannerUrl
                      ? <img src={meta.bannerUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 32, fontWeight: 900, color: 'var(--p2)', opacity: .3 }}>{(meta?.symbol || '??').slice(0,2)}</span>
                    }
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 60%)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 8, left: 8, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, background: 'white', borderRadius: '50%', animation: 'blink 1.5s infinite' }} />
                      LIVE
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {meta?.pfpUrl && (
                      <img src={meta.pfpUrl} alt="" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(239,68,68,0.4)' }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{meta?.name || 'Unknown Token'}</div>
                      <div style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>${meta?.symbol || addr.slice(0,8)}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: 12, color: '#ef4444', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                      Watch →
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
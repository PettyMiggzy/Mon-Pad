import { useRouter } from 'next/router'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import WalletButton from './WalletButton'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

const NAV = [
  { href: '/', label: 'Home', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
  )},
  { href: '/live', label: 'Live', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
    </svg>
  )},
  { href: '/portfolio', label: 'Portfolio', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
    </svg>
  )},
  { href: '/profile', label: 'Profile', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  )},
  { href: '/leaderboard', label: 'Leaderboard', icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
  )},
  { href: '/docs', label: 'Docs', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  )},
  { href: 'https://t.me/MonshiUtilitySupport', label: 'Support', external: true, icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
  )},
]

export default function Layout({ children, showBack, title }) {
  const router = useRouter()
  const path = router.pathname
  const [stats, setStats] = useState({ tokens: 0, volume: 0, devFees: 0, graduated: 0 })
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/tokens`)
      .then(r => r.json())
      .then(tokens => {
        const vol = tokens.reduce((a, t) => a + (t.volumeMon || 0), 0)
        setStats({
          tokens: tokens.length,
          volume: vol,
          devFees: vol * 0.015,
          graduated: tokens.filter(t => t.graduated).length
        })
      })
      .catch(() => {})
  }, [])

  const handleSearch = e => {
    if (e.key === 'Enter' && search.trim()) {
      router.push(`/?q=${encodeURIComponent(search.trim())}`)
    }
  }

  const fmtMon = n => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return Math.floor(n).toLocaleString()
  }

  return (
    <div className="app-root">

      {/* ICON-ONLY SIDEBAR */}
      <aside className="sidebar">

        {/* Create button */}
        <Link href="/create" className="sidebar-create-icon" title="Create Token">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </Link>

        {/* Nav icons */}
        <nav className="sidebar-nav">
          {NAV.map(item => {
            const active = !item.external && path === item.href
            if (item.external) return (
              <a key={item.label} href={item.href} target="_blank" rel="noreferrer"
                className="sidebar-icon-link" title={item.label}>
                {item.icon}
              </a>
            )
            return (
              <Link key={item.href} href={item.href}
                className={`sidebar-icon-link${active ? ' active' : ''}`} title={item.label}>
                {item.icon}
              </Link>
            )
          })}
        </nav>

        {/* Socials at bottom */}
        <div className="sidebar-icon-socials">
          <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" title="Twitter" className="social-icon-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.631L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>
          </a>
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noreferrer" title="Telegram" className="social-icon-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          </a>
          {/* Built by Monshi */}
          <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" title="Built by Monshi"
            style={{ marginTop: 6, opacity: 0.5, transition: 'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}>
            <img src="/MonshiPad.png" alt="Monshi" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }}
              onError={e => e.target.style.display='none'} />
          </a>
        </div>

      </aside>

      {/* MAIN */}
      <div className="main-area">

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            {showBack ? (
              <button onClick={() => router.back()} className="back-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
              </button>
            ) : (
              <Link href="/" className="mobile-logo">
                <img src="/monpad-logo.png" alt="MonPad" style={{ width:44, height:44, borderRadius:10, objectFit:'cover' }} onError={e => e.target.style.display='none'} />
              </Link>
            )}
            {title && <div className="topbar-title">{title}</div>}
          </div>

          <div className="topbar-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="search-input"
              placeholder="Search tokens…"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
            />
            <kbd className="search-kbd">⌘ K</kbd>
          </div>

          <div className="topbar-right">
            <Link href="/create" className="topbar-create-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="13" height="13">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create
            </Link>
            <WalletButton />
            <Link href="/" className="topbar-monpad-brand" style={{ display:'flex', alignItems:'center', gap:4, marginLeft:4, textDecoration:'none' }}>
              <div style={{ background:'linear-gradient(135deg,#1a1030,#2a1a5e)', border:'1px solid rgba(110,84,255,0.3)', borderRadius:10, padding:'5px 10px', display:'flex', gap:0 }}>
                <span style={{ fontSize:13, fontWeight:900, color:'white', letterSpacing:'-0.5px' }}>mon</span>
                <span style={{ fontSize:13, fontWeight:900, color:'#a78bfa', letterSpacing:'-0.5px' }}>pad</span>
              </div>
            </Link>
          </div>
        </header>

        <main className="page-content">
          {children}
          <DesktopFooter />
        </main>
      </div>

      {/* BOTTOM STATS BAR */}
      <div className="stats-bar">
        <div className="stats-bar-inner">
          <StatItem label="🚀 Tokens" val={stats.tokens.toLocaleString()} />
          <div className="stat-div"/>
          <StatItem label="📊 Volume" val={`${fmtMon(stats.volume)} MON`} />
          <div className="stat-div"/>
          <StatItem label="💰 Dev Fees" val={`${fmtMon(stats.devFees)} MON`} cls="gold" />
          <div className="stat-div"/>
          <StatItem label="🎓 Graduated" val={stats.graduated} cls="green" />
          <div className="stat-div"/>
          <StatItem label="⛓ Chain" val="Monad" cls="purple" />
        </div>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="bottom-nav">
        <div className={`nav-item${path==='/'?' on':''}`} onClick={() => router.push('/')}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          <span>Home</span>
        </div>
        <div className={`nav-item${path==='/portfolio'?' on':''}`} onClick={() => router.push('/portfolio')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <span>Search</span>
        </div>
        <div className="nav-create" onClick={() => router.push('/create')}>
          <div className="nav-create-circle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="26" height="26">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <span>Create</span>
        </div>
        <div className={`nav-item${path==='/live'?' on':''}`} onClick={() => router.push('/live')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
            <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
          </svg>
          <span>Live</span>
        </div>
        <div className={`nav-item${path==='/profile'?' on':''}`} onClick={() => router.push('/profile')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <span>Profile</span>
        </div>
      </nav>

    </div>
  )
}

function StatItem({ label, val, cls }) {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className={`stat-val${cls ? ' ' + cls : ''}`}>{val}</span>
    </div>
  )
}

function DesktopFooter() {
  return (
    <div className="desktop-footer">
      <div className="footer-links">
        <Link href="/docs" className="footer-link">Docs</Link>
        <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" className="footer-link">Twitter</a>
        <a href="https://monadscan.io" target="_blank" rel="noreferrer" className="footer-link">Monadscan</a>
        <Link href="/leaderboard" className="footer-link">Leaderboard</Link>
        <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noreferrer" className="footer-link">Support</a>
      </div>
      <div className="footer-copy">© 2026 MonPad · Built on Monad · Devs earn <strong style={{color:'#a78bfa'}}>2% of volume</strong></div>
    </div>
  )
}
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import WalletButton from './WalletButton'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

const NAV = [
  { href: '/', label: 'Home', icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
     )},
  { href: '/live', label: 'Live', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
    </svg>
     )},
  { href: '/portfolio', label: 'Portfolio', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
    </svg>
     )},
  { href: '/profile', label: 'Profile', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
     )},
  { href: '/leaderboard', label: 'Leaderboard', icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
     )},
  { href: '/docs', label: 'Docs', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
     )},
  { href: 'https://t.me/MonshiUtilitySupport', label: 'Support', external: true, icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
     )},
  ]

export default function Layout({ children, showBack, title }) {
    const router = useRouter()
    const path = router.pathname
    const [stats, setStats] = useState({ tokens: 0, volume: 0, devFees: 0, graduated: 0 })
    const [search, setSearch] = useState('')

  useEffect(() => {
        if (!SERVER) return
        fetch(`${SERVER}/api/tokens`)
          .then(r => r.json())
          .then(tokens => {
                    const vol = tokens.reduce((a, t) => a + (t.volumeMon || 0), 0)
                    setStats({
                                tokens: tokens.length,
                                volume: vol,
                                devFees: vol * 0.015,
                                graduated: tokens.filter(t => t.graduated).length
                    })
          })
          .catch(() => {})
  }, [])

  const handleSearch = e => {
        if (e.key === 'Enter' && search.trim()) {
                router.push(`/?q=${encodeURIComponent(search.trim())}`)
        }
  }

  const fmtMon = n => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
        return Math.floor(n).toLocaleString()
  }

  return (
        <div className="app-root">
  {/* ICON-ONLY SIDEBAR — desktop only */}
          <aside className="sidebar">
  {/* Create button */}
            <Link href="/create" className="sidebar-create-icon" title="Create Token">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    </Link>
  {/* Nav icons */}
          <nav className="sidebar-nav">
          {NAV.map(item => {
                        const active = !item.external && path === item.href
                        if (item.external) return (
                                        <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className="sidebar-icon-link" title={item.label}>
{item.icon}
  </a>
            )
            return (
                            <Link key={item.href} href={item.href} className={`sidebar-icon-link${active ? ' active' : ''}`} title={item.label}>
            {item.icon}
              </Link>
            )
})}
</nav>
{/* Socials at bottom */}
        <div className="sidebar-icon-socials">
                    <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" title="Twitter" className="social-icon-sm">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.631L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>
          </a>
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noreferrer" title="Telegram" className="social-icon-sm">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          </a>
          <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" title="Built by Monshi" style={{ marginTop: 6, opacity: 0.5, transition: 'opacity .15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}>
                      <img src="/MonshiPad.png" alt="Monshi" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
          </a>
          </div>
          </aside>

{/* MAIN */}
      <div className="main-area">

      {/* MOBILE TOP BAR — only on mobile */}
        <header className="mobile-topbar">
                  <div className="mobile-topbar-left">
      {showBack ? (
                      <button onClick={() => router.back()} className="back-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        </button>
            ) : (
                            <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: 'white', letterSpacing: '-0.5px' }}>mon</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: '#a78bfa', letterSpacing: '-0.5px' }}>pad</span>
                <span style={{ fontSize: 14, color: '#a78bfa', marginLeft: 1, marginTop: -4 }}>°</span>
              </Link>
            )}
</div>
          <div className="mobile-topbar-right">
                          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noreferrer" className="mobile-topbar-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
              </a>
            <WalletButton />
              </div>
              </header>

{/* DESKTOP TOPBAR */}
        <header className="topbar">
                    <div className="topbar-left">
        {showBack ? (
                        <button onClick={() => router.back()} className="back-btn">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          </button>
            ) : (
                            <Link href="/" className="mobile-logo">
                              <img src="/monpad-logo.png" alt="MonPad" style={{ width:44, height:44, borderRadius:10, objectFit:'cover' }} onError={e => e.target.style.display='none'} />
              </Link>
            )}
{title && <div className="topbar-title">{title}</div>}
  </div>
           <div className="topbar-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
             <input className="search-input" placeholder="Search tokens..." type="search" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleSearch} />
              <kbd className="search-kbd">⌘ K</kbd>
  </div>
           <div className="topbar-right">
              <Link href="/create" className="topbar-create-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="13" height="13">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
               Create
                 </Link>
             <WalletButton />
                             <Link href="/" className="topbar-monpad-brand" style={{ display:'flex', alignItems:'center', gap:4, marginLeft:4, textDecoration:'none' }}>
              <div style={{ background:'linear-gradient(135deg,#1a1030,#2a1a5e)', border:'1px solid rgba(110,84,255,0.3)', borderRadius:10, padding:'5px 10px', display:'flex', gap:0 }}>
                <span style={{ fontSize:13, fontWeight:900, color:'white', letterSpacing:'-0.5px' }}>mon</span>
                <span style={{ fontSize:13, fontWeight:900, color:'#a78bfa', letterSpacing:'-0.5px' }}>pad</span>
  </div>
  </Link>
  </div>
  </header>

        <main className="page-content">
{children}
          <DesktopFooter />
  </main>
  </div>

{/* BOTTOM STATS BAR */}
      <div className="stats-bar">
                <div className="stats-bar-inner">
                  <StatItem label="🚀 Tokens" val={stats.tokens.toLocaleString()} />
          <div className="stat-div"/>
                  <StatItem label="📊 Volume" val={`${fmtMon(stats.volume)} MON`} />
          <div className="stat-div"/>
                  <StatItem label="💰 Dev Fees" val={`${fmtMon(stats.devFees)} MON`} cls="gold" />
                  <div className="stat-div"/>
                  <StatItem label="🎓 Graduated" val={stats.graduated} cls="green" />
                  <div className="stat-div"/>
                  <StatItem label="⛓ Chain" val="Monad" cls="purple" />
        </div>
        </div>

{/* MOBILE BOTTOM NAV */}
      <nav className="bottom-nav">
                <div className={`nav-item${path==='/'?' on':''}`} onClick={() => router.push('/')}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          <span>Home</span>
        </div>
        <div className={`nav-item${path==='/portfolio'?' on':''}`} onClick={() => router.push('/portfolio')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/>
        </svg>
          <span>Search</span>
        </div>
        <div className="nav-create" onClick={() => router.push('/create')}>
          <div className="nav-create-circle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="26" height="26">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        </div>
          <span>Create</span>
        </div>
        <div className={`nav-item${path==='/live'?' on':''}`} onClick={() => router.push('/live')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.899L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
        </svg>
          <span>Live</span>
        </div>
        <div className={`nav-item${path==='/profile'?' on':''}`} onClick={() => router.push('/profile')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
          <span>Profile</span>
        </div>
        </nav>
        </div>
  )
}

function StatItem({ label, val, cls }) {
    return (
          <div className="stat-item">
            <span className="stat-label">{label}</span>
        <span className={`stat-val${cls ? ' ' + cls : ''}`}>{val}</span>
  </div>
  )
}

function DesktopFooter() {
    return (
          <div className="desktop-footer">
            <div className="footer-links">
              <Link href="/docs" className="footer-link">Docs</Link>
          <a href="https://x.com/MonshiMonad" target="_blank" rel="noreferrer" className="footer-link">Twitter</a>
          <a href="https://monadscan.io" target="_blank" rel="noreferrer" className="footer-link">Monadscan</a>
          <Link href="/leaderboard" className="footer-link">Leaderboard</Link>
          <a href="https://t.me/MonshiUtilitySupport" target="_blank" rel="noreferrer" className="footer-link">Support</a>
      </div>
        <div className="footer-copy">© 2026 MonPad · Built on Monad · Devs earn <strong style={{color:'#a78bfa'}}>2% of volume</strong></div>
  </div>
  )
}

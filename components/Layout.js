import { useRouter } from 'next/router'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance } from 'wagmi'
import { fmtMON, fmtAddr } from '../lib/constants'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''

const NAV = [
  { href: '/', label: 'Browse', icon: '🔥' },
  { href: '/staking', label: 'Stake', icon: '🥩' },
  { href: '/swap', label: 'Swap', icon: '🔄' },
  { href: '/portfolio', label: 'Portfolio', icon: '💎' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { href: '/docs', label: 'Docs', icon: '📖' },
]

export default function Layout({ children, showBack, title, hideHero }) {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/tokens`)
      .then(r => r.json())
      .then(tokens => {
        const vol = tokens.reduce((a, t) => a + (Number(t.volumeMon) || 0), 0)
        setStats({
          tokens: tokens.length,
          volume: vol,
          fees: vol * 0.02,
          graduated: tokens.filter(t => t.graduated).length,
        })
      })
      .catch(() => {})
  }, [router.pathname])

  return (
    <div className="app">
      {/* TOPBAR */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="flex items-center gap-3">
            {showBack ? (
              <button onClick={() => router.back()} className="flex items-center gap-1 text-t3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                <span className="text-sm font-bold hide-mobile">Back</span>
              </button>
            ) : (
              <Link href="/" className="brand">
                <div className="brand-logo">M</div>
                <div className="brand-name">Mon<span className="accent">Pad</span></div>
              </Link>
            )}
            {title && <div className="text-sm font-bold text-t2 hide-mobile" style={{marginLeft:14, paddingLeft:14, borderLeft:'1px solid var(--bd)'}}>{title}</div>}
          </div>

          <nav className="topbar-nav">
            {NAV.map(item => (
              <Link key={item.href} href={item.href} className={`topbar-link ${router.pathname === item.href ? 'active' : ''}`}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="topbar-actions">
            <Link href="/create" className="btn btn-primary btn-sm hide-mobile">+ Create</Link>
            <ConnectButton accountStatus="avatar" chainStatus="none" showBalance={false} />
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="app-main">
        {children}
      </main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="bottomnav">
        <Link href="/" className={`bottomnav-item ${router.pathname === '/' ? 'active' : ''}`}>
          <span style={{fontSize:18}}>🔥</span>
          <span>Browse</span>
        </Link>
        <Link href="/staking" className={`bottomnav-item ${router.pathname.startsWith('/stak') ? 'active' : ''}`}>
          <span style={{fontSize:18}}>🥩</span>
          <span>Stake</span>
        </Link>
        <Link href="/create" className="bottomnav-create">
          <div className="circle">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" width="22" height="22"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <span style={{fontSize:10, color:'var(--p2)', marginTop:2, fontWeight:700}}>Launch</span>
        </Link>
        <Link href="/portfolio" className={`bottomnav-item ${router.pathname === '/portfolio' ? 'active' : ''}`}>
          <span style={{fontSize:18}}>💎</span>
          <span>Portfolio</span>
        </Link>
        <Link href="/leaderboard" className={`bottomnav-item ${router.pathname === '/leaderboard' ? 'active' : ''}`}>
          <span style={{fontSize:18}}>🏆</span>
          <span>Top</span>
        </Link>
      </nav>
    </div>
  )
}

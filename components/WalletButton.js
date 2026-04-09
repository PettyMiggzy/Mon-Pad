import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useState, useEffect } from 'react'
import { fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

export default function WalletButton() {
      const { address, isConnected } = useAccount()
      const { connect, connectors } = useConnect()
      const { disconnect } = useDisconnect()
      const { data: balance } = useBalance({ address, chainId: monad.id })
      const [showMenu, setShowMenu] = useState(false)
      const [showConnect, setShowConnect] = useState(false)
      const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
          const check = () => setIsMobile(window.innerWidth < 768)
          check()
          window.addEventListener('resize', check)
          return () => window.removeEventListener('resize', check)
  }, [])

  // Deep-link to MetaMask mobile
  const openMetaMaskDeepLink = () => {
          const url = encodeURIComponent(window.location.href)
          window.location.href = `https://metamask.app.link/dapp/${window.location.host}`
  }

  if (isConnected && address) {
          return (
                    <div style={{ position: 'relative' }}>
            <button className="wallet-btn connected" onClick={() => setShowMenu(s => !s)}>
{balance ? `${Number(balance.formatted).toFixed(2)} MON` : fmtAddr(address)}
</button>
{showMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowMenu(false)} />
{isMobile ? (
                  /* Mobile bottom sheet */
                  <div style={{
                    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
                                      background: 'var(--bg2)', borderRadius: '20px 20px 0 0',
                                      border: '1px solid var(--bd2)', padding: '20px 16px 40px',
                                      boxShadow: '0 -8px 40px rgba(0,0,0,0.7)'
                  }}>
                    <div style={{ width: 36, height: 4, background: 'var(--bd2)', borderRadius: 999, margin: '0 auto 16px' }} />
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, textAlign: 'center' }}>Wallet</div>
                    <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)', background: 'var(--bg3)', borderRadius: 10, marginBottom: 12, wordBreak: 'break-all', textAlign: 'center' }}>{address}</div>
                    <button onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false) }} style={{ width: '100%', padding: '14px', background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 15, borderRadius: 12, cursor: 'pointer', marginBottom: 8, fontFamily: 'var(--sans)', fontWeight: 600 }}>
                  Copy Address
                      </button>
                <a href={`https://monadscan.io/address/${address}`} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '14px', background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t1)', fontSize: 15, borderRadius: 12, textAlign: 'center', marginBottom: 8, fontWeight: 600 }} onClick={() => setShowMenu(false)}>
                  View on Monadscan ↗
                      </a>
                <button onClick={() => { disconnect(); setShowMenu(false) }} style={{ width: '100%', padding: '14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--r)', fontSize: 15, borderRadius: 12, cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 700 }}>
                  Disconnect
                      </button>
                      </div>
            ) : (
                              /* Desktop dropdown */
                              <div className="wallet-menu-desktop" style={{ position: 'absolute', top: '44px', right: 0, background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 12, padding: 8, minWidth: 200, zIndex: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)', borderBottom: '1px solid var(--bd)', marginBottom: 6, wordBreak: 'break-all' }}>{address}</div>
                <button onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false) }} style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--t2)', fontSize: 13, textAlign: 'left', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                  Copy address
                      </button>
                <a href={`https://monadscan.io/address/${address}`} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '8px 10px', color: 'var(--t2)', fontSize: 13, borderRadius: 8 }} onClick={() => setShowMenu(false)}>
                  View on Monadscan ↗
                      </a>
                <button onClick={() => { disconnect(); setShowMenu(false) }} style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--r)', fontSize: 13, textAlign: 'left', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                  Disconnect
                      </button>
                      </div>
            )}
</>
        )}
</div>
    )
}

  return (
          <>
            <button className="wallet-btn" onClick={() => setShowConnect(s => !s)}>Connect</button>
{showConnect && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowConnect(false)} />
{isMobile ? (
                /* Mobile bottom sheet for connect */
                <div style={{
                  position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
                                  background: 'var(--bg2)', borderRadius: '20px 20px 0 0',
                                  border: '1px solid var(--bd2)', padding: '20px 16px 40px',
                                  boxShadow: '0 -8px 40px rgba(0,0,0,0.7)'
                }}>
                  <div style={{ width: 36, height: 4, background: 'var(--bd2)', borderRadius: 999, margin: '0 auto 16px' }} />
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, textAlign: 'center' }}>Connect Wallet</div>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 16, textAlign: 'center' }}>Choose your wallet to get started</div>

{/* Browser extension / injected wallets */}
{connectors.map(c => (
                    <button key={c.id} onClick={() => { connect({ connector: c }); setShowConnect(false) }} style={{ width: '100%', padding: '16px', marginBottom: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, color: 'var(--t1)', fontSize: 15, fontWeight: 700, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'var(--sans)' }}>
                  <span style={{ fontSize: 28 }}>
{c.id === 'metaMask' ? '🦊' : c.id === 'walletConnect' ? '🔗' : c.id === 'injected' ? '💼' : '🔌'}
</span>
                  <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 400, marginTop: 2 }}>
{c.id === 'injected' ? 'Browser wallet / extension' : 'Connect wallet'}
</div>
    </div>
    </button>
              ))}

{/* MetaMask deep-link for mobile browsers without extension */}
              <button onClick={openMetaMaskDeepLink} style={{ width: '100%', padding: '16px', marginBottom: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, color: 'var(--t1)', fontSize: 15, fontWeight: 700, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'var(--sans)' }}>
                <span style={{ fontSize: 28 }}>🦊</span>
                <div>
                                    <div style={{ fontSize: 15, fontWeight: 700 }}>MetaMask</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 400, marginTop: 2 }}>Open in MetaMask app</div>
                  </div>
                  </button>

{connectors.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 12, padding: '4px 0 8px', marginTop: -4 }}>
                  No browser extension detected
                      </div>
              )}
</div>
          ) : (
                          /* Desktop dropdown */
                          <div className="wallet-menu-desktop" style={{ position: 'fixed', top: 56, right: 16, background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 14, padding: 10, minWidth: 240, zIndex: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2, padding: '4px 6px' }}>Connect Wallet</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10, padding: '0 6px' }}>Choose your wallet</div>
{connectors.map(c => (
                    <button key={c.id} onClick={() => { connect({ connector: c }); setShowConnect(false) }} style={{ width: '100%', padding: '10px 12px', marginBottom: 6, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 10, color: 'var(--t1)', fontSize: 14, fontWeight: 600, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--sans)' }}>
                  <span style={{ fontSize: 20 }}>
{c.id === 'metaMask' ? '🦊' : c.id === 'walletConnect' ? '🔗' : c.id === 'injected' ? '💼' : '🔌'}
</span>
                  <div>
                        <div>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400 }}>
{c.id === 'injected' ? 'Browser extension' : 'Connect wallet'}
</div>
    </div>
    </button>
              ))}
{connectors.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: 20 }}>
                  No wallets detected. Install MetaMask extension.
                      </div>
              )}
</div>
          )}
</>
      )}
</>
  )
}

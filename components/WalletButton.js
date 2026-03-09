import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useState } from 'react'
import { fmtAddr, fmtMON } from '../lib/constants'
import { monad } from '../lib/wagmi'

export default function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address, chainId: monad.id })
  const [showMenu, setShowMenu] = useState(false)

  if (isConnected && address) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          className="wallet-btn connected"
          onClick={() => setShowMenu(s => !s)}
        >
          {balance ? `${Number(balance.formatted).toFixed(2)} MON` : fmtAddr(address)}
        </button>
        {showMenu && (
          <div style={{
            position: 'absolute', top: '44px', right: 0,
            background: 'var(--bg2)', border: '1px solid var(--bd2)',
            borderRadius: '12px', padding: '8px',
            minWidth: '180px', zIndex: 300,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--mono)', borderBottom: '1px solid var(--bd)', marginBottom: '6px' }}>
              {fmtAddr(address)}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false) }}
              style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--t2)', fontSize: '13px', textAlign: 'left', borderRadius: '8px', cursor: 'pointer' }}
            >
              Copy address
            </button>
            <a
              href={`https://monadscan.io/address/${address}`}
              target="_blank" rel="noreferrer"
              style={{ display: 'block', padding: '8px 10px', color: 'var(--t2)', fontSize: '13px', borderRadius: '8px' }}
              onClick={() => setShowMenu(false)}
            >
              View on Monadscan ↗
            </a>
            <button
              onClick={() => { disconnect(); setShowMenu(false) }}
              style={{ width: '100%', padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--r)', fontSize: '13px', textAlign: 'left', borderRadius: '8px', cursor: 'pointer' }}
            >
              Disconnect
            </button>
          </div>
        )}
        {showMenu && <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />}
      </div>
    )
  }

  return (
    <ConnectMenu connectors={connectors} connect={connect} />
  )
}

function ConnectMenu({ connectors, connect }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button className="wallet-btn" onClick={() => setOpen(s => !s)}>
        Connect
      </button>
      {open && (
        <>
          <div style={{
            position: 'absolute', top: '44px', right: 0,
            background: 'var(--bg2)', border: '1px solid var(--bd2)',
            borderRadius: '12px', padding: '8px',
            minWidth: '200px', zIndex: 300,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '6px 10px 10px', fontSize: '12px', fontWeight: 700, color: 'var(--t2)' }}>
              Connect Wallet
            </div>
            {connectors.map(c => (
              <button
                key={c.id}
                onClick={() => { connect({ connector: c }); setOpen(false) }}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'var(--bg3)', border: '1px solid var(--bd)',
                  borderRadius: '10px', color: 'var(--t1)',
                  fontSize: '14px', fontWeight: 600,
                  textAlign: 'left', cursor: 'pointer',
                  marginBottom: '6px', display: 'flex',
                  alignItems: 'center', gap: '8px',
                  fontFamily: 'var(--sans)'
                }}
              >
                <span style={{ fontSize: '18px' }}>
                  {c.id === 'metaMask' ? '🦊' : c.id === 'walletConnect' ? '🔗' : '💼'}
                </span>
                {c.name}
              </button>
            ))}
          </div>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
        </>
      )}
    </div>
  )
}
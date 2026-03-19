import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useState } from 'react'
import { fmtAddr } from '../lib/constants'
import { monad } from '../lib/wagmi'

export default function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors }  = useConnect()
  const { disconnect }           = useDisconnect()
  const { data: balance }        = useBalance({ address, chainId: monad.id })
  const [showMenu, setShowMenu]  = useState(false)
  const [showConnect, setShowConnect] = useState(false)

  if (isConnected && address) {
    return (
      <div style={{ position:'relative' }}>
        <button className="wallet-btn connected" onClick={() => setShowMenu(s => !s)}>
          {balance ? `${Number(balance.formatted).toFixed(2)} MON` : fmtAddr(address)}
        </button>
        {showMenu && (
          <>
            <div style={{ position:'fixed', inset:0, zIndex:299 }} onClick={() => setShowMenu(false)} />
            {/* desktop dropdown */}
            <div className="wallet-menu-desktop" style={{ position:'absolute', top:'44px', right:0, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:12, padding:8, minWidth:200, zIndex:300, boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }}>
              <div style={{ padding:'6px 10px', fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)', borderBottom:'1px solid var(--bd)', marginBottom:6, wordBreak:'break-all' }}>{address}</div>
              <button onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false) }}
                style={{ width:'100%', padding:'8px 10px', background:'transparent', border:'none', color:'var(--t2)', fontSize:13, textAlign:'left', borderRadius:8, cursor:'pointer', fontFamily:'var(--sans)' }}>Copy address</button>
              <a href={`https://monadscan.io/address/${address}`} target="_blank" rel="noreferrer"
                style={{ display:'block', padding:'8px 10px', color:'var(--t2)', fontSize:13, borderRadius:8 }} onClick={() => setShowMenu(false)}>View on Monadscan ↗</a>
              <button onClick={() => { disconnect(); setShowMenu(false) }}
                style={{ width:'100%', padding:'8px 10px', background:'transparent', border:'none', color:'var(--r)', fontSize:13, textAlign:'left', borderRadius:8, cursor:'pointer', fontFamily:'var(--sans)' }}>Disconnect</button>
            </div>
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
          <div style={{ position:'fixed', inset:0, zIndex:299 }} onClick={() => setShowConnect(false)} />
          {/* desktop dropdown */}
          <div className="wallet-menu-desktop" style={{ position:'fixed', top:56, right:16, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:14, padding:10, minWidth:240, zIndex:300, boxShadow:'0 8px 32px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize:14, fontWeight:800, marginBottom:2, padding:'4px 6px' }}>Connect Wallet</div>
            <div style={{ fontSize:12, color:'var(--t3)', marginBottom:10, padding:'0 6px' }}>Choose your wallet</div>
            {connectors.map(c => (
              <button key={c.id} onClick={() => { connect({ connector: c }); setShowConnect(false) }}
                style={{ width:'100%', padding:'10px 12px', marginBottom:6, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:10, color:'var(--t1)', fontSize:14, fontWeight:600, textAlign:'left', cursor:'pointer', display:'flex', alignItems:'center', gap:10, fontFamily:'var(--sans)' }}>
                <span style={{ fontSize:20 }}>{c.id==='metaMask'?'🦊':c.id==='walletConnect'?'🔗':c.id==='injected'?'💼':'🔌'}</span>
                <div>
                  <div>{c.name}</div>
                  <div style={{ fontSize:11, color:'var(--t3)', fontWeight:400 }}>{c.id==='walletConnect'?'Scan QR with any wallet':c.id==='injected'?'Browser extension':'Mobile & extension'}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

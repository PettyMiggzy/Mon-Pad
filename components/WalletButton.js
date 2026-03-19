import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { useState } from 'react'
import { fmtAddr, fmtMON } from '../lib/constants'
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
      <div style={{ position: 'relative' }}>
        <button className="wallet-btn connected" onClick={() => setShowMenu(s => !s)}>
          {balance ? `${Number(balance.formatted).toFixed(2)} MON` : fmtAddr(address)}
        </button>
        {showMenu && (
          <>
            <div style={{ position:'fixed', inset:0, zIndex:299, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowMenu(false)} />
            <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:'20px 20px 0 0', padding:'20px 16px 36px', zIndex:300, boxShadow:'0 -8px 32px rgba(0,0,0,0.5)' }}>
              <div style={{ width:36, height:4, background:'var(--bd2)', borderRadius:99, margin:'0 auto 20px' }} />
              <div style={{ fontSize:12, color:'var(--t3)', fontFamily:'var(--mono)', marginBottom:16, textAlign:'center', wordBreak:'break-all' }}>{address}</div>
              <button onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false) }}
                style={{ width:'100%', padding:14, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:12, color:'var(--t1)', fontSize:15, fontWeight:600, marginBottom:8, cursor:'pointer', fontFamily:'var(--sans)' }}>
                Copy Address
              </button>
              <a href={`https://monadscan.io/address/${address}`} target="_blank" rel="noreferrer"
                style={{ display:'block', padding:14, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:12, color:'var(--t1)', fontSize:15, fontWeight:600, marginBottom:8, textAlign:'center', textDecoration:'none' }}
                onClick={() => setShowMenu(false)}>
                View on Monadscan ↗
              </a>
              <button onClick={() => { disconnect(); setShowMenu(false) }}
                style={{ width:'100%', padding:14, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:12, color:'var(--r)', fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'var(--sans)' }}>
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <button className="wallet-btn" onClick={() => setShowConnect(true)}>Connect</button>
      {showConnect && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:299, background:'rgba(0,0,0,0.6)' }} onClick={() => setShowConnect(false)} />
          <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'var(--bg2)', border:'1px solid var(--bd2)', borderRadius:'20px 20px 0 0', padding:'20px 16px 40px', zIndex:300, boxShadow:'0 -8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ width:36, height:4, background:'var(--bd2)', borderRadius:99, margin:'0 auto 20px' }} />
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4, textAlign:'center' }}>Connect Wallet</div>
            <div style={{ fontSize:12, color:'var(--t3)', marginBottom:20, textAlign:'center' }}>Choose your wallet to get started</div>
            {connectors.map(c => (
              <button key={c.id} onClick={() => { connect({ connector: c }); setShowConnect(false) }}
                style={{ width:'100%', padding:16, marginBottom:10, background:'var(--bg3)', border:'1px solid var(--bd)', borderRadius:14, color:'var(--t1)', fontSize:16, fontWeight:600, textAlign:'left', cursor:'pointer', display:'flex', alignItems:'center', gap:12, fontFamily:'var(--sans)' }}>
                <span style={{ fontSize:24 }}>
                  {c.id==='metaMask'?'🦊':c.id==='walletConnect'?'🔗':c.id==='injected'?'💼':'🔌'}
                </span>
                <div>
                  <div>{c.name}</div>
                  <div style={{ fontSize:12, color:'var(--t3)', fontWeight:400, marginTop:2 }}>
                    {c.id==='walletConnect'?'Scan QR with any wallet':c.id==='injected'?'Browser extension':'Mobile & extension'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

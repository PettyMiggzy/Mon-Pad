import { useState, useEffect } from 'react'
import { useAccount, useBalance, usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { useRouter } from 'next/router'
import Layout from '../components/Layout'
import { FACTORY_ADDRESS, CURVE_ABI, TOKEN_ABI, START_BLOCK, fmtMON, fmtAddr, fmtTokens } from '../lib/constants'
import { monad } from '../lib/wagmi'

export default function Portfolio() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({ address, chainId: monad.id })
  const client = usePublicClient({ chainId: monad.id })

  const [holdings, setHoldings] = useState([])
  const [trades, setTrades]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [tab, setTab]           = useState('Holdings')

  useEffect(() => { if (address && client) load() }, [address, client])

  async function load() {
    setLoading(true)
    try {
      const launchLogs = await client.getLogs({
        address: FACTORY_ADDRESS,
        event: parseAbiItem('event Launched(address indexed token, address indexed curve, address indexed graduator, address creator)'),
        fromBlock: START_BLOCK, toBlock: 'latest',
      })

      const myHoldings = []
      const myTrades = []

      await Promise.all(launchLogs.map(async log => {
        const { token, curve } = log.args
        try {
          const [bal, name, symbol, graduated, priceWei] = await Promise.all([
            client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [address] }),
            client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'name' }),
            client.readContract({ address: token, abi: TOKEN_ABI, functionName: 'symbol' }),
            client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'graduated' }),
            client.readContract({ address: curve, abi: CURVE_ABI, functionName: 'priceWeiPerToken' }),
          ])

          if (bal > 0n) {
            const value = (bal * priceWei) / (10n ** 18n)
            myHoldings.push({ token, curve, name, symbol, bal, value, graduated })
          }

          // get my trades on this curve
          const [buyLogs, sellLogs] = await Promise.all([
            client.getLogs({ address: curve, event: parseAbiItem('event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)'), args: { buyer: address }, fromBlock: START_BLOCK, toBlock: 'latest' }),
            client.getLogs({ address: curve, event: parseAbiItem('event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)'), args: { seller: address }, fromBlock: START_BLOCK, toBlock: 'latest' }),
          ])

          for (const l of buyLogs)  myTrades.push({ type: 'buy',  token, name, symbol, mon: l.args.monIn,  tokens: l.args.tokensOut, block: l.blockNumber })
          for (const l of sellLogs) myTrades.push({ type: 'sell', token, name, symbol, mon: l.args.monOut, tokens: l.args.tokensIn,  block: l.blockNumber })
        } catch {}
      }))

      myTrades.sort((a, b) => Number(b.block) - Number(a.block))
      setHoldings(myHoldings)
      setTrades(myTrades)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const totalValue = holdings.reduce((s, h) => s + Number(h.value), 0)
  const totalSpent = trades.filter(t => t.type === 'buy').reduce((s, t) => s + Number(t.mon), 0)
  const totalReceived = trades.filter(t => t.type === 'sell').reduce((s, t) => s + Number(t.mon), 0)
  const pnl = totalReceived - totalSpent + totalValue
  const pnlPct = totalSpent > 0 ? ((pnl / totalSpent) * 100) : 0

  if (!isConnected) return (
    <Layout title="Portfolio">
      <div style={{ padding: '80px 14px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💼</div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Connect your wallet</div>
        <div style={{ fontSize: 13, color: 'var(--t3)' }}>Connect to view your MonPad portfolio</div>
      </div>
    </Layout>
  )

  return (
    <Layout title="Portfolio">
      {/* WALLET INFO */}
      <div style={{ padding: '16px 14px 0' }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 14, padding: '16px' }}>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)', marginBottom: 4 }}>{fmtAddr(address)}</div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.5px', marginBottom: 2 }}>
            {balance ? `${Number(balance.formatted).toFixed(4)} MON` : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>Wallet balance</div>
        </div>
      </div>

      {/* PNL CARD */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 14px 0' }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 6 }}>Token Value</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)' }}>{fmtMON(BigInt(Math.floor(totalValue)))} MON</div>
        </div>
        <div style={{ background: pnl >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 6 }}>P&L</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono)', color: pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
            {pnl >= 0 ? '+' : ''}{(pnl / 1e18).toFixed(2)} MON
          </div>
          <div style={{ fontSize: 11, color: pnl >= 0 ? 'var(--g)' : 'var(--r)', marginTop: 2 }}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', margin: '16px 14px 0' }}>
        {['Holdings', 'Trades'].map(t => (
          <div key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '12px 0', textAlign: 'center', fontSize: 13, fontWeight: 700, color: tab === t ? 'var(--t1)' : 'var(--t3)', cursor: 'pointer', borderBottom: tab === t ? '2px solid var(--p)' : '2px solid transparent', marginBottom: -1 }}>
            {t} {t === 'Holdings' && holdings.length > 0 && `(${holdings.length})`}
            {t === 'Trades' && trades.length > 0 && `(${trades.length})`}
          </div>
        ))}
      </div>

      {loading && <div style={{ padding: '40px 14px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Loading…</div>}

      {/* HOLDINGS */}
      {!loading && tab === 'Holdings' && (
        <div style={{ padding: '0 14px' }}>
          {holdings.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🌱</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No holdings yet</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Buy tokens on MonPad to see them here</div>
              <button className="btn-primary" style={{ padding: '10px 24px' }} onClick={() => router.push('/')}>Browse Tokens</button>
            </div>
          )}
          {holdings.map(h => (
            <div key={h.token} onClick={() => router.push(`/token/${h.token}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'radial-gradient(circle at 35% 35%,#3b1d9e,#120830)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: 'rgba(255,255,255,0.12)', flexShrink: 0 }}>
                {(h.symbol || '?').slice(0, 2)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{h.name}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>{fmtTokens(h.bal)} {h.symbol} {h.graduated ? '· 🎓' : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono)' }}>~{fmtMON(h.value)} MON</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>est. value</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TRADES */}
      {!loading && tab === 'Trades' && (
        <div style={{ padding: '0 14px' }}>
          {trades.length === 0 && <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No trades yet</div>}
          {trades.map((t, i) => (
            <div key={i} onClick={() => router.push(`/token/${t.token}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
              <div style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 5, background: t.type === 'buy' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: t.type === 'buy' ? 'var(--g)' : 'var(--r)', flexShrink: 0 }}>
                {t.type.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>{fmtTokens(t.tokens)} {t.symbol}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--mono)', color: t.type === 'buy' ? 'var(--r)' : 'var(--g)' }}>
                {t.type === 'buy' ? '-' : '+'}{fmtMON(t.mon)} MON
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
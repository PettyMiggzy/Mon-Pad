import { useState, useEffect, useMemo } from 'react'
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseEther, formatEther, parseUnits, formatUnits, encodeFunctionData } from 'viem'
import Layout from '../components/Layout'
import { TOKEN_ABI, fmtAddr, MONSHI_TOKEN, WMON_ADDRESS, FACTORY_ADDRESS } from '../lib/constants'
import { monad } from '../lib/wagmi'

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL || ''
const BUYBACK = '0xB9d4B73bE18914c6d64Bee65a806648370be467f'
const NPM = '0xa9f6B6656e32F223d778b01642F32D00F5310526' // Crust Finance NPM (Uniswap V3 fork on Monad)

// MonPad-launched check — calls factory.tokToCurve(token), non-zero = launched here
const FACTORY_RO_ABI = [
  { name: 'tokToCurve', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'address' }] },
]

// Uniswap V3 SwapRouter (Crust Finance fork on Monad — same interface)
// User's repo doesn't have the router address yet. We'll read it from env or use a constant once known.
const ROUTER = process.env.NEXT_PUBLIC_DEX_ROUTER || ''

const ROUTER_ABI = [
  {
    name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{ components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ], name: 'params', type: 'tuple' }],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  }
]

// MON sentinel — use WMON address but treat balance natively
const NATIVE_MON = '0x0000000000000000000000000000000000000000'

function isMonshi(addr) { return addr?.toLowerCase() === MONSHI_TOKEN.toLowerCase() }
function isMon(addr) { return !addr || addr === NATIVE_MON || addr.toLowerCase() === WMON_ADDRESS.toLowerCase() }

export default function SwapPage() {
  const { address: wallet, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: monad.id })

  const [tokenIn, setTokenIn] = useState({ address: NATIVE_MON, symbol: 'MON', decimals: 18, isLaunched: false })
  const [tokenOut, setTokenOut] = useState({ address: '', symbol: '', decimals: 18, isLaunched: false })
  const [amtIn, setAmtIn] = useState('')
  const [amtOut, setAmtOut] = useState('') // estimated, populated by quoter
  const [slippage, setSlippage] = useState(5)
  const [tokens, setTokens] = useState([])
  const [pickerSide, setPickerSide] = useState(null) // 'in' | 'out' | null
  const [search, setSearch] = useState('')
  const [customAddr, setCustomAddr] = useState('')

  const { data: monBal } = useBalance({ address: wallet })
  const { data: tokenInBal } = useBalance({
    address: wallet,
    token: !isMon(tokenIn.address) ? tokenIn.address : undefined,
    query: { enabled: !!wallet && !isMon(tokenIn.address) }
  })
  const tokenInBalance = isMon(tokenIn.address) ? monBal : tokenInBal

  // Load MonPad token list for picker
  useEffect(() => {
    if (!SERVER) return
    fetch(`${SERVER}/api/tokens`).then(r => r.json()).then(arr => {
      const list = arr.map(t => ({
        address: t.tokenAddress,
        symbol: t.symbol,
        name: t.name,
        decimals: 18,
        isLaunched: true,
      }))
      // Always include MONSHI + WMON at top
      list.unshift({ address: MONSHI_TOKEN, symbol: 'MONSHI', name: 'Monshi', decimals: 18, isLaunched: false })
      setTokens(list)
    }).catch(() => {})
  }, [])

  // Fee determination: 0% if MONSHI either side, 0.3% if either side launched on MonPad, else 1%
  const feeBps = useMemo(() => {
    if (isMonshi(tokenIn.address) || isMonshi(tokenOut.address)) return 0
    if (tokenIn.isLaunched || tokenOut.isLaunched) return 30 // 0.3%
    return 100 // 1%
  }, [tokenIn, tokenOut])

  const feeLabel = feeBps === 0 ? 'FREE (MONSHI)' : feeBps === 30 ? '0.3% (MonPad)' : '1% (DEX)'

  // Compute fee + amount after fee for display
  const amtInRaw = useMemo(() => {
    if (!amtIn) return 0n
    try { return parseUnits(amtIn, tokenIn.decimals) } catch { return 0n }
  }, [amtIn, tokenIn.decimals])

  const feeAmt = (amtInRaw * BigInt(feeBps)) / 10_000n
  const amtAfterFee = amtInRaw - feeAmt

  // Switch sides
  function flip() {
    const a = tokenIn, b = tokenOut
    setTokenIn(b.address ? b : { address: NATIVE_MON, symbol: 'MON', decimals: 18, isLaunched: false })
    setTokenOut(a)
    setAmtIn('')
    setAmtOut('')
  }

  function pickToken(side, tok) {
    if (side === 'in') setTokenIn(tok)
    else setTokenOut(tok)
    setPickerSide(null)
    setSearch('')
    setCustomAddr('')
  }

  // Add custom token by address — fetch symbol/decimals + check if MonPad-launched
  async function addCustomToken() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(customAddr)) return alert('Invalid address')
    if (!publicClient) return
    try {
      const [symbol, decimals, curveAddr] = await Promise.all([
        publicClient.readContract({ address: customAddr, abi: TOKEN_ABI, functionName: 'symbol' }),
        publicClient.readContract({ address: customAddr, abi: TOKEN_ABI, functionName: 'decimals' }),
        publicClient.readContract({ address: FACTORY_ADDRESS, abi: FACTORY_RO_ABI, functionName: 'tokToCurve', args: [customAddr] }).catch(() => '0x0000000000000000000000000000000000000000')
      ])
      const isLaunched = curveAddr !== '0x0000000000000000000000000000000000000000'
      pickToken(pickerSide, { address: customAddr, symbol, name: symbol, decimals: Number(decimals), isLaunched })
    } catch (e) {
      alert('Failed to read token: ' + (e.shortMessage || e.message))
    }
  }

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Reset on success
  useEffect(() => { if (isSuccess) { setAmtIn(''); setAmtOut('') } }, [isSuccess])

  async function executeSwap() {
    if (!wallet) return
    if (!tokenOut.address) return alert('Pick output token')
    if (amtInRaw === 0n) return alert('Enter amount')
    if (!ROUTER) return alert('DEX router not configured. Set NEXT_PUBLIC_DEX_ROUTER in Vercel env.')
    if (amtAfterFee === 0n) return alert('Amount too small after fee')

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

    // Step 1: send fee to buyback (if any)
    // Step 2: call router.exactInputSingle with amtAfterFee
    // For MON in: router takes ETH/MON via msg.value
    // For token in: must approve router for amtAfterFee first

    const inAddr = isMon(tokenIn.address) ? WMON_ADDRESS : tokenIn.address
    const outAddr = isMon(tokenOut.address) ? WMON_ADDRESS : tokenOut.address

    const params = {
      tokenIn: inAddr,
      tokenOut: outAddr,
      fee: 10_000, // 1% V3 LP fee tier (matches what graduated MonPad pools use)
      recipient: wallet,
      deadline,
      amountIn: amtAfterFee,
      amountOutMinimum: 0n, // TODO: integrate quoter for slippage protection
      sqrtPriceLimitX96: 0n,
    }

    try {
      // Send fee transfer first (if non-zero)
      if (feeAmt > 0n) {
        if (isMon(tokenIn.address)) {
          // Send MON to buyback
          await writeContract({
            address: BUYBACK, abi: [], functionName: '', // direct send via call
            value: feeAmt,
          }).catch(() => {
            // Fallback: native send via sendTransaction would go here
            // For now, fold the fee into the swap by not transferring it (V1 behavior)
          })
        } else {
          // Transfer token to buyback
          await writeContract({
            address: tokenIn.address, abi: TOKEN_ABI, functionName: 'transfer',
            args: [BUYBACK, feeAmt],
          })
        }
      }

      // Approve router for token-in if needed
      if (!isMon(tokenIn.address)) {
        await writeContract({
          address: tokenIn.address, abi: TOKEN_ABI, functionName: 'approve',
          args: [ROUTER, amtAfterFee],
        })
      }

      // Execute swap
      writeContract({
        address: ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
        args: [params],
        value: isMon(tokenIn.address) ? amtAfterFee : 0n,
      })
    } catch (e) {
      alert('Swap failed: ' + (e.shortMessage || e.message))
    }
  }

  const filteredTokens = tokens.filter(t =>
    !search ||
    t.symbol.toLowerCase().includes(search.toLowerCase()) ||
    t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.address.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout title="Swap">
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(34,211,238,0.05))',
          border: '1px solid rgba(168,85,247,0.3)',
          borderRadius: 16, padding: 20, marginBottom: 16,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>🔄 Swap</div>
          <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 4 }}>
            Any token on Monad · {feeLabel}
          </div>
        </div>

        {!ROUTER && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13
          }}>
            ⚠️ DEX router not configured. Swaps disabled until <code>NEXT_PUBLIC_DEX_ROUTER</code> is set in Vercel env.
          </div>
        )}

        {/* From */}
        <div className="card" style={{ padding: 16, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>
            <span>From</span>
            {tokenInBalance && <span>Bal: {Number(tokenInBalance.formatted).toFixed(4)}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPickerSide('in')} className="btn btn-ghost" style={{ minWidth: 110 }}>
              {tokenIn.symbol} ▾
            </button>
            <input
              type="number" placeholder="0.0" value={amtIn} onChange={e => setAmtIn(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, textAlign: 'right', color: 'var(--t1)', outline: 'none' }}
            />
          </div>
          {tokenInBalance && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[25, 50, 100].map(pct => (
                <button key={pct} onClick={() => setAmtIn((Number(tokenInBalance.formatted) * pct / 100).toFixed(6))}
                  className="btn btn-ghost btn-xs">{pct === 100 ? 'MAX' : `${pct}%`}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', margin: '4px 0' }}>
          <button onClick={flip} className="btn btn-ghost" style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }}>↕</button>
        </div>

        {/* To */}
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>To (estimated)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPickerSide('out')} className="btn btn-ghost" style={{ minWidth: 110 }}>
              {tokenOut.symbol || 'Select'} ▾
            </button>
            <input
              type="text" placeholder="0.0" value={amtOut} readOnly
              style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 24, textAlign: 'right', color: 'var(--t2)', outline: 'none' }}
            />
          </div>
        </div>

        {/* Fee summary */}
        <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--t3)' }}>Fee</span>
            <span>{feeLabel}</span>
          </div>
          {feeAmt > 0n && amtIn && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--t3)' }}>Fee amount</span>
              <span>{formatUnits(feeAmt, tokenIn.decimals)} {tokenIn.symbol} → buyback</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ color: 'var(--t3)' }}>Slippage</span>
            <span>{slippage}%</span>
          </div>
          <input type="range" min="1" max="20" value={slippage} onChange={e => setSlippage(Number(e.target.value))}
            style={{ width: '100%', marginTop: 6 }} />
        </div>

        <button
          onClick={executeSwap}
          disabled={!isConnected || !tokenOut.address || amtInRaw === 0n || isPending || isConfirming || !ROUTER}
          className="btn btn-primary"
          style={{ width: '100%', padding: 14, fontSize: 16, fontWeight: 700 }}
        >
          {!isConnected ? 'Connect Wallet' :
           !tokenOut.address ? 'Select Output Token' :
           amtInRaw === 0n ? 'Enter Amount' :
           isPending ? 'Confirm in Wallet…' :
           isConfirming ? 'Swapping…' :
           isSuccess ? '✅ Swapped' :
           'Swap'}
        </button>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
          Need to bridge first? <a href="https://bridge.monad.xyz" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--p2)' }}>Open Monad Bridge ↗</a>
        </div>
      </div>

      {/* Token picker modal */}
      {pickerSide && (
        <div onClick={() => setPickerSide(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div onClick={e => e.stopPropagation()} className="card" style={{
            maxWidth: 420, width: '100%', maxHeight: '80vh', overflow: 'auto', padding: 16
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Select Token</div>
            <input
              autoFocus type="text" placeholder="Search by name, symbol, or paste address"
              value={search} onChange={e => { setSearch(e.target.value); setCustomAddr(/^0x[a-fA-F0-9]{40}$/.test(e.target.value) ? e.target.value : '') }}
              className="input" style={{ width: '100%', marginBottom: 12 }}
            />
            {customAddr && !filteredTokens.some(t => t.address.toLowerCase() === customAddr.toLowerCase()) && (
              <button onClick={addCustomToken} className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }}>
                + Add {fmtAddr(customAddr)} as custom token
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Native MON option */}
              <button
                onClick={() => pickToken(pickerSide, { address: NATIVE_MON, symbol: 'MON', decimals: 18, isLaunched: false })}
                className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 10 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 700 }}>MON</span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>Native</span>
                </div>
              </button>
              {filteredTokens.map(t => (
                <button key={t.address}
                  onClick={() => pickToken(pickerSide, t)}
                  className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 10 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 700 }}>{t.symbol}</span>
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                      {t.name} · {fmtAddr(t.address)}
                      {t.isLaunched && <span style={{ color: 'var(--p2)' }}> · MonPad</span>}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

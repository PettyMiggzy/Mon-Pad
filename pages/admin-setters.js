import { useState, useEffect, useMemo } from 'react'
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import Layout from '../components/Layout'
import { FACTORY_V2 as FACTORY_V2_ENV } from '../lib/constants'
// Hard-coded fallback to the on-chain-verified V2 factory address (Phase 1 verification).
// This page is an admin one-shot -- we don't want behavior to depend on env config.
const FACTORY_V2 = (FACTORY_V2_ENV && FACTORY_V2_ENV.length === 42) ? FACTORY_V2_ENV : '0x0ec606736125499D7daFaf0B286cC1375592569C'
import { monad } from '../lib/wagmi'

// V2 expected admin & spec values (from Phase 1 / 1.5 verification)
const EXPECTED_OWNER = '0xB9d4B73bE18914c6d64Bee65a806648370be467f'
const NEW_CREATION_FEE = parseEther('100')          // 100 MON
const NEW_GRADUATION_TARGET = parseEther('425000')  // 425,000 MON

// Subset ABI containing only the calls this page needs.
// We resolve from FACTORY_ABI when possible, but fall back to inline so this works
// even if the imported ABI shape changes.
const SETTER_ABI = [
  { type:'function', name:'owner',              stateMutability:'view',       inputs:[], outputs:[{type:'address'}] },
  { type:'function', name:'creationFee',        stateMutability:'view',       inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'graduationTarget',   stateMutability:'view',       inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'setCreationFee',     stateMutability:'nonpayable', inputs:[{name:'v', type:'uint256'}], outputs:[] },
  { type:'function', name:'setGraduationTarget',stateMutability:'nonpayable', inputs:[{name:'v', type:'uint256'}], outputs:[] },
]

function Row({ label, current, target, onClick, busy, disabled }) {
  const matches = current !== undefined && current === target
  return (
    <div style={{ border:'1px solid #333', borderRadius:8, padding:16, marginBottom:16 }}>
      <div style={{ marginBottom:8, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:14, opacity:0.85, marginBottom:4 }}>
        Current: <b>{current === undefined ? '…' : `${formatEther(current)} MON`}</b>
      </div>
      <div style={{ fontSize:14, opacity:0.85, marginBottom:12 }}>
        Target:  <b>{formatEther(target)} MON</b> {matches && <span style={{ color:'#4ade80' }}>✓ already at target</span>}
      </div>
      <button
        onClick={onClick}
        disabled={disabled || busy || matches}
        style={{
          padding:'10px 16px',
          background: matches ? '#22aa55' : (disabled ? '#444' : '#7c3aed'),
          color:'#fff', border:'none', borderRadius:6,
          cursor: (disabled || busy || matches) ? 'not-allowed' : 'pointer',
          fontWeight:600,
        }}
      >
        {busy ? 'Pending…' : (matches ? 'Already correct' : `Set to ${formatEther(target)} MON`)}
      </button>
    </div>
  )
}

export default function AdminSetters() {
  const { address, isConnected, chain } = useAccount()
  const wrongChain = isConnected && chain && chain.id !== monad.id

  // Read current values
  const { data: reads, refetch: refetchReads } = useReadContracts({
    contracts: [
      { address: FACTORY_V2, abi: SETTER_ABI, functionName: 'owner' },
      { address: FACTORY_V2, abi: SETTER_ABI, functionName: 'creationFee' },
      { address: FACTORY_V2, abi: SETTER_ABI, functionName: 'graduationTarget' },
    ],
    query: { refetchInterval: 8000 },
  })
  const owner = reads?.[0]?.result
  const currentCreationFee = reads?.[1]?.result
  const currentGradTarget  = reads?.[2]?.result

  const isOwner = isConnected && owner && address && owner.toLowerCase() === address.toLowerCase()

  // Track which tx is in flight so we only show pending state on the right button
  const [activeTx, setActiveTx] = useState(null) // 'fee' | 'target' | null
  const { writeContract, data: txHash, isPending: isWriting, error: writeErr, reset: resetWrite } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptErr } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (isConfirmed) {
      refetchReads()
      setActiveTx(null)
      // small delay then reset so user can click again
      const t = setTimeout(() => resetWrite(), 1500)
      return () => clearTimeout(t)
    }
  }, [isConfirmed, refetchReads, resetWrite])

  function send(which) {
    setActiveTx(which)
    if (which === 'fee') {
      writeContract({
        address: FACTORY_V2,
        abi: SETTER_ABI,
        functionName: 'setCreationFee',
        args: [NEW_CREATION_FEE],
        chainId: monad.id,
      })
    } else if (which === 'target') {
      writeContract({
        address: FACTORY_V2,
        abi: SETTER_ABI,
        functionName: 'setGraduationTarget',
        args: [NEW_GRADUATION_TARGET],
        chainId: monad.id,
      })
    }
  }

  const status = useMemo(() => {
    if (writeErr)   return { kind:'err', msg: writeErr.shortMessage || writeErr.message }
    if (receiptErr) return { kind:'err', msg: receiptErr.shortMessage || receiptErr.message }
    if (isWriting)  return { kind:'info', msg:'Awaiting wallet signature…' }
    if (isConfirming) return { kind:'info', msg:`Submitted: ${txHash?.slice(0,10)}…  waiting for confirmation` }
    if (isConfirmed)  return { kind:'ok',   msg:`Confirmed: ${txHash?.slice(0,10)}…  reading new values` }
    return null
  }, [writeErr, receiptErr, isWriting, isConfirming, isConfirmed, txHash])

  return (
    <Layout title="Admin · Setters">
      <div style={{ maxWidth:560, margin:'40px auto', padding:24 }}>
        <h1 style={{ marginTop:0 }}>V2 Factory Setters</h1>
        <p style={{ opacity:0.85, fontSize:14, lineHeight:1.5 }}>
          One-shot admin tool. Connect King's wallet, then click each button to push the spec values.
          The page reads current values from chain and re-reads after each tx confirms.
        </p>

        <div style={{ fontSize:13, opacity:0.7, marginBottom:8 }}>
          Factory: <code>{FACTORY_V2}</code>
        </div>
        <div style={{ fontSize:13, opacity:0.7, marginBottom:8 }}>
          Owner on-chain: <code>{owner || '…'}</code>
        </div>
        <div style={{ fontSize:13, opacity:0.7, marginBottom:16 }}>
          You: <code>{address || '(not connected)'}</code>
          {isConnected && (isOwner
            ? <span style={{ color:'#4ade80', marginLeft:8 }}>✓ owner</span>
            : <span style={{ color:'#f87171', marginLeft:8 }}>✗ not the owner — txs will revert</span>)}
        </div>

        {!isConnected && (
          <div style={{ padding:12, background:'#222', borderRadius:6, marginBottom:16 }}>
            Connect a wallet from the header (the rest of the app's Connect button works here too).
          </div>
        )}
        {wrongChain && (
          <div style={{ padding:12, background:'#542', borderRadius:6, marginBottom:16 }}>
            Wrong network — please switch to Monad (chainId {monad.id}). Current: {chain?.name} ({chain?.id})
          </div>
        )}

        <Row
          label="creationFee"
          current={currentCreationFee}
          target={NEW_CREATION_FEE}
          busy={activeTx === 'fee' && (isWriting || isConfirming)}
          disabled={!isConnected || wrongChain || !isOwner || (activeTx && activeTx !== 'fee' && (isWriting || isConfirming))}
          onClick={() => send('fee')}
        />
        <Row
          label="graduationTarget"
          current={currentGradTarget}
          target={NEW_GRADUATION_TARGET}
          busy={activeTx === 'target' && (isWriting || isConfirming)}
          disabled={!isConnected || wrongChain || !isOwner || (activeTx && activeTx !== 'target' && (isWriting || isConfirming))}
          onClick={() => send('target')}
        />

        {status && (
          <div style={{
            padding:12, borderRadius:6, marginTop:16,
            background: status.kind === 'err' ? '#5a1f1f' : status.kind === 'ok' ? '#1f4a2a' : '#1f2a4a',
            wordBreak:'break-all', fontSize:13,
          }}>
            {status.msg}
          </div>
        )}

        <div style={{ marginTop:24, fontSize:12, opacity:0.6, lineHeight:1.5 }}>
          <div>Spec source of truth (verified on-chain):</div>
          <div>• creationFee: 100 MON (1e20 wei) — selector 0xb7d86225</div>
          <div>• graduationTarget: 425,000 MON (4.25e23 wei) — selector 0x5ae8f06d</div>
          <div>• EXPECTED_OWNER: {EXPECTED_OWNER}</div>
        </div>
      </div>
    </Layout>
  )
}

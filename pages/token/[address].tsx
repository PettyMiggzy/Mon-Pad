import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, type Address } from 'viem';
import { curveV3Abi, tokenAbi } from '@/lib/abis';
import {
  MONAD_EXPLORER, V3_GRADUATION_TARGET_MON,
  V3_BUY_FEE_CREATOR_BPS, V3_BUY_FEE_BUFFER_BPS,
  V3_SELL_FEE_CREATOR_BPS, V3_SELL_FEE_STAKING_BPS, V3_SELL_FEE_PLATFORM_BPS,
} from '@/lib/constants';

const SUPPLY = 1_000_000_000n * 10n ** 18n;
const GRAD_TARGET = V3_GRADUATION_TARGET_MON * 10n ** 18n;
const BUY_FEE_BASE = BigInt(V3_BUY_FEE_CREATOR_BPS + V3_BUY_FEE_BUFFER_BPS);   // 200
const SELL_FEE_BASE = BigInt(V3_SELL_FEE_CREATOR_BPS + V3_SELL_FEE_STAKING_BPS + V3_SELL_FEE_PLATFORM_BPS); // 200

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };
function shortAddr(a?: string) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '?'; }

type Reserves = { vm: bigint; vt: bigint; rm: bigint; rt: bigint };

function curveTokensFor(reserves: Reserves, monForBuy: bigint): bigint {
  const m = reserves.vm + reserves.rm;
  const t = reserves.vt - (SUPPLY - reserves.rt);
  if (t <= 0n || monForBuy <= 0n) return 0n;
  const out = t - (m * t) / (m + monForBuy);
  return out > reserves.rt ? reserves.rt : out;
}
function curveMonFor(reserves: Reserves, tokensIn: bigint): bigint {
  const m = reserves.vm + reserves.rm;
  const t = reserves.vt - (SUPPLY - reserves.rt);
  if (t <= 0n || tokensIn <= 0n) return 0n;
  const k = m * t;
  const gross = m - k / (t + tokensIn);
  return gross > reserves.rm ? reserves.rm : gross;
}

export default function TokenPage() {
  const router = useRouter();
  const addr = (router.query.address as string | undefined)?.toLowerCase() as Address | undefined;
  const { address: wallet } = useAccount();

  // Resolve the per-token curve clone, then read its live state on-chain.
  const curveRead = useReadContract({ address: addr, abi: tokenAbi as any, functionName: 'curve', query: { enabled: !!addr } });
  const curve = curveRead.data as Address | undefined;

  const meta = useReadContracts({
    contracts: addr ? [
      { address: addr, abi: tokenAbi as any, functionName: 'name' },
      { address: addr, abi: tokenAbi as any, functionName: 'symbol' },
    ] : [],
    query: { enabled: !!addr },
  });
  const name = (meta.data?.[0]?.result as string) || 'Token';
  const symbol = (meta.data?.[1]?.result as string) || '';

  const state = useReadContracts({
    contracts: curve ? [
      { address: curve, abi: curveV3Abi as any, functionName: 'getCurveReserves' },
      { address: curve, abi: curveV3Abi as any, functionName: 'monRaisedNet' },
      { address: curve, abi: curveV3Abi as any, functionName: 'graduated' },
      { address: curve, abi: curveV3Abi as any, functionName: 'creator' },
      { address: curve, abi: curveV3Abi as any, functionName: 'tradeTaxBps' },
    ] : [],
    query: { enabled: !!curve, refetchInterval: 8000 },
  });

  const reserves: Reserves | null = useMemo(() => {
    const r = state.data?.[0]?.result as readonly [bigint, bigint, bigint, bigint] | undefined;
    return r ? { vm: r[0], vt: r[1], rm: r[2], rt: r[3] } : null;
  }, [state.data]);
  const monRaisedNet = (state.data?.[1]?.result as bigint) ?? 0n;
  const graduated = (state.data?.[2]?.result as boolean) ?? false;
  const creator = (state.data?.[3]?.result as Address) ?? undefined;
  const tradeTax = (state.data?.[4]?.result as bigint) ?? 0n;
  const progress = GRAD_TARGET > 0n ? Math.min(1, Number(monRaisedNet) / Number(GRAD_TARGET)) : 0;
  const remaining = monRaisedNet >= GRAD_TARGET ? 0n : GRAD_TARGET - monRaisedNet;
  const canGrad = monRaisedNet >= GRAD_TARGET && !graduated;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16, color: '#fff' }}>
      <Head>
        <title>{`${name}${symbol ? ` (${symbol})` : ''} | Mon-Pad`}</title>
        <meta key="description" name="description" content={`Trade ${symbol || name} on Mon-Pad — native-MON bonding curve on Monad.`} />
        <link key="canonical" rel="canonical" href={`https://www.monpad.net/token/${addr}`} />
      </Head>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{name}</h1>
        <span style={{ color: '#888' }}>${symbol}</span>
      </div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
        {creator && <>by <Link href={`/profile/${creator}`} style={{ color: 'var(--brand, #A78BFA)' }}>{shortAddr(creator)}</Link>{' · '}</>}
        <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)' }}>contract</a>
        {curve && <>{' · '}<a href={`${MONAD_EXPLORER}/address/${curve}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)' }}>curve</a></>}
      </div>

      <GraduationBar progress={progress} remaining={remaining} graduated={graduated} canGrad={canGrad} curve={curve} />
      <TradePanel token={addr} curve={curve} symbol={symbol} reserves={reserves} graduated={graduated} tradeTax={tradeTax} />
      <CreatorPanel curve={curve} creator={creator} wallet={wallet} graduated={graduated} />
    </div>
  );
}

function GraduationBar({ progress, remaining, graduated, canGrad, curve }: { progress: number; remaining: bigint; graduated: boolean; canGrad: boolean; curve?: Address }) {
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  if (graduated) return <div style={{ marginTop: 16, padding: 12, background: 'rgba(74,222,128,0.1)', border: '1px solid var(--ok, #4ADE80)', borderRadius: 8, color: 'var(--ok, #4ADE80)', fontSize: 13 }}>Graduated — trading on the DEX (WMON/token pool).</div>;
  async function doGrad() {
    if (!curve) return;
    setTx({ status: 'pending' });
    try { const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'graduate', args: [] } as any); setTx({ status: 'pending', message: 'graduating... ' + h.slice(0, 10) }); }
    catch (e: any) { setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) }); }
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 4 }}>
        <span>Graduation</span>
        <span>{Number(formatEther(remaining)).toLocaleString()} MON to go</span>
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: 'var(--brand, #A78BFA)' }} />
      </div>
      {canGrad && (
        <button onClick={doGrad} style={{ marginTop: 8, width: '100%', padding: 10, background: 'var(--ok, #4ADE80)', color: '#000', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
          Target reached — Graduate to DEX
        </button>
      )}
      {tx.status !== 'idle' && <div style={{ marginTop: 6, fontSize: 12, color: tx.status === 'error' ? 'var(--err,#F87171)' : '#888' }}>{tx.message || tx.status}</div>}
    </div>
  );
}

function TradePanel({ token, curve, symbol, reserves, graduated, tradeTax }: { token?: Address; curve?: Address; symbol: string; reserves: Reserves | null; graduated: boolean; tradeTax: bigint }) {
  const { address } = useAccount();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const slippageBps = 500n; // 5%
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => { if (isSuccess) setTx({ status: 'success', message: 'confirmed' }); }, [isSuccess]);

  const sellAmountWei = useMemo(() => { try { return side === 'sell' && amount ? parseEther(amount) : 0n; } catch { return 0n; } }, [side, amount]);
  const allowanceRead = useReadContract({
    address: token, abi: tokenAbi as any, functionName: 'allowance',
    args: address && curve ? [address, curve] : undefined,
    query: { enabled: side === 'sell' && !!token && !!address && !!curve },
  });
  const allowance = (allowanceRead.data as bigint | undefined) ?? 0n;
  const needsApprove = side === 'sell' && sellAmountWei > 0n && allowance < sellAmountWei;

  const preview = useMemo(() => {
    if (!reserves || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null;
    try {
      if (side === 'buy') {
        const monIn = parseEther(amount);
        const monForBuy = (monIn * (10000n - BUY_FEE_BASE - tradeTax)) / 10000n;
        return curveTokensFor(reserves, monForBuy);
      } else {
        const tokensIn = parseEther(amount);
        const gross = curveMonFor(reserves, tokensIn);
        return (gross * (10000n - SELL_FEE_BASE - tradeTax)) / 10000n;
      }
    } catch { return null; }
  }, [reserves, amount, side, tradeTax]);

  const minOut = preview ? (preview * (10000n - slippageBps)) / 10000n : 0n;

  async function submit() {
    if (!address || !curve || !preview || !amount) return;
    setTx({ status: 'pending', message: 'submitting...' });
    try {
      if (side === 'buy') {
        const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'buy', args: [minOut], value: parseEther(amount) } as any);
        setTxHash(h);
      } else {
        const tokensIn = parseEther(amount);
        if (needsApprove && token) {
          setTx({ status: 'pending', message: 'approving...' });
          await writeContractAsync({ address: token, abi: tokenAbi as any, functionName: 'approve', args: [curve, tokensIn] } as any);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'sell', args: [tokensIn, minOut] } as any);
        setTxHash(h);
      }
      setTx({ status: 'pending', message: 'confirming...' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) });
    }
  }

  if (graduated) {
    return (
      <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 16, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
        This token graduated — trade it on the DEX. <Link href="/swap" style={{ color: 'var(--brand,#A78BFA)' }}>Open swap</Link>
      </div>
    );
  }

  const outLabel = side === 'buy' ? (symbol || 'tokens') : 'MON';
  const inLabel = side === 'buy' ? 'MON' : (symbol || 'tokens');
  const disabled = !address || !curve || !amount || !preview || tx.status === 'pending';

  return (
    <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button onClick={() => setSide('buy')} style={{ flex: 1, padding: 8, background: side === 'buy' ? 'var(--ok, #4ADE80)' : 'rgba(255,255,255,0.04)', color: side === 'buy' ? '#000' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>BUY</button>
        <button onClick={() => setSide('sell')} style={{ flex: 1, padding: 8, background: side === 'sell' ? 'var(--err, #F87171)' : 'rgba(255,255,255,0.04)', color: side === 'sell' ? '#000' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>SELL</button>
      </div>
      <label style={{ fontSize: 12, color: '#888' }}>Amount in {inLabel}</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" inputMode="decimal" style={{ width: '100%', padding: 10, marginTop: 4, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 16, boxSizing: 'border-box' }} />
      {preview != null && preview > 0n && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
          ≈ {Number(formatEther(preview)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {outLabel}
          <span style={{ color: '#666' }}> · min {Number(formatEther(minOut)).toLocaleString(undefined, { maximumFractionDigits: 6 })} (5% slip)</span>
        </div>
      )}
      <button disabled={disabled} onClick={submit} style={{ width: '100%', marginTop: 12, padding: 12, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 6, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
        {!address ? 'Connect wallet' : side === 'buy' ? 'BUY' : 'SELL'}
      </button>
      {tx.status !== 'idle' && <div style={{ marginTop: 8, fontSize: 13, color: tx.status === 'error' ? 'var(--err,#F87171)' : tx.status === 'success' ? 'var(--ok,#4ADE80)' : '#888' }}>{tx.message || tx.status}</div>}
    </div>
  );
}

function CreatorPanel({ curve, creator, wallet, graduated }: { curve?: Address; creator?: Address; wallet?: Address; graduated: boolean }) {
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const isCreator = !!wallet && !!creator && wallet.toLowerCase() === creator.toLowerCase();

  const reads = useReadContracts({
    contracts: (isCreator && curve) ? [
      { address: curve, abi: curveV3Abi as any, functionName: 'creatorPending' },
      { address: curve, abi: curveV3Abi as any, functionName: 'graduationRewardClaimable' },
    ] : [],
    query: { enabled: isCreator && !!curve, refetchInterval: 15000 },
  });
  if (!isCreator) return null;
  const pending = (reads.data?.[0]?.result as bigint) ?? 0n;
  const grad = reads.data?.[1]?.result as readonly [bigint, boolean] | undefined;
  const gradAmt = grad?.[0] ?? 0n;
  const gradClaimed = grad?.[1] ?? false;

  async function claim(fn: 'claimCreatorRewards' | 'claimGraduationReward') {
    if (!curve) return;
    setTx({ status: 'pending', message: 'claiming...' });
    try { await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: fn, args: [] } as any); setTx({ status: 'success', message: 'claimed' }); }
    catch (e: any) { setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) }); }
  }

  return (
    <div style={{ marginTop: 12, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Creator</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ color: '#aaa' }}>Trading fees</span>
        <span>{Number(formatEther(pending)).toFixed(4)} MON</span>
      </div>
      <button disabled={pending === 0n} onClick={() => claim('claimCreatorRewards')} style={{ width: '100%', marginTop: 8, padding: 8, background: pending > 0n ? 'var(--brand, #A78BFA)' : 'rgba(255,255,255,0.06)', color: pending > 0n ? '#000' : '#888', border: 'none', borderRadius: 6, fontSize: 13, cursor: pending > 0n ? 'pointer' : 'not-allowed' }}>Claim fees</button>
      {graduated && gradAmt > 0n && !gradClaimed && (
        <button onClick={() => claim('claimGraduationReward')} style={{ width: '100%', marginTop: 8, padding: 8, background: 'var(--ok, #4ADE80)', color: '#000', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
          Claim graduation reward ({Number(formatEther(gradAmt)).toLocaleString()} MON)
        </button>
      )}
      {tx.status !== 'idle' && <div style={{ marginTop: 8, fontSize: 12, color: tx.status === 'error' ? 'var(--err,#F87171)' : '#888' }}>{tx.message || tx.status}</div>}
    </div>
  );
}

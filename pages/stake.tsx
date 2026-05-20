// Note: bg-[rgba(168,85,247,0.X)] used instead of bg-brand-purple/X because
// Tailwind opacity modifiers do not work on CSS-variable colors.
// Values match var(--p) #A855F7 defined in styles/globals.css.
import { useState, useMemo, useEffect } from 'react';
import Head from 'next/head';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther, type Address } from 'viem';
import { Coins, Lock, Clock, X, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { CONTRACTS, MONSHI_TOKEN } from '@/lib/constants';
import { hubAbi, poolFactoryAbi, poolAbi } from '@/lib/abis';
import { fmtMon } from '@/lib/format';

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };

// Minimal ERC20 ABI for balanceOf/approve/allowance/symbol/decimals reads.
const erc20Abi = [
  { type: 'function', name: 'balanceOf',  stateMutability: 'view',     inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance',  stateMutability: 'view',     inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve',    stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'symbol',     stateMutability: 'view',     inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals',   stateMutability: 'view',     inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

const MONSHI_GATE = 2_000_000n * 10n ** 18n; // 2M MONSHI (1e18)
const STAKE_FEE = 100n * 10n ** 18n;         // 100 MON per stake (paid-fee path)

function fmtDuration(seconds: bigint): string {
  const s = Number(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  if (days >= 1) return hours > 0 ? days + 'd ' + hours + 'h' : days + 'd';
  if (hours >= 1) return hours + 'h';
  return Math.floor(s / 60) + 'm';
}

function fmtUnlockDate(unlockTs: bigint): string {
  return new Date(Number(unlockTs) * 1000).toLocaleString();
}

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const [selectedPool, setSelectedPool] = useState<Address | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [selectedTierId, setSelectedTierId] = useState<number>(0);
  const [paidFee, setPaidFee] = useState<boolean>(true);
  const [paidFeeManuallySet, setPaidFeeManuallySet] = useState(false);
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [unstakeConfirm, setUnstakeConfirm] = useState<{ pool: Address; stakeId: number } | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // === HUB: pool addresses
  const { data: pools, isLoading: poolsLoading } = useReadContract({
    address: CONTRACTS.hub,
    abi: hubAbi as any,
    functionName: 'allPoolsView',
  });
  const poolList = (pools as Address[] | undefined) ?? [];

  // === USER MONSHI BALANCE (for free-tier qualification)
  const { data: monshiBalance } = useReadContract({
    address: MONSHI_TOKEN as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const monshiBal = (monshiBalance as bigint | undefined) ?? 0n;
  const qualifiesForFreeStake = monshiBal >= MONSHI_GATE;

  // === Auto-default paidFee based on MONSHI balance, until user manually overrides
  useEffect(() => {
    if (!paidFeeManuallySet) setPaidFee(!qualifiesForFreeStake);
  }, [qualifiesForFreeStake, paidFeeManuallySet]);

  // === Per-pool batch: token(), pendingAll(user), stakesLength(user), totalRawStaked, paused
  const poolReads = useMemo(() => {
    if (poolList.length === 0) return [];
    return poolList.flatMap((p) => [
      { address: p, abi: poolAbi as any, functionName: 'token' },
      { address: p, abi: poolAbi as any, functionName: 'pendingAll', args: address ? [address] : [] },
      { address: p, abi: poolAbi as any, functionName: 'stakesLength', args: address ? [address] : [] },
      { address: p, abi: poolAbi as any, functionName: 'getTotalRawStaked' },
      { address: p, abi: poolAbi as any, functionName: 'paused' },
    ]);
  }, [poolList, address]);

  const { data: poolBatch } = useReadContracts({
    contracts: poolReads as any,
    query: { enabled: poolReads.length > 0 },
  } as any);

  // Slice batch into per-pool records
  const pools_meta = useMemo(() => {
    if (!poolBatch || poolList.length === 0) return [];
    return poolList.map((poolAddr, i) => {
      const base = i * 5;
      return {
        pool: poolAddr,
        token: poolBatch[base]?.result as Address | undefined,
        pendingAll: (poolBatch[base + 1]?.result as bigint | undefined) ?? 0n,
        stakesLength: (poolBatch[base + 2]?.result as bigint | undefined) ?? 0n,
        totalRawStaked: (poolBatch[base + 3]?.result as bigint | undefined) ?? 0n,
        paused: (poolBatch[base + 4]?.result as boolean | undefined) ?? false,
      };
    });
  }, [poolBatch, poolList]);

  // Aggregate pending across all pools (in MON, since rewards are native)
  const totalPendingAcrossPools = pools_meta.reduce((sum, p) => sum + p.pendingAll, 0n);
  const totalActivePoolsForUser = pools_meta.filter((p) => p.stakesLength > 0n).length;

  // === SELECTED POOL: tiers + user's stakes
  const { data: tiersLength } = useReadContract({
    address: selectedPool ?? undefined,
    abi: poolAbi as any,
    functionName: 'tiersLength',
    query: { enabled: !!selectedPool },
  });
  const tiersCount = Number((tiersLength as bigint | undefined) ?? 0n);

  const tiersReads = useMemo(() => {
    if (!selectedPool || tiersCount === 0) return [];
    return Array.from({ length: tiersCount }, (_, i) => ({
      address: selectedPool, abi: poolAbi as any, functionName: 'tiers', args: [BigInt(i)],
    }));
  }, [selectedPool, tiersCount]);

  const { data: tiersBatch } = useReadContracts({
    contracts: tiersReads as any,
    query: { enabled: tiersReads.length > 0 },
  } as any);

  const tiers = useMemo(() => {
    if (!tiersBatch) return [];
    return tiersBatch.map((r, i) => {
      const t = r.result as readonly [bigint, bigint, bigint, boolean] | undefined;
      return t ? { tierId: i, duration: t[0], multiplierBps: t[1], earlyFeeBps: t[2], enabled: t[3] } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null && x.enabled);
  }, [tiersBatch]);

  // User's stakes in selected pool
  const selectedPoolMeta = pools_meta.find((p) => p.pool === selectedPool);
  const userStakesCount = Number(selectedPoolMeta?.stakesLength ?? 0n);

  const stakeReads = useMemo(() => {
    if (!selectedPool || !address || userStakesCount === 0) return [];
    return Array.from({ length: userStakesCount }, (_, i) => ({
      address: selectedPool, abi: poolAbi as any, functionName: 'stakes', args: [address, BigInt(i)],
    }));
  }, [selectedPool, address, userStakesCount]);

  const { data: stakesBatch } = useReadContracts({
    contracts: stakeReads as any,
    query: { enabled: stakeReads.length > 0 },
  } as any);

  // Filter zero-don't-pop: unstaked slots have weighted === 0n, must drop them.
  const activeStakes = useMemo(() => {
    if (!stakesBatch) return [];
    return stakesBatch.map((r, i) => {
      const s = r.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, bigint] | undefined;
      if (!s) return null;
      return {
        stakeId: i,
        amount: s[0], weighted: s[1], startTs: s[2], unlockTs: s[3],
        tierId: s[4], flags: s[5], paidFee: s[6], rewardDebt: s[7],
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null && x.weighted > 0n);
  }, [stakesBatch]);

  // === STAKED TOKEN ALLOWANCE (for approve gate)
  const { data: allowance } = useReadContract({
    address: selectedPoolMeta?.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && selectedPool ? [address, selectedPool] : undefined,
    query: { enabled: !!address && !!selectedPool && !!selectedPoolMeta?.token },
  });
  const currentAllowance = (allowance as bigint | undefined) ?? 0n;

  // === Token symbol for selected pool (for UI labels)
  const { data: tokenSymbol } = useReadContract({
    address: selectedPoolMeta?.token,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !!selectedPoolMeta?.token },
  });
  const tokenSym = (tokenSymbol as string | undefined) ?? '???';

  // === TX state machine effects
  useEffect(() => {
    if (txConfirmed) setTx({ status: 'success', message: 'Transaction confirmed' });
  }, [txConfirmed]);
  useEffect(() => {
    if (tx.status === 'success') {
      const t = setTimeout(() => setTx({ status: 'idle' }), 5000);
      return () => clearTimeout(t);
    }
  }, [tx.status]);

  // === WRITE HANDLERS
  async function handleApprove() {
    if (!selectedPool || !selectedPoolMeta?.token || !stakeAmount) return;
    try {
      setTx({ status: 'pending', message: 'Approving token...' });
      const amt = parseEther(stakeAmount);
      const hash = await writeContractAsync({
        address: selectedPoolMeta.token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [selectedPool, amt],
      } as any);
      setTxHash(hash);
    } catch (e: any) {
      setTx({ status: 'error', message: e?.shortMessage || 'Approve failed' });
    }
  }

  async function handleStake() {
    if (!selectedPool || !stakeAmount || tiers.length === 0) return;
    try {
      setTx({ status: 'pending', message: 'Submitting stake...' });
      const amt = parseEther(stakeAmount);
      const tier = tiers.find((t) => t.tierId === selectedTierId) ?? tiers[0];
      const hash = await writeContractAsync({
        address: selectedPool,
        abi: poolAbi as any,
        functionName: 'stake',
        args: [BigInt(tier.tierId), amt, paidFee],
        value: paidFee ? STAKE_FEE : 0n,
      } as any);
      setTxHash(hash);
      setStakeAmount('');
    } catch (e: any) {
      setTx({ status: 'error', message: e?.shortMessage || 'Stake failed' });
    }
  }

  async function handleUnstake(pool: Address, stakeId: number) {
    try {
      setTx({ status: 'pending', message: 'Unstaking...' });
      const hash = await writeContractAsync({
        address: pool,
        abi: poolAbi as any,
        functionName: 'unstake',
        args: [BigInt(stakeId)],
      } as any);
      setTxHash(hash);
      setUnstakeConfirm(null);
    } catch (e: any) {
      setTx({ status: 'error', message: e?.shortMessage || 'Unstake failed' });
    }
  }

  async function handleClaimAll(pool: Address) {
    try {
      setTx({ status: 'pending', message: 'Claiming rewards...' });
      const hash = await writeContractAsync({
        address: pool,
        abi: poolAbi as any,
        functionName: 'claimAll',
      } as any);
      setTxHash(hash);
    } catch (e: any) {
      setTx({ status: 'error', message: e?.shortMessage || 'Claim failed' });
    }
  }

  // === Compute unstake penalties for confirm modal
  function computeUnstakePenalties(stake: typeof activeStakes[number]) {
    const tier = tiers.find((t) => t.tierId === Number(stake.tierId));
    const earlyFeeBps = tier?.earlyFeeBps ?? 0n;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const isEarly = now < stake.unlockTs;
    const isDropout = !stake.paidFee && monshiBal < MONSHI_GATE;
    let earlyFee = 0n;
    let dropoutPenalty = 0n;
    if (isEarly && earlyFeeBps > 0n) earlyFee = (stake.amount * earlyFeeBps) / 10000n;
    if (isDropout) dropoutPenalty = (stake.amount * 2000n) / 10000n; // DROPOUT_PENALTY_BPS = 2000
    const totalDeducted = earlyFee + dropoutPenalty;
    const netReceive = stake.amount > totalDeducted ? stake.amount - totalDeducted : 0n;
    return { isEarly, isDropout, earlyFee, dropoutPenalty, netReceive, earlyFeeBps };
  }

  const stakeAmountBn = stakeAmount ? (() => { try { return parseEther(stakeAmount); } catch { return 0n; } })() : 0n;
  const needsApprove = stakeAmountBn > 0n && currentAllowance < stakeAmountBn;

  return (
    <>
      <Head>
        <title>Stake | Mon-Pad</title>
        <meta name="description" content="Stake tokens on Mon-Pad and earn MON rewards from trading fees." />
      </Head>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Coins size={28} className="text-brand-purple" />
          <h1 className="text-3xl font-bold text-white">Stake</h1>
        </div>
        <p className="text-white/60 mb-6">Lock tokens into pools to earn MON rewards from trading fees.</p>

        {/* Aggregate stats */}
        <div className="bg-card border border-border rounded-2xl p-5 mb-6 flex flex-col sm:flex-row gap-4 sm:gap-8">
          <div>
            <div className="text-xs text-white/50 uppercase tracking-wide">Active pools</div>
            <div className="text-2xl font-semibold text-white mt-1">{poolList.length}</div>
          </div>
          <div>
            <div className="text-xs text-white/50 uppercase tracking-wide">Your active pools</div>
            <div className="text-2xl font-semibold text-white mt-1">{totalActivePoolsForUser}</div>
          </div>
          <div>
            <div className="text-xs text-white/50 uppercase tracking-wide">Total pending rewards</div>
            <div className="text-2xl font-semibold text-brand-purple mt-1">{fmtMon(totalPendingAcrossPools)} MON</div>
          </div>
        </div>

        {/* Tx status banner */}
        {tx.status !== 'idle' && (
          <div className={`mb-4 px-4 py-3 rounded-xl flex items-center gap-3 ${
            tx.status === 'success' ? 'bg-[rgba(34,197,94,0.15)] border border-[rgba(34,197,94,0.4)] text-green-300' :
            tx.status === 'error' ? 'bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.4)] text-red-300' :
            'bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.4)] text-brand-purple'
          }`}>
            {tx.status === 'pending' && <Loader2 className="animate-spin" size={16} />}
            {tx.status === 'success' && <CheckCircle2 size={16} />}
            {tx.status === 'error' && <AlertTriangle size={16} />}
            <span className="text-sm">{tx.message}</span>
          </div>
        )}

        {/* Pool grid */}
        {poolsLoading ? (
          <div className="text-white/60 text-center py-12">Loading pools...</div>
        ) : poolList.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center text-white/60">
            <Coins size={48} className="mx-auto mb-3 text-white/30" />
            <p>No staking pools yet. Pools are created when graduated tokens are launched.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pools_meta.map((p) => {
              const isOpen = selectedPool === p.pool;
              return (
                <div key={p.pool} className={`bg-card border rounded-2xl transition-colors ${
                  isOpen ? 'border-[rgba(168,85,247,0.4)]' : 'border-border hover:border-[rgba(168,85,247,0.3)]'
                }`}>
                  <button
                    onClick={() => setSelectedPool(isOpen ? null : p.pool)}
                    className="w-full p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="text-white font-semibold flex items-center gap-2">
                        Pool <span className="text-white/40 text-xs font-mono">{p.pool.slice(0,6)}...{p.pool.slice(-4)}</span>
                        {p.paused && <span className="text-xs px-2 py-0.5 rounded bg-[rgba(239,68,68,0.15)] text-red-300">Paused</span>}
                      </div>
                      <div className="text-xs text-white/50">Token: <span className="font-mono">{p.token ? `${p.token.slice(0,6)}...${p.token.slice(-4)}` : '???'}</span></div>
                    </div>
                    <div className="flex flex-row sm:flex-col gap-4 sm:gap-1 sm:items-end text-sm">
                      <div className="flex flex-col">
                        <span className="text-white/50 text-xs">Total staked</span>
                        <span className="text-white font-medium">{fmtMon(p.totalRawStaked)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white/50 text-xs">Your pending</span>
                        <span className="text-brand-purple font-medium">{fmtMon(p.pendingAll)} MON</span>
                      </div>
                    </div>
                  </button>

                  {/* Inline drawer: stake form + user's stakes */}
                  {isOpen && (
                    <div className="border-t border-border p-5 flex flex-col gap-5">
                      {/* Stake form */}
                      <div className="flex flex-col gap-3">
                        <h3 className="text-white font-medium">Stake {tokenSym}</h3>

                        {/* Tier selector */}
                        <div>
                          <div className="text-xs text-white/50 mb-2">Lock duration</div>
                          <div className="flex flex-wrap gap-2">
                            {tiers.length === 0 ? (
                              <div className="text-sm text-white/50">Loading tiers...</div>
                            ) : tiers.map((t) => (
                              <button
                                key={t.tierId}
                                onClick={() => setSelectedTierId(t.tierId)}
                                className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                                  selectedTierId === t.tierId
                                    ? 'bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.4)] text-brand-purple'
                                    : 'bg-black/40 border border-border text-white/70 hover:border-[rgba(168,85,247,0.3)]'
                                }`}
                              >
                                <div className="font-medium">{fmtDuration(t.duration)}</div>
                                <div className="text-xs opacity-70">{(Number(t.multiplierBps) / 100).toFixed(0)}% weight</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* paidFee mode toggle + qualification indicator */}
                        <div>
                          <div className="text-xs text-white/50 mb-2">Staking mode</div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              onClick={() => { setPaidFee(false); setPaidFeeManuallySet(true); }}
                              disabled={!qualifiesForFreeStake}
                              className={`flex-1 px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                                !paidFee
                                  ? 'bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.4)] text-brand-purple'
                                  : 'bg-black/40 border border-border text-white/70 hover:border-[rgba(168,85,247,0.3)]'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                              <div className="font-medium">Free for Monshi holders</div>
                              <div className="text-xs opacity-70">Requires &ge; 2M MONSHI</div>
                            </button>
                            <button
                              onClick={() => { setPaidFee(true); setPaidFeeManuallySet(true); }}
                              className={`flex-1 px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                                paidFee
                                  ? 'bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.4)] text-brand-purple'
                                  : 'bg-black/40 border border-border text-white/70 hover:border-[rgba(168,85,247,0.3)]'
                              }`}
                            >
                              <div className="font-medium">Pay 100 MON fee</div>
                              <div className="text-xs opacity-70">Routed to treasury</div>
                            </button>
                          </div>
                          <div className="text-xs mt-2">
                            {qualifiesForFreeStake ? (
                              <span className="text-green-300">&#10003; You hold {fmtMon(monshiBal)} MONSHI &mdash; qualifies for free staking</span>
                            ) : isConnected ? (
                              <span className="text-white/50">You hold {fmtMon(monshiBal)} MONSHI &mdash; need {fmtMon(MONSHI_GATE - monshiBal)} more for free staking</span>
                            ) : (
                              <span className="text-white/50">Connect wallet to check MONSHI qualification</span>
                            )}
                          </div>
                        </div>

                        {/* Amount input + actions */}
                        <div>
                          <div className="text-xs text-white/50 mb-2">Amount</div>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={stakeAmount}
                            onChange={(e) => setStakeAmount(e.target.value)}
                            placeholder="0.0"
                            className="w-full px-4 py-3 bg-black/40 border border-border rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-brand-purple"
                          />
                        </div>

                        <div className="flex gap-2">
                          {needsApprove ? (
                            <button
                              onClick={handleApprove}
                              disabled={!isConnected || txPending || stakeAmountBn === 0n}
                              className="flex-1 px-4 py-3 rounded-xl bg-brand-purple text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {txPending ? 'Approving...' : `Approve ${tokenSym}`}
                            </button>
                          ) : (
                            <button
                              onClick={handleStake}
                              disabled={!isConnected || txPending || stakeAmountBn === 0n || tiers.length === 0 || p.paused}
                              className="flex-1 px-4 py-3 rounded-xl bg-brand-purple text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {txPending ? 'Staking...' : p.paused ? 'Pool paused' : 'Stake'}
                            </button>
                          )}
                          {p.pendingAll > 0n && (
                            <button
                              onClick={() => handleClaimAll(p.pool)}
                              disabled={txPending}
                              className="px-4 py-3 rounded-xl border border-border text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                            >
                              Claim {fmtMon(p.pendingAll)} MON
                            </button>
                          )}
                        </div>
                      </div>

                      {/* User's active stakes in this pool */}
                      {isConnected && (
                        <div className="flex flex-col gap-2">
                          <h3 className="text-white font-medium">Your stakes</h3>
                          {activeStakes.length === 0 ? (
                            <div className="text-sm text-white/50">You haven&apos;t staked in this pool yet.</div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {activeStakes.map((s) => {
                                const tier = tiers.find((t) => t.tierId === Number(s.tierId));
                                const now = BigInt(Math.floor(Date.now() / 1000));
                                const locked = now < s.unlockTs;
                                return (
                                  <div key={s.stakeId} className="bg-black/40 border border-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex flex-col gap-1">
                                      <div className="text-white text-sm">
                                        <span className="font-medium">{fmtMon(s.amount)} {tokenSym}</span>
                                        <span className="text-white/50 ml-2 text-xs">stake #{s.stakeId}</span>
                                      </div>
                                      <div className="text-xs text-white/50 flex flex-wrap items-center gap-2">
                                        {tier && <span>{fmtDuration(tier.duration)} lock</span>}
                                        {locked ? (
                                          <span className="flex items-center gap-1"><Lock size={11} /> Unlocks {fmtUnlockDate(s.unlockTs)}</span>
                                        ) : (
                                          <span className="flex items-center gap-1 text-green-300"><Clock size={11} /> Unlocked</span>
                                        )}
                                        {!s.paidFee && <span className="text-brand-purple">Free-tier</span>}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => setUnstakeConfirm({ pool: p.pool, stakeId: s.stakeId })}
                                      disabled={txPending}
                                      className="px-3 py-2 rounded-xl text-sm border border-border text-white/80 hover:bg-white/5 transition-colors disabled:opacity-40"
                                    >
                                      Unstake
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Unstake confirm modal */}
        {unstakeConfirm && (() => {
          const meta = pools_meta.find((p) => p.pool === unstakeConfirm.pool);
          const stake = activeStakes.find((s) => s.stakeId === unstakeConfirm.stakeId);
          if (!stake) return null;
          const p = computeUnstakePenalties(stake);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setUnstakeConfirm(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-card border border-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold flex items-center gap-2"><AlertTriangle size={18} className="text-yellow-400" />Confirm unstake</h3>
                  <button onClick={() => setUnstakeConfirm(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
                </div>
                <div className="text-sm text-white/80 flex flex-col gap-2">
                  <div>Stake amount: <span className="text-white font-medium">{fmtMon(stake.amount)} {tokenSym}</span></div>
                  {p.isEarly && (
                    <div className="text-yellow-300">This stake is locked until {fmtUnlockDate(stake.unlockTs)}.</div>
                  )}
                  <div className="flex flex-col gap-1 mt-2">
                    {p.earlyFee > 0n && (
                      <div className="flex justify-between text-yellow-300">
                        <span>Early-unstake fee ({(Number(p.earlyFeeBps) / 100).toFixed(2)}%)</span>
                        <span>-{fmtMon(p.earlyFee)} {tokenSym}</span>
                      </div>
                    )}
                    {p.dropoutPenalty > 0n && (
                      <div className="flex justify-between text-red-300">
                        <span>Dropout penalty (20%, below 2M MONSHI)</span>
                        <span>-{fmtMon(p.dropoutPenalty)} {tokenSym}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-2 mt-2">
                      <span className="text-white">You receive</span>
                      <span className="text-white font-semibold">{fmtMon(p.netReceive)} {tokenSym}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUnstakeConfirm(null)}
                    className="flex-1 px-4 py-3 rounded-xl border border-border text-white hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleUnstake(unstakeConfirm.pool, unstakeConfirm.stakeId)}
                    disabled={txPending}
                    className="flex-1 px-4 py-3 rounded-xl bg-red-500/80 text-white font-medium hover:bg-red-500 transition-colors disabled:opacity-40"
                  >
                    {txPending ? 'Unstaking...' : 'Unstake anyway'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </>
  );
}

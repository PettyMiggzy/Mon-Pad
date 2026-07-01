import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useAccount, useReadContract, useReadContracts, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { ArrowDownUp, ChevronDown, RefreshCw } from 'lucide-react';
import TokenPicker from '@/components/TokenPicker';
import type { TokenOption } from '@/components/TokenPicker';
import { parseEther, parseUnits, formatUnits, type Address } from 'viem';
import { ZERO_ADDRESS, MONORAIL_API, WMON, FACTORY_V3 } from '@/lib/constants';
import { api } from '@/lib/api';
import { curveV3Abi, factoryV3Abi, tokenAbi } from '@/lib/abis';
import { getMonorailQuote, toExecutable, quoteSummary, type MonorailQuote } from '@/lib/monorail';
import { publicClient, resolveTokenMeta } from '@/lib/chainV3';
import {
  previewBuy, previewSell, applySlippage,
  preflightBuy, preflightSell, needsApprove,
  type CurveReserves, type CurveFees, type PreflightState, type PreflightResult
} from '@/lib/curveSwap';
import { routeForSwap, checkCrossCurve, type Route } from '@/lib/swapRouter';
import Head from 'next/head';
import { useRouter } from 'next/router';

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };

// Minimal WMON (canonical wrapped-native) ABI: deposit to wrap, plus the ERC20
// bits we need to let the Monorail router pull WMON via transferFrom.
const WMON_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const isNativeAddr = (a: string) => a.toLowerCase() === ZERO_ADDRESS.toLowerCase();

function StatusPill({ state }: { state: TxState }) {
  if (state.status === 'idle') return null;
  const bg = state.status === 'success' ? '#0a5' : state.status === 'error' ? '#a30' : '#555';
  return (
    <div style={{ marginTop: 12, padding: '8px 12px', background: bg, color: '#fff', borderRadius: 6, fontSize: 13 }}>
      {state.message || state.status}
    </div>
  );
}

function RouteLabel({ route, disabledReason }: { route: Route; disabledReason: string | null }) {
  const text = disabledReason ? disabledReason : route === 'curve' ? 'Routed via Mon-Pad curve' : 'Routed via Monorail';
  const color = disabledReason ? '#f93' : '#888';
  return <div style={{ marginTop: 6, fontSize: 11, color }}>{text}</div>;
}

function TokenInput({ label, token, setToken, amount, setAmount, readOnly, onPickerOpen }: {
  label: string;
  token: TokenOption;
  setToken: (t: TokenOption) => void;
  amount: string;
  setAmount: (v: string) => void;
  readOnly?: boolean;
  onPickerOpen: () => void;
}) {
  return (
    <div style={{ padding: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => !readOnly && setAmount(e.target.value)}
          placeholder="0.0"
          readOnly={readOnly}
          style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 22, outline: 'none', minWidth: 0 }}
        />
        <button
          onClick={onPickerOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          {token.imageUrl ? (
        <Image
          src={token.imageUrl}
          alt={token.symbol}
          width={20}
          height={20}
          unoptimized
          style={{ borderRadius: '50%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : null}
          {token.symbol}
          <ChevronDown size={14} />
        </button>
        <input type="hidden" value={token.address} onChange={() => {}} aria-hidden />
        <input type="hidden" value={setToken.length} onChange={() => {}} aria-hidden />
      </div>
    </div>
  );
}

const DEFAULT_FROM: TokenOption = { symbol: 'MON', name: 'Monad', address: '0x0000000000000000000000000000000000000000', decimals: 18, imageUrl: '/monad.png', isMonPadToken: false, graduated: true };
const DEFAULT_TO: TokenOption = { symbol: 'WMON', name: 'Wrapped Monad', address: WMON, decimals: 18, imageUrl: '/monad.png', isMonPadToken: false, graduated: true };

export default function SwapPage() {
  const { address } = useAccount();
  const router = useRouter();
  const canonical = useMemo(() => {
    if (typeof window !== 'undefined') return `${window.location.origin}${router.asPath.split('?')[0]}`;
    return 'https://www.monpad.net/swap';
  }, [router.asPath]);

  const [from, setFrom] = useState<TokenOption>(DEFAULT_FROM);
  const [to, setTo] = useState<TokenOption>(DEFAULT_TO);
  const [amountIn, setAmountIn] = useState('');

  // Honor ?from=&?to= deep links (e.g. "Trade on Swap" from a graduated token page).
  // Applied once after the router is ready so it never clobbers later user picks.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (!router.isReady || deepLinkApplied.current) return;
    deepLinkApplied.current = true;
    const resolve = async (addrParam: string): Promise<TokenOption | null> => {
      const a = addrParam.toLowerCase();
      if (a === ZERO_ADDRESS.toLowerCase()) return DEFAULT_FROM;
      if (a === WMON.toLowerCase()) return DEFAULT_TO;
      if (!/^0x[a-f0-9]{40}$/.test(a)) return null;
      // On-chain first (works with no indexer) — resolves any token by address.
      try {
        const m = await resolveTokenMeta(a as Address);
        if (m && m.symbol) return { symbol: m.symbol, name: m.name, address: a, decimals: m.decimals, isMonPadToken: m.isMonPadToken, graduated: m.graduated };
      } catch { /* fall through to indexer */ }
      try {
        const t = await api.getToken(a);
        if (t) return { symbol: t.symbol, name: t.name, address: t.address, decimals: 18, imageUrl: t.imageUrl, isMonPadToken: true, graduated: t.graduated };
      } catch { /* ignore — keep default */ }
      return null;
    };
    (async () => {
      const { from: qFrom, to: qTo } = router.query;
      if (typeof qFrom === 'string') { const r = await resolve(qFrom); if (r) setFrom(r); }
      if (typeof qTo === 'string') { const r = await resolve(qTo); if (r) setTo(r); }
    })();
  }, [router.isReady, router.query]);
  const [slippageBps, setSlippageBps] = useState(500);
  const [pickerOpen, setPickerOpen] = useState<'from' | 'to' | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Route decision
  const route: Route = useMemo(() => routeForSwap(from, to), [from, to]);
  const crossCurve = useMemo(() => checkCrossCurve(from, to), [from, to]);

  // ----- Factory reads (cached at mount, refreshed every 5 min) -----
  const factoryAddr = FACTORY_V3 as Address;
  const factoryReads = (useReadContracts as any)({
    contracts: (factoryAddr !== ZERO_ADDRESS ? [
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'buyFeeCreatorBps' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'buyFeeBufferBps' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'sellFeeCreatorBps' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'sellFeeStakingBps' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'sellFeePlatformBps' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'pauseAllBuys' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'pauseAllSells' },
    ] : []) as any,
  });

  const fees: CurveFees | null = useMemo(() => {
    const d = factoryReads.data;
    if (!d || d.length < 5 || d[0].status !== 'success') return null;
    return {
      buyCreatorBps: Number(d[0].result as bigint),
      buyBufferBps: Number(d[1].result as bigint),
      sellCreatorBps: Number(d[2].result as bigint),
      sellStakingBps: Number(d[3].result as bigint),
      sellPlatformBps: Number(d[4].result as bigint),
    };
  }, [factoryReads.data]);
  const pauseAllBuys = (factoryReads.data?.[5]?.result as boolean | undefined) ?? false;
  const pauseAllSells = (factoryReads.data?.[6]?.result as boolean | undefined) ?? false;

  // ----- Determine curve target token (for curve route) -----
  // For BUY: user spends MON to acquire a Mon-Pad token -> curve token = `to`
  // For SELL: user spends a Mon-Pad token to receive MON -> curve token = `from`
  const isBuy = from.address === ZERO_ADDRESS && to.isMonPadToken;
  const isSell = from.isMonPadToken && to.address === ZERO_ADDRESS;
  const curveTokenAddr: Address | null = route === 'curve'
    ? ((isBuy ? to.address : isSell ? from.address : null) as Address | null)
    : null;

  // Resolve curve address from token.curve()
  const curveOfToken = useReadContract({
    address: (curveTokenAddr ?? undefined) as Address | undefined,
    abi: tokenAbi as any,
    functionName: 'curve',
    query: { enabled: !!curveTokenAddr },
  });
  const curveAddr = curveOfToken.data as Address | undefined;

  // ----- Per-curve reads (reserves + pause + blocked + graduated) -----
  const curveReads = (useReadContracts as any)({
    contracts: (curveAddr && curveTokenAddr ? [
      { address: curveAddr, abi: curveV3Abi as any, functionName: 'getCurveReserves' },
      { address: curveAddr, abi: curveV3Abi as any, functionName: 'pauseBuys' },
      { address: curveAddr, abi: curveV3Abi as any, functionName: 'pauseSells' },
      { address: curveAddr, abi: curveV3Abi as any, functionName: 'graduated' },
      { address: factoryAddr, abi: factoryV3Abi as any, functionName: 'blocked', args: [curveTokenAddr] },
    ] : []) as any,
    query: { enabled: !!curveAddr && !!curveTokenAddr, refetchInterval: 8_000 },
  });

  const reserves: CurveReserves | null = useMemo(() => {
    const r = curveReads.data?.[0]?.result;
    if (!r) return null;
    const tuple = r as readonly [bigint, bigint, bigint, bigint];
    return {
      virtualMonReserve: tuple[0],
      virtualTokenReserve: tuple[1],
      realMonReserve: tuple[2],
      realTokenReserve: tuple[3],
    };
  }, [curveReads.data]);

  const preflightState: PreflightState | null = useMemo(() => {
    const d = curveReads.data;
    if (!d || d.length < 5) return null;
    return {
      pauseAllBuys,
      pauseAllSells,
      pauseBuys: Boolean(d[1]?.result),
      pauseSells: Boolean(d[2]?.result),
      graduated: Boolean(d[3]?.result),
      blocked: Boolean(d[4]?.result),
    };
  }, [curveReads.data, pauseAllBuys, pauseAllSells]);

  // ----- Curve preview (300ms debounce, local math) -----
  const [curveOut, setCurveOut] = useState<bigint | null>(null);
  const [curveDecimals, setCurveDecimals] = useState(18);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);

  useEffect(() => {
    if (route !== 'curve') { setCurveOut(null); setPreflight(null); return; }
    if (!reserves || !fees || !preflightState) return;
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) { setCurveOut(null); return; }
    const handle = setTimeout(() => {
      const pre = isBuy ? preflightBuy(preflightState) : preflightSell(preflightState);
      setPreflight(pre);
      if (!pre.ok) { setCurveOut(null); return; }
      try {
        if (isBuy) {
          const monIn = parseEther(amountIn);
          setCurveOut(previewBuy(monIn, reserves, fees));
          setCurveDecimals(to.decimals);
        } else if (isSell) {
          const tokensIn = parseUnits(amountIn, from.decimals);
          setCurveOut(previewSell(tokensIn, reserves, fees));
          setCurveDecimals(18);
        }
      } catch { setCurveOut(null); }
    }, 300);
    return () => clearTimeout(handle);
  }, [amountIn, route, reserves, fees, preflightState, isBuy, isSell, from.decimals, to.decimals, refreshTick]);

  // ----- Monorail quote (5s debounce, remote) -----
  const [mQuote, setMQuote] = useState<MonorailQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (route !== 'monorail') { setMQuote(null); return; }
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) { setMQuote(null); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const handle = setTimeout(async () => {
      setLoadingQuote(true);
      try {
        const q = await getMonorailQuote({
          fromAddress: from.address,
          toAddress: to.address,
          amount: amountIn,
          slippageBps,
          sender: (address ?? '0x0000000000000000000000000000000000000001') as `0x${string}`,
          signal: ctrl.signal,
        });
        setMQuote(q);
      } catch (e: unknown) {
        if ((e as { name?: string })?.name !== 'AbortError') setMQuote(null);
      } finally { setLoadingQuote(false); }
    }, 5000);
    return () => { clearTimeout(handle); ctrl.abort(); };
  }, [amountIn, route, from.address, to.address, slippageBps, address, refreshTick]);

  // ----- Display outputs -----
  const outAmount = useMemo(() => {
    if (route === 'curve' && curveOut !== null) {
      return formatUnits(curveOut, curveDecimals);
    }
    if (route === 'monorail' && mQuote) {
      return quoteSummary(mQuote).outputFormatted;
    }
    return '';
  }, [route, curveOut, curveDecimals, mQuote]);

  const minOut = useMemo(() => {
    if (route === 'curve' && curveOut !== null) {
      return formatUnits(applySlippage(curveOut, slippageBps), curveDecimals);
    }
    if (route === 'monorail' && mQuote) {
      return quoteSummary(mQuote).minOutputFormatted;
    }
    return '';
  }, [route, curveOut, curveDecimals, mQuote, slippageBps]);

  const priceImpactPct = route === 'monorail' && mQuote ? quoteSummary(mQuote).priceImpactPct : null;

  // ----- Allowance + approve for curve sells -----
  const allowanceRead = useReadContract({
    address: (route === 'curve' && isSell ? (from.address as Address) : undefined),
    abi: tokenAbi as any,
    functionName: 'allowance',
    args: address && curveAddr ? [address, curveAddr] : undefined,
    query: { enabled: route === 'curve' && isSell && !!address && !!curveAddr },
  });
  const allowance = (allowanceRead.data as bigint | undefined) ?? 0n;
  const sellAmountWei = isSell && amountIn ? (() => { try { return parseUnits(amountIn, from.decimals); } catch { return 0n; } })() : 0n;
  const needsApproval = route === 'curve' && isSell && sellAmountWei > 0n && needsApprove(allowance, sellAmountWei);

  // ----- Execution -----
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => { if (isSuccess) setTx({ status: 'success', message: 'swap confirmed' }); }, [isSuccess]);

  async function handleSwap() {
    if (!address) return;
    setTx({ status: 'pending', message: 'submitting...' });
    try {
      if (route === 'curve') {
        if (!curveAddr || !curveOut) throw new Error('no curve quote');
        const minOutWei = applySlippage(curveOut, slippageBps);
        if (isSell && needsApproval) {
          setTx({ status: 'pending', message: 'approving...' });
          const approveHash = await writeContractAsync({
            address: from.address as Address,
            abi: tokenAbi as any,
            functionName: 'approve',
            // Exact-amount approve (not MAX_UINT256) — clears MetaMask/Blockaid spending-cap warning.
            args: [curveAddr, parseUnits(amountIn, from.decimals)],
          } as any);
          setTxHash(approveHash);
          await new Promise((res) => setTimeout(res, 1500));
        }
        if (isBuy) {
          const monIn = parseEther(amountIn);
          const hash = await writeContractAsync({
            address: curveAddr,
            abi: curveV3Abi as any,
            functionName: 'buy',
            args: [minOutWei],
            value: monIn,
          } as any);
          setTxHash(hash);
        } else if (isSell) {
          const tokensIn = parseUnits(amountIn, from.decimals);
          const hash = await writeContractAsync({
            address: curveAddr,
            abi: curveV3Abi as any,
            functionName: 'sell',
            args: [tokensIn, minOutWei],
          } as any);
          setTxHash(hash);
        }
        setTx({ status: 'pending', message: 'confirming...' });
      } else {
        // ── Monorail aggregator ────────────────────────────────────────────
        // Always re-quote fresh at submit time: the displayed quote can be up to
        // a few seconds old, and a stale min_output is what trips the router's
        // SlippageExceeded() revert.
        const sender = address as `0x${string}`;
        const amtIn = parseUnits(amountIn, from.decimals);
        let q = await getMonorailQuote({
          fromAddress: from.address, toAddress: to.address,
          amount: amountIn, slippageBps, sender,
        });
        if (!q) throw new Error('no route');

        let swapFrom = from.address;

        // Native-MON routes that touch an orderbook / split across pools revert
        // inside the router's native-value handling (Monorail reports hops:1 but
        // splits across kuru-ob/octoswap/uniswap). Rather than guess which are
        // safe, ALWAYS wrap MON→WMON first when buying a token, then route from
        // WMON (a plain ERC20 route, e.g. WMON→token is a single clean hop). The
        // only native swap we leave alone is MON→WMON itself (a pure wrap).
        const toIsWmon = to.address.toLowerCase() === WMON.toLowerCase();
        if (isNativeAddr(from.address) && !toIsWmon) {
          setTx({ status: 'pending', message: 'wrapping MON…' });
          const wrapHash = await writeContractAsync({
            address: WMON as Address, abi: WMON_ABI, functionName: 'deposit', value: amtIn,
          } as any);
          setTxHash(wrapHash);
          await publicClient.waitForTransactionReceipt({ hash: wrapHash });
          q = await getMonorailQuote({
            fromAddress: WMON, toAddress: to.address,
            amount: amountIn, slippageBps, sender,
          });
          if (!q) throw new Error('no route after wrap');
          swapFrom = WMON;
        }

        // ERC20 input (a real token, or WMON after wrapping) must approve the
        // router before it can pull funds. Native MON skips this.
        const router = q.transaction.to;
        if (!isNativeAddr(swapFrom)) {
          const current = (await publicClient.readContract({
            address: swapFrom as Address, abi: WMON_ABI, functionName: 'allowance', args: [sender, router],
          })) as bigint;
          if (current < amtIn) {
            setTx({ status: 'pending', message: `approving ${swapFrom === WMON ? 'WMON' : from.symbol}…` });
            const apHash = await writeContractAsync({
              address: swapFrom as Address, abi: WMON_ABI, functionName: 'approve', args: [router, amtIn],
            } as any);
            setTxHash(apHash);
            await publicClient.waitForTransactionReceipt({ hash: apHash });
          }
        }

        setTx({ status: 'pending', message: 'swapping…' });
        const exec = toExecutable(q);
        const hash = await sendTransactionAsync({ to: exec.to, data: exec.data, value: exec.value });
        setTxHash(hash);
        setTx({ status: 'pending', message: 'confirming...' });
      }
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || 'error';
      setTx({ status: 'error', message: msg.slice(0, 80) });
    }
  }

  function flip() {
    setFrom(to);
    setTo(from);
    setAmountIn('');
  }

  // ----- Submit gate -----
  const hasQuote = route === 'curve' ? curveOut !== null && curveOut > 0n : !!mQuote;
  const preflightOk = route !== 'curve' || (preflight?.ok ?? true);
  const disableReason = crossCurve.disabled
    ? crossCurve.reason
    : (route === 'curve' && preflight && preflight.ok === false ? preflight.reason : null);
  const submitDisabled = !address || !hasQuote || !preflightOk || crossCurve.disabled || tx.status === 'pending';
  const submitLabel = !address ? 'Connect wallet' : crossCurve.disabled ? 'Two-step required' : !hasQuote ? 'Enter amount' : needsApproval ? `Approve ${from.symbol} + Swap` : 'Swap';

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: 24, color: '#fff' }}>
      <Head>
        <title>Swap | Mon-Pad</title>
        <meta key="description" name="description" content="Swap tokens on Monad. Mon-Pad routes pre-graduation tokens through the bonding curve and graduated tokens via Monorail aggregator." />
        <meta key="og:title" property="og:title" content="Swap | Mon-Pad" />
        <meta key="og:description" property="og:description" content="Swap tokens on Monad. Bonding curve + Monorail dual-router." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Swap | Mon-Pad" />
        <meta key="twitter:description" name="twitter:description" content="Swap tokens on Monad." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      <h1 style={{ marginBottom: 16 }}>Swap</h1>
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 16 }}>
        <TokenInput label="From" token={from} setToken={setFrom} amount={amountIn} setAmount={setAmountIn} onPickerOpen={() => setPickerOpen('from')} />
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <button onClick={flip} style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 6, color: 'var(--brand, #A78BFA)', padding: '4px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><ArrowDownUp size={16} /></button>
        </div>
        <TokenInput label="To" token={to} setToken={setTo} amount={outAmount} setAmount={() => {}} readOnly onPickerOpen={() => setPickerOpen('to')} />
        <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>Slippage</span>
          {[100, 500, 1000].map((bps) => (
            <button key={bps} onClick={() => setSlippageBps(bps)} style={{ padding: '4px 10px', fontSize: 12, background: slippageBps === bps ? 'var(--brand, #A78BFA)' : 'rgba(255,255,255,0.05)', color: slippageBps === bps ? '#000' : '#aaa', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{bps / 100}%</button>
          ))}
          <button onClick={() => setRefreshTick((n) => n + 1)} aria-label="Refresh quote" style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 12, background: 'rgba(255,255,255,0.05)', color: '#aaa', border: 'none', borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><RefreshCw size={12} /> Refresh</button>
        </div>
        <RouteLabel route={route} disabledReason={disableReason} />
        {loadingQuote && route === 'monorail' && <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>quoting...</div>}
        {hasQuote && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
            Min received: {minOut} {to.symbol}
            {priceImpactPct !== null && (
              <span style={{ marginLeft: 12, color: priceImpactPct > 2 ? '#f93' : '#aaa' }}>Price impact: {priceImpactPct.toFixed(2)}%</span>
            )}
          </div>
        )}
        <button
          onClick={handleSwap}
          disabled={submitDisabled}
          style={{ width: '100%', marginTop: 16, padding: 14, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: submitDisabled ? 'not-allowed' : 'pointer', opacity: submitDisabled ? 0.5 : 1 }}
        >
          {submitLabel}
        </button>
        <StatusPill state={tx} />
      </div>
      <TokenPicker
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        onSelect={(token) => {
          if (pickerOpen === 'from') setFrom(token);
          else if (pickerOpen === 'to') setTo(token);
          setPickerOpen(null);
        }}
        currentSelected={pickerOpen === 'from' ? from.address : to.address}
      />
      <div style={{ marginTop: 8, fontSize: 10, color: '#555', textAlign: 'center' }}>API: {MONORAIL_API}</div>
    </div>
  );
}

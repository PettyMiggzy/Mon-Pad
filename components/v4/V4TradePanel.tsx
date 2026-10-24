// Buy / sell a Monpad V4 token against USDC through MonpadV4Router. Every trade sets a minimum-out from a live quote.
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { formatUnits, parseUnits, type Address } from 'viem';
import { QUOTE_DECIMALS, ROUTER_V4, TOKEN_DECIMALS } from '@/lib/v4/config';
import { erc20V4Abi, routerV4Abi } from '@/lib/v4/abis';
import { deadline, getQuoteAsset, poolKeyFor, quoteBuy, quoteSell, usdcPerToken, type V4Token } from '@/lib/v4/chain';
import { useToast } from '@/components/ui/Toast';

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : d }) : '—');

function friendly(e: any): string {
  const m = String(e?.shortMessage || e?.message || 'Trade failed');
  if (/slippage|too little|Slippage/i.test(m)) return 'Price moved past your slippage limit. Try again or raise slippage.';
  if (/blacklist|paused/i.test(m)) return 'USDC refused the transfer (paused or blacklisted).';
  if (/User rejected|denied/i.test(m)) return 'Cancelled in wallet.';
  return m.slice(0, 140);
}

export default function V4TradePanel({ token, onTraded }: { token: V4Token; onTraded?: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slipBps, setSlipBps] = useState(100);
  const [quote, setQuote] = useState<{ out: bigint; approx: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<Address | null>(null);
  useEffect(() => { getQuoteAsset().then(setUsdc).catch(() => {}); }, []);

  const inDec = side === 'buy' ? QUOTE_DECIMALS : TOKEN_DECIMALS;
  let amtWei = 0n;
  try { if (amount && Number(amount) > 0) amtWei = parseUnits(amount, inDec); } catch { /* invalid input */ }

  const asset = (side === 'buy' ? usdc : token.address) as Address | null;
  const { data: balRaw, refetch: refetchBal } = useReadContract({ address: asset as Address, abi: erc20V4Abi, functionName: 'balanceOf', args: [address as Address], query: { enabled: !!asset && !!address } });
  const { data: allowRaw, refetch: refetchAllow } = useReadContract({ address: asset as Address, abi: erc20V4Abi, functionName: 'allowance', args: [address as Address, ROUTER_V4], query: { enabled: !!asset && !!address } });
  const bal = (balRaw as bigint | undefined) ?? 0n;
  const allowance = (allowRaw as bigint | undefined) ?? 0n;

  // Live quote (debounced). Falls back to a spot-price estimate if the RPC rejects the simulation.
  useEffect(() => {
    setQuote(null);
    if (amtWei <= 0n) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const out = side === 'buy' ? await quoteBuy(token.address, amtWei, address) : await quoteSell(token.address, amtWei, address);
        if (!cancelled) setQuote({ out, approx: false });
      } catch {
        if (cancelled || !token.priceUsdc) return;
        const fee = 1 - token.totalFeeBps / 10000;
        const n = Number(formatUnits(amtWei, inDec));
        const est = side === 'buy' ? (n / token.priceUsdc) * fee : n * token.priceUsdc * fee;
        setQuote({ out: parseUnits(est.toFixed(side === 'buy' ? TOKEN_DECIMALS : QUOTE_DECIMALS), side === 'buy' ? TOKEN_DECIMALS : QUOTE_DECIMALS), approx: true });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, amount, token.address, address]);

  const outDec = side === 'buy' ? TOKEN_DECIMALS : QUOTE_DECIMALS;
  const minOut = quote ? (quote.out * BigInt(10000 - slipBps)) / 10000n : 0n;

  async function trade() {
    if (!address || !publicClient || !usdc || amtWei <= 0n || !quote || minOut <= 0n) return;
    setError(null);
    try {
      if (allowance < amtWei) {
        setBusy('Approving…');
        const ah = await writeContractAsync({ address: asset as Address, abi: erc20V4Abi, functionName: 'approve', args: [ROUTER_V4, amtWei] } as any);
        await publicClient.waitForTransactionReceipt({ hash: ah });
      }
      setBusy(side === 'buy' ? 'Buying…' : 'Selling…');
      const key = poolKeyFor(token.address, usdc);
      const hash = await writeContractAsync({
        address: ROUTER_V4, abi: routerV4Abi, functionName: side === 'buy' ? 'buyWithUsdc' : 'sellToUsdc',
        args: [key, amtWei, minOut, deadline(), 0n],
      } as any);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction failed');
      toast.push(side === 'buy' ? 'Bought.' : 'Sold.');
      setAmount('');
      refetchBal(); refetchAllow(); onTraded?.();
    } catch (e: any) {
      const msg = friendly(e); setError(msg); toast.push(msg, 'err');
    } finally { setBusy(null); }
  }

  const setPct = (p: number) => { if (bal > 0n) setAmount(formatUnits((bal * BigInt(p)) / 100n, inDec)); };
  const insufficient = !!address && amtWei > bal;
  const disabled = !address || !!busy || amtWei <= 0n || !quote || insufficient || minOut <= 0n;
  const btn = !address ? 'Connect wallet' : busy ? busy : amtWei <= 0n ? 'Enter an amount' : insufficient ? `Not enough ${side === 'buy' ? 'USDC' : token.symbol}` : !quote ? 'Getting quote…' : side === 'buy' ? 'Buy' : 'Sell';

  return (
    <div className="v4-trade" style={{ padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setSide(s); setAmount(''); setError(null); }} aria-pressed={side === s}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: side === s ? (s === 'buy' ? 'rgba(61,255,154,0.18)' : 'rgba(255,92,122,0.18)') : 'transparent', color: '#fff', textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>
      <label style={{ fontSize: 12, color: '#aaa' }}>{side === 'buy' ? 'Spend (USDC)' : `Sell (${token.symbol})`}</label>
      <input type="text" inputMode="decimal" value={amount} placeholder="0.0" aria-label="Amount" onChange={(e) => setAmount(e.target.value)}
        style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 16 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 12, color: '#999' }}>
        <span>Balance: {address ? fmt(Number(formatUnits(bal, inDec)), 4) : '—'}</span>
        <span style={{ display: 'flex', gap: 6 }}>{[25, 50, 100].map((p) => <button key={p} type="button" onClick={() => setPct(p)} style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 11 }}>{p === 100 ? 'Max' : `${p}%`}</button>)}</span>
      </div>
      <div style={{ marginTop: 12, fontSize: 13, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#aaa' }}>You receive{quote?.approx ? ' (approx)' : ''}</span><span data-testid="v4-out">{quote ? `${fmt(Number(formatUnits(quote.out, outDec)))} ${side === 'buy' ? token.symbol : 'USDC'}` : '—'}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#aaa' }}>Minimum after slippage</span><span>{quote ? fmt(Number(formatUnits(minOut, outDec))) : '—'}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#aaa' }}>Trade fee</span><span>{token.totalFeeBps / 100}%</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: '#aaa' }}>Slippage</span>
          <span style={{ display: 'flex', gap: 6 }}>{[50, 100, 300].map((b) => <button key={b} type="button" onClick={() => setSlipBps(b)} aria-pressed={slipBps === b} style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${slipBps === b ? 'rgba(236,72,153,0.7)' : 'rgba(255,255,255,0.15)'}`, background: slipBps === b ? 'rgba(236,72,153,0.2)' : 'transparent', color: '#fff', cursor: 'pointer', fontSize: 11 }}>{b / 100}%</button>)}</span></div>
      </div>
      <button type="button" className="pad-launch" onClick={trade} disabled={disabled} style={{ width: '100%', marginTop: 14, opacity: disabled ? 0.5 : 1 }}>{btn}</button>
      {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--err, #F87171)' }}>{error}</div>}
      <div style={{ marginTop: 10, fontSize: 11, color: '#777', lineHeight: 1.4 }}>Trades are in USDC. USDC is issued by Circle and can be paused or blacklist an address.</div>
    </div>
  );
}

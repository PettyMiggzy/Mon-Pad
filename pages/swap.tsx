import { useEffect, useMemo, useState } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { ArrowDownUp, ChevronDown } from 'lucide-react';
import TokenPicker from '@/components/TokenPicker';
import { parseEther, formatEther, type Address } from 'viem';
import { MONORAIL_API, MONORAIL_PARTNER_ID } from '@/lib/constants';
import Head from 'next/head';
import { useRouter } from 'next/router';

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };

type TokenOption = { symbol: string; address: string; decimals: number; name?: string; imageUrl?: string };

const COMMON_TOKENS: TokenOption[] = [
  { symbol: 'MON', name: 'Monad', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
  { symbol: 'WMON', name: 'Wrapped Monad', address: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701', decimals: 18 },
  { symbol: 'MONSHI', name: 'Monshi', address: '0xB744F5CDb792d8187640214C4A1c9aCE29af7777', decimals: 18 }, // TODO: replace with real MONSHI addr
];

function StatusPill({ state }: { state: TxState }) {
  if (state.status === 'idle') return null;
  const color = state.status === 'pending' ? '#888' : state.status === 'success' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)';
  return <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, border: `1px solid ${color}`, color, fontSize: 13 }}>{state.message || state.status}</div>;
}

export default function SwapPage() {
  const router = useRouter();
  const canonical = `https://www.monpad.net${router.asPath.split('?')[0]}`;
  const { address } = useAccount();
  const [from, setFrom] = useState<TokenOption>(COMMON_TOKENS[0]);
  const [to, setTo] = useState<TokenOption>(COMMON_TOKENS[1]);
  const [pickerOpen, setPickerOpen] = useState<'from' | 'to' | null>(null);
  const [amountIn, setAmountIn] = useState('');
  const [slippageBps, setSlippageBps] = useState(500);
  const [quote, setQuote] = useState<any>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const { sendTransactionAsync } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => { if (isSuccess) setTx({ status: 'success', message: 'swap confirmed' }); }, [isSuccess]);

  // Debounced quote fetch
  useEffect(() => {
    if (!amountIn || isNaN(Number(amountIn)) || Number(amountIn) <= 0) { setQuote(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoadingQuote(true);
      try {
        const params = new URLSearchParams({
          from: from.address,
          to: to.address,
          amount: parseEther(amountIn).toString(),
          sender: address || '0x0000000000000000000000000000000000000000',
          slippage: String(slippageBps),
          ...(MONORAIL_PARTNER_ID ? { partner: MONORAIL_PARTNER_ID } : {}),
        });
        const res = await fetch(`${MONORAIL_API}/quote?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`quote http ${res.status}`);
        setQuote(await res.json());
      } catch (e: any) {
        if (e.name !== 'AbortError') setQuote(null);
      } finally {
        setLoadingQuote(false);
      }
    }, 350);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [amountIn, from.address, to.address, address, slippageBps]);

  async function swap() {
    if (!address || !quote?.tx) return;
    setTx({ status: 'pending', message: 'submitting swap...' });
    try {
      const hash = await sendTransactionAsync({
        to: quote.tx.to as Address,
        data: quote.tx.data as `0x${string}`,
        value: quote.tx.value ? BigInt(quote.tx.value) : 0n,
      });
      setTxHash(hash);
      setTx({ status: 'pending', message: 'confirming...' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 80) });
    }
  }

  function flip() { setFrom(to); setTo(from); setAmountIn(''); setQuote(null); }

  const outAmount = useMemo(() => {
    if (!quote) return null;
    try { return formatEther(BigInt(quote.outAmount || quote.amountOut || '0')); } catch { return null; }
  }, [quote]);

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
          <button onClick={flip} style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 6, color: 'var(--brand, #A78BFA)', padding: '4px 12px', cursor: 'pointer' }}>\u21c5</button>
        </div>
        <TokenInput label="To" token={to} setToken={setTo} amount={outAmount || ''} setAmount={() => {}} readOnly onPickerOpen={() => setPickerOpen('to')} />
        <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>Slippage</span>
          {[100, 500, 1000].map((bps) => (
            <button key={bps} onClick={() => setSlippageBps(bps)} style={{ padding: '4px 10px', fontSize: 12, background: slippageBps === bps ? 'var(--brand, #A78BFA)' : 'rgba(255,255,255,0.05)', color: slippageBps === bps ? '#000' : '#aaa', border: 'none', borderRadius: 4, cursor: 'pointer' }}>{bps / 100}%</button>
          ))}
        </div>
        {loadingQuote && <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>quoting...</div>}
        {quote && quote.priceImpact && <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>Price impact: {(quote.priceImpact * 100).toFixed(2)}%</div>}
        <button onClick={swap} disabled={!address || !quote?.tx || tx.status === 'pending'} style={{ width: '100%', marginTop: 16, padding: 14, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: (!address || !quote?.tx) ? 'not-allowed' : 'pointer', opacity: (!address || !quote?.tx) ? 0.5 : 1 }}>
          {!address ? 'Connect wallet' : !quote?.tx ? 'Enter amount' : 'Swap'}
        </button>
        <StatusPill state={tx} />
      </div>
      <TokenPicker
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        onSelect={(token) => {
          if (pickerOpen === 'from') setFrom(token);
          else if (pickerOpen === 'to') setTo(token);
        }}
        currentSelected={pickerOpen === 'from' ? from.address : pickerOpen === 'to' ? to.address : undefined}
      />
    </div>
  );
}

function TokenInput({ label, token, amount, setAmount, readOnly, onPickerOpen }: { label: string; token: TokenOption; setToken: (t: TokenOption) => void; amount: string; setAmount: (v: string) => void; readOnly?: boolean; onPickerOpen: () => void }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" inputMode="decimal" readOnly={readOnly} style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 22, outline: 'none', minWidth: 0 }} />
        <button onClick={onPickerOpen} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-border transition-colors">
          {token.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={token.imageUrl} alt={token.symbol} className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-brand-purple flex items-center justify-center text-xs text-white font-bold">{token.symbol[0]}</div>
          )}
          <span className="text-white font-semibold">{token.symbol}</span>
          <ChevronDown size={16} className="text-white/50" />
        </button>
      </div>
    </div>
  );
}

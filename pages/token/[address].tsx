import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, type Address } from 'viem';
import { curveV3Abi, tokenAbi } from '@/lib/abis';
import V3TokenActivity from '@/components/V3TokenActivity';
import { getV3Trades, type V3Trade } from '@/lib/chainV3';
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

// Sanitize creator-supplied social links before using them as an href. Only
// http(s) URLs are allowed; javascript:/data:/etc. are rejected (would otherwise
// be a stored-XSS vector in the wallet-connected origin). Bare domains get https://.
function safeUrl(u?: string | null): string | undefined {
  if (!u || typeof u !== 'string') return undefined;
  const s = u.trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#]|$)/i.test(s)) return `https://${s}`; // bare domain
  return undefined; // reject javascript:, data:, mailto:, @handles, etc.
}

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

  const meta = useReadContracts(({
    contracts: addr ? [
      { address: addr, abi: tokenAbi as any, functionName: 'name' },
      { address: addr, abi: tokenAbi as any, functionName: 'symbol' },
    ] : [],
    query: { enabled: !!addr },
  }) as any);
  const name = (meta.data?.[0]?.result as string) || 'Token';
  const symbol = (meta.data?.[1]?.result as string) || '';

  // Off-chain metadata (logo + socials + description) — same-origin, best-effort.
  const [tokenMeta, setTokenMeta] = useState<{ image_url?: string; description?: string; twitter?: string; telegram?: string; website?: string; created_at?: string } | null>(null);
  useEffect(() => {
    if (!addr) return;
    let cancelled = false;
    fetch(`/api/token-meta?address=${addr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setTokenMeta(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [addr]);

  const state = useReadContracts(({
    contracts: curve ? [
      { address: curve, abi: curveV3Abi as any, functionName: 'getCurveReserves' },
      { address: curve, abi: curveV3Abi as any, functionName: 'monRaisedNet' },
      { address: curve, abi: curveV3Abi as any, functionName: 'graduated' },
      { address: curve, abi: curveV3Abi as any, functionName: 'creator' },
      { address: curve, abi: curveV3Abi as any, functionName: 'tradeTaxBps' },
    ] : [],
    query: { enabled: !!curve, refetchInterval: 8000 },
  }) as any);

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

  // The connected wallet's balance of this token (so we show "you hold X").
  const balanceRead = useReadContract({
    address: addr, abi: tokenAbi as any, functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!addr && !!wallet, refetchInterval: 10000 },
  });
  const balance = (balanceRead.data as bigint) ?? 0n;

  // After any buy/sell, immediately refresh curve state + balance (don't wait for
  // the poll interval) and bump a nonce so the chart/trades reload right away.
  const [tradeNonce, setTradeNonce] = useState(0);
  const refreshAfterTrade = () => {
    setTradeNonce((n) => n + 1);
    state.refetch?.();
    balanceRead.refetch?.();
  };

  // Page-level trades (shares the getV3Trades cache with the chart) → live stats.
  const [pageTrades, setPageTrades] = useState<V3Trade[]>([]);
  useEffect(() => {
    if (!curve) return;
    let cancelled = false;
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      getV3Trades(curve).then((t) => { if (!cancelled) setPageTrades(t); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [curve, tradeNonce]);

  const stats = useMemo(() => {
    const vol = pageTrades.reduce((s, t) => s + (t.mon || 0), 0);
    const buys = pageTrades.filter((t) => t.isBuy).length;
    const sells = pageTrades.length - buys;
    const traders = new Set(pageTrades.map((t) => (t.trader || '').toLowerCase())).size;
    const priced = pageTrades.filter((t) => t.price > 0).sort((a, b) => a.time - b.time);
    const change = priced.length > 1 ? ((priced[priced.length - 1].price - priced[0].price) / priced[0].price) * 100 : 0;
    return { vol, txns: pageTrades.length, buys, sells, traders, change };
  }, [pageTrades]);

  // Spot price (MON per token) + market cap, from the live curve reserves.
  const effMon = reserves ? reserves.vm + reserves.rm : 0n;
  const effTok = reserves ? reserves.vt - (SUPPLY - reserves.rt) : 0n;
  const priceMon = effMon > 0n && effTok > 0n ? Number(formatEther(effMon)) / Number(formatEther(effTok)) : 0;
  const mcapMon = priceMon * 1_000_000_000;

  // MON/USD for USD display (DexScreener via same-origin /api/mon-price).
  const [monUsd, setMonUsd] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/mon-price').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d?.usd) setMonUsd(d.usd); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: 16, color: '#fff' }}>
      <Head>
        <title>{`${name}${symbol ? ` (${symbol})` : ''} | Mon-Pad`}</title>
        <meta key="description" name="description" content={`Trade ${symbol || name} on Mon-Pad — native-MON bonding curve on Monad.`} />
        <link key="canonical" rel="canonical" href={`https://www.monpad.net/token/${addr}`} />
      </Head>

      {/* Header: logo, name, links/socials + price chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {tokenMeta?.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tokenMeta.image_url} alt={symbol || name} width={52} height={52} style={{ borderRadius: 12, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>{name}</h1>
            <span style={{ color: '#888' }}>${symbol}</span>
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <CopyChip addr={addr} label="CA" />
            {creator && <span>by <Link href={`/profile/${creator}`} style={{ color: 'var(--brand, #A78BFA)' }}>{shortAddr(creator)}</Link></span>}
            <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)' }}>contract</a>
            {curve && <a href={`${MONAD_EXPLORER}/address/${curve}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)' }}>curve</a>}
            {safeUrl(tokenMeta?.website) && <a href={safeUrl(tokenMeta?.website)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--brand, #A78BFA)' }}>web</a>}
            {safeUrl(tokenMeta?.twitter) && <a href={safeUrl(tokenMeta?.twitter)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--brand, #A78BFA)' }}>x</a>}
            {safeUrl(tokenMeta?.telegram) && <a href={safeUrl(tokenMeta?.telegram)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--brand, #A78BFA)' }}>tg</a>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <HeaderStat label="Price" value={`${fmtNum(priceMon, 8)} MON`} sub={monUsd ? `$${fmtNum(priceMon * monUsd, 8)}` : undefined} />
          <HeaderStat label="Market cap" value={`${fmtNum(mcapMon)} MON`} sub={monUsd ? `$${fmtNum(mcapMon * monUsd)}` : undefined} />
          <HeaderStat label="Change" value={`${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(1)}%`} color={stats.change > 0 ? '#4ADE80' : stats.change < 0 ? '#F87171' : undefined} />
        </div>
      </div>
      {tokenMeta?.description && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 10, lineHeight: 1.5 }}>{tokenMeta.description}</p>
      )}

      {/* DEX-style: chart + trades on the left, trade panel + stats on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ marginTop: 16 }}>
        <main className="lg:col-span-2" style={{ minWidth: 0 }}>
          <V3TokenActivity curve={curve} symbol={symbol} token={addr} refreshKey={tradeNonce} />
        </main>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <GraduationBar progress={progress} remaining={remaining} graduated={graduated} canGrad={canGrad} curve={curve} onTraded={refreshAfterTrade} />
          <TradePanel token={addr} curve={curve} symbol={symbol} reserves={reserves} graduated={graduated} tradeTax={tradeTax} balance={balance} onTraded={refreshAfterTrade} />
          {wallet && balance > 0n && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', padding: '0 2px' }}>
              You hold <b style={{ color: '#fff' }}>{Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> ${symbol}
            </div>
          )}
          <StatsCard priceMon={priceMon} mcapMon={mcapMon} stats={stats} monUsd={monUsd} />
          <CreatorPanel curve={curve} creator={creator} wallet={wallet} graduated={graduated} />
          <OtherInfo addr={addr} curve={curve} creator={creator} createdAt={tokenMeta?.created_at} />
        </aside>
      </div>
    </div>
  );
}

// Inline "shortAddr + copy" used in info rows: click copies the FULL address.
function CopyText({ addr }: { addr?: string }) {
  const [copied, setCopied] = useState(false);
  if (!addr) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <button
        onClick={async (e) => { e.preventDefault(); try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}
        title={`Copy ${addr}`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, color: copied ? '#4ADE80' : 'var(--brand,#A78BFA)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        {`${addr.slice(0, 6)}…${addr.slice(-4)}`}<span style={{ fontFamily: 'system-ui, sans-serif' }}>{copied ? '✓' : '⧉'}</span>
      </button>
      <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" title="View on explorer" style={{ color: '#667', fontSize: 12, textDecoration: 'none' }}>↗</a>
    </span>
  );
}

// Copyable contract-address chip — one click copies the FULL address.
function CopyChip({ addr, label = 'CA' }: { addr?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!addr) return null;
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  return (
    <button
      onClick={copy}
      title={`Copy ${label}: ${addr}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999,
        background: copied ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.12)'}`,
        color: copied ? '#4ADE80' : '#cbd5e1', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'monospace',
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      {`${addr.slice(0, 6)}…${addr.slice(-4)}`}
      <span style={{ fontFamily: 'system-ui, sans-serif' }}>{copied ? '✓ copied' : '⧉'}</span>
    </button>
  );
}

// Subscript digits for the leading-zero count in tiny prices (DexScreener style).
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
function toSub(num: number): string {
  return String(num).split('').map((d) => SUBS[+d] ?? d).join('');
}

function fmtNum(n: number, maxFrac = 2): string {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  // Tiny values: render 0.0₇304 instead of "3.04e-8" (count = leading zeros after the
  // decimal). Crypto-native + readable; matches DexScreener/DEXTools.
  if (a < 0.0001) {
    let exp = Math.floor(Math.log10(a));
    // Round the mantissa to 4 sig figs FIRST; if it carries to 10.000 the value
    // crossed a decade, so bump the exponent (otherwise zeros/digits disagree and
    // the rendered price is off by 10x, e.g. 0.000099999).
    let mant = Math.round((a / Math.pow(10, exp)) * 1000); // 1000..10000
    if (mant >= 10000) { mant = 1000; exp += 1; }
    const zeros = -exp - 1;
    const digits = String(mant); // 4 significant figures (DexScreener style)
    return `${n < 0 ? '-' : ''}0.0${toSub(zeros)}${digits}`;
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.max(maxFrac, 4) });
}

function HeaderStat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || '#fff' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>}
    </div>
  );
}

function StatTile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || '#fff', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#888' }}>{sub}</div>}
    </div>
  );
}

function StatsCard({ priceMon, mcapMon, stats, monUsd }: { priceMon: number; mcapMon: number; stats: { vol: number; txns: number; buys: number; sells: number; traders: number; change: number }; monUsd: number }) {
  const usd = (m: number) => (monUsd ? `$${fmtNum(m * monUsd, m < 1 ? 8 : 2)}` : undefined);
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Stats</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatTile label="Price" value={`${fmtNum(priceMon, 8)} MON`} sub={usd(priceMon)} />
        <StatTile label="Market cap" value={`${fmtNum(mcapMon)} MON`} sub={usd(mcapMon)} />
        <StatTile label="Volume" value={`${fmtNum(stats.vol)} MON`} sub={usd(stats.vol)} />
        <StatTile label="Txns" value={String(stats.txns)} />
        <StatTile label="Buys / Sells" value={`${stats.buys} / ${stats.sells}`} color={stats.buys >= stats.sells ? '#4ADE80' : '#F87171'} />
        <StatTile label="Traders" value={String(stats.traders)} />
      </div>
    </div>
  );
}

function OtherInfo({ addr, curve, creator, createdAt }: { addr?: Address; curve?: Address; creator?: Address; createdAt?: string }) {
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '4px 0' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#ddd', textAlign: 'right' }}>{children}</span>
    </div>
  );
  let created = '';
  if (createdAt) { try { created = new Date(createdAt).toLocaleDateString(); } catch { created = ''; } }
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Other info</div>
      {creator && <Row label="Creator"><Link href={`/profile/${creator}`} style={{ color: 'var(--brand,#A78BFA)' }}>{shortAddr(creator)}</Link></Row>}
      {addr && <Row label="Contract"><CopyText addr={addr} /></Row>}
      {curve && <Row label="Curve"><CopyText addr={curve} /></Row>}
      {created && <Row label="Created">{created}</Row>}
    </div>
  );
}

function GraduationBar({ progress, remaining, graduated, canGrad, curve, onTraded }: { progress: number; remaining: bigint; graduated: boolean; canGrad: boolean; curve?: Address; onTraded?: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  if (graduated) return <div style={{ marginTop: 16, padding: 12, background: 'rgba(74,222,128,0.1)', border: '1px solid var(--ok, #4ADE80)', borderRadius: 8, color: 'var(--ok, #4ADE80)', fontSize: 13 }}>Graduated — trading on the DEX (WMON/token pool).</div>;
  async function doGrad() {
    if (!curve) return;
    setTx({ status: 'pending' });
    try {
      const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'graduate', args: [] } as any);
      setTx({ status: 'pending', message: 'graduating... ' + h.slice(0, 10) });
      setTimeout(() => onTraded?.(), 3000);
    }
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

function TradePanel({ token, curve, symbol, reserves, graduated, tradeTax, balance = 0n, onTraded }: { token?: Address; curve?: Address; symbol: string; reserves: Reserves | null; graduated: boolean; tradeTax: bigint; balance?: bigint; onTraded?: () => void }) {
  const { address } = useAccount();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const slippageBps = 500n; // 5%
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (isSuccess) {
      setTx({ status: 'success', message: 'confirmed' });
      setAmount('');
      onTraded?.(); // refresh curve state, balance, chart on the parent
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

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
      <div style={{ marginTop: 16, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 8, padding: 16, color: '#ddd', fontSize: 13, lineHeight: 1.6 }}>
        🎓 <b style={{ color: '#fff' }}>Graduated</b> — now trading on a Uniswap V3 pool (liquidity locked).
        <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {/* Deep-link so the swap page pre-selects MON → this token (resolved on-chain). */}
          <Link href={`/swap?from=0x0000000000000000000000000000000000000000&to=${token}`} style={{ color: 'var(--brand,#A78BFA)' }}>Swap in-app</Link>
          {token && <a href={`${MONAD_EXPLORER}/token/${token}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand,#A78BFA)' }}>View on explorer</a>}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
          Freshly graduated? DEX aggregators (and in-app swap routing) can take a few minutes to index a brand-new pool. The pool is live on-chain immediately.
        </div>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#888' }}>Amount in {inLabel}</label>
        {side === 'sell' && balance > 0n && (
          <button type="button" onClick={() => setAmount(formatEther(balance))} style={{ fontSize: 11, color: 'var(--brand,#A78BFA)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            Hold: {Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })} · Max
          </button>
        )}
      </div>
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

  const reads = useReadContracts(({
    contracts: (isCreator && curve) ? [
      { address: curve, abi: curveV3Abi as any, functionName: 'creatorPending' },
      { address: curve, abi: curveV3Abi as any, functionName: 'graduationRewardClaimable' },
    ] : [],
    query: { enabled: isCreator && !!curve, refetchInterval: 15000 },
  }) as any);
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

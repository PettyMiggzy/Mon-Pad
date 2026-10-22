import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, type Address } from 'viem';
import { motion } from 'framer-motion';
import { Flame, Share2, ExternalLink, Copy, Wrench, Zap, Shield, Wallet, Link2 } from 'lucide-react';
import { curveV3Abi, tokenAbi } from '@/lib/abis';
import V3TokenActivity from '@/components/V3TokenActivity';
import MonshiBurnCounter from '@/components/MonshiBurnCounter';
import { getV3Trades, type V3Trade } from '@/lib/chainV3';
import { getDemoToken } from '@/lib/mocks';
import {
  MONAD_EXPLORER, V3_GRADUATION_TARGET_MON,
  V3_BUY_FEE_CREATOR_BPS, V3_BUY_FEE_BUFFER_BPS,
  V3_SELL_FEE_CREATOR_BPS, V3_SELL_FEE_STAKING_BPS, V3_SELL_FEE_PLATFORM_BPS,
  V3_MAX_TRADE_TAX_BPS,
} from '@/lib/constants';

const SUPPLY = 1_000_000_000n * 10n ** 18n;
const GRAD_TARGET = V3_GRADUATION_TARGET_MON * 10n ** 18n;
const BUY_FEE_BASE = BigInt(V3_BUY_FEE_CREATOR_BPS + V3_BUY_FEE_BUFFER_BPS);
const SELL_FEE_BASE = BigInt(V3_SELL_FEE_CREATOR_BPS + V3_SELL_FEE_STAKING_BPS + V3_SELL_FEE_PLATFORM_BPS);

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };
function shortAddr(a?: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '?'; }

function safeUrl(u?: string | null): string | undefined {
  if (!u || typeof u !== 'string') return undefined;
  const s = u.trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#]|$)/i.test(s)) return `https://${s}`;
  return undefined;
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
  if (a < 0.0001) {
    let exp = Math.floor(Math.log10(a));
    let mant = Math.round((a / Math.pow(10, exp)) * 1000);
    if (mant >= 10000) { mant = 1000; exp += 1; }
    const zeros = -exp - 1;
    return `${n < 0 ? '-' : ''}0.0${toSub(zeros)}${String(mant)}`;
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.max(maxFrac, 4) });
}

export default function TokenPage() {
  const router = useRouter();
  const rawAddr = typeof router.query.address === 'string' ? router.query.address : undefined;
  const addr = (rawAddr && /^0x[a-fA-F0-9]{40}$/.test(rawAddr) ? rawAddr.toLowerCase() : undefined) as Address | undefined;
  const { address: wallet } = useAccount();

  const curveRead = useReadContract({ address: addr, abi: tokenAbi as any, functionName: 'curve', query: { enabled: !!addr } });
  const curve = curveRead.data as Address | undefined;

  const meta = useReadContracts(({
    contracts: addr ? [
      { address: addr, abi: tokenAbi as any, functionName: 'name' },
      { address: addr, abi: tokenAbi as any, functionName: 'symbol' },
    ] : [],
    query: { enabled: !!addr },
  }) as any);
  const demoTok = getDemoToken(addr);
  const name = demoTok?.name || (meta.data?.[0]?.result as string) || 'Token';
  const symbol = demoTok?.symbol || (meta.data?.[1]?.result as string) || '';

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
      { address: curve, abi: curveV3Abi as any, functionName: 'totalBurnedTokens' },
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
  const burnedTokens = (state.data?.[5]?.result as bigint) ?? 0n;
  const canGrad = monRaisedNet >= GRAD_TARGET && !graduated;

  const balanceRead = useReadContract({
    address: addr, abi: tokenAbi as any, functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!addr && !!wallet, refetchInterval: 10000 },
  });
  const balance = (balanceRead.data as bigint) ?? 0n;

  const [tradeNonce, setTradeNonce] = useState(0);
  const refreshAfterTrade = () => {
    setTradeNonce((n) => n + 1);
    state.refetch?.();
    balanceRead.refetch?.();
  };

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

  const effMon = reserves ? reserves.vm + reserves.rm : 0n;
  const effTok = reserves ? reserves.vt - (SUPPLY - reserves.rt) : 0n;
  const priceMon = effMon > 0n && effTok > 0n ? Number(formatEther(effMon)) / Number(formatEther(effTok)) : 0;
  const mcapMon = priceMon * 1_000_000_000;

  const [monUsd, setMonUsd] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/mon-price').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d?.usd) setMonUsd(d.usd); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const letter = (symbol || name || '?').slice(0, 1).toUpperCase();
  const shareUrl = typeof window !== 'undefined' && addr ? `${window.location.origin}/token/${addr}` : `https://www.monpad.net/token/${addr || ''}`;

  return (
    <div className="td-page">
      <Head>
        <title>{`${name}${symbol ? ` ($${symbol})` : ''} | Monpad`}</title>
        <meta key="description" name="description" content={`Trade $${symbol || name} on Monpad. Every trade burns Monshi.`} />
        {addr && <link key="canonical" rel="canonical" href={`https://www.monpad.net/token/${addr}`} />}
      </Head>

      <div className="td-atmos" aria-hidden />

      {/* Hero identity */}
      <motion.header
        className="td-hero"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <div className="td-hero-main">
          {(tokenMeta?.image_url || demoTok?.imageUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tokenMeta?.image_url || demoTok?.imageUrl} alt="" className="td-avatar" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="td-avatar td-avatar-fallback">{letter}</div>
          )}
          <div className="td-id">
            <div className="td-title-row">
              <h1 className="td-name">{name}</h1>
              <span className="td-ticker">${symbol}</span>
              <span className="td-pill td-pill-ok">Uniswap V3</span>
            </div>
            <p className="td-drive">
              <span className="td-drive-mark" aria-hidden />
              Every trade burns Monshi.
            </p>
            <div className="td-meta-row">
              <CopyChip addr={addr} label="CA" />
              {creator && (
                <span className="td-by">
                  by <Link href={`/profile/${creator}`}>{shortAddr(creator)}</Link>
                </span>
              )}
              {safeUrl(tokenMeta?.website) && <a className="td-social" href={safeUrl(tokenMeta?.website)} target="_blank" rel="noreferrer noopener">web</a>}
              {safeUrl(tokenMeta?.twitter) && <a className="td-social" href={safeUrl(tokenMeta?.twitter)} target="_blank" rel="noreferrer noopener">x</a>}
              {safeUrl(tokenMeta?.telegram) && <a className="td-social" href={safeUrl(tokenMeta?.telegram)} target="_blank" rel="noreferrer noopener">tg</a>}
            </div>
          </div>
        </div>
        <div className="td-price-strip">
          <HeaderStat label="Price" value={`${fmtNum(priceMon, 8)} MON`} sub={monUsd ? `$${fmtNum(priceMon * monUsd, 8)}` : undefined} />
          <HeaderStat label="Mcap" value={`${fmtNum(mcapMon)} MON`} sub={monUsd ? `$${fmtNum(mcapMon * monUsd)}` : undefined} />
          <HeaderStat
            label="Change"
            value={`${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(1)}%`}
            color={stats.change > 0 ? '#3DFF9A' : stats.change < 0 ? '#FF5C7A' : undefined}
          />
          <HeaderStat label="Vol" value={`${fmtNum(stats.vol)} MON`} />
        </div>
      </motion.header>

      {tokenMeta?.description ? <p className="td-desc">{tokenMeta.description}</p> : null}

      {/* Dual burn counters */}
      <motion.div
        className="td-burn-row"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
      >
        <div className="td-burn-monshi">
          <MonshiBurnCounter compact embedded />
        </div>
        <TokenBurnCard symbol={symbol} burned={burnedTokens} />
      </motion.div>

      <div className="td-grid">
        <main className="td-main">
          <V3TokenActivity curve={curve} symbol={symbol} token={addr} refreshKey={tradeNonce} />
          <StatsCard priceMon={priceMon} mcapMon={mcapMon} stats={stats} monUsd={monUsd} />
        </main>
        <aside className="td-aside">
          <TradePanel
            token={addr}
            curve={curve}
            symbol={symbol}
            reserves={reserves}
            graduated={graduated}
            tradeTax={tradeTax}
            balance={balance}
            onTraded={refreshAfterTrade}
          />
          {wallet && balance > 0n && (
            <div className="td-hold">
              You hold <b>{Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b> ${symbol}
            </div>
          )}
          <ToolsPanel
            addr={addr}
            curve={curve}
            symbol={symbol}
            name={name}
            imageUrl={tokenMeta?.image_url}
            shareUrl={shareUrl}
            graduated={graduated}
          />
          <CreatorTools
            curve={curve}
            creator={creator}
            wallet={wallet}
            graduated={graduated}
            symbol={symbol}
          />
          <LiquidityBar graduated={graduated} canGrad={canGrad} curve={curve} onTraded={refreshAfterTrade} />
          <OtherInfo addr={addr} curve={curve} creator={creator} createdAt={tokenMeta?.created_at} />
        </aside>
      </div>

      <style jsx global>{`
        .td-page {
          position: relative;
          max-width: 1200px;
          margin: 0 auto;
          padding: 16px 16px 64px;
          color: #fff;
        }
        .td-atmos {
          pointer-events: none;
          position: absolute;
          top: -40px; left: -8%; right: -8%;
          height: 340px;
          background:
            radial-gradient(ellipse 70% 80% at 12% 20%, rgba(181,123,255,0.22), transparent 60%),
            radial-gradient(ellipse 55% 70% at 88% 10%, rgba(255,77,154,0.16), transparent 55%);
          z-index: 0;
        }
        .td-page > *:not(.td-atmos) { position: relative; z-index: 1; }
        .td-hero {
          display: flex; flex-wrap: wrap; gap: 18px; justify-content: space-between; align-items: flex-end;
          padding: 22px 0 16px; border-bottom: 1px solid var(--bd);
        }
        .td-hero-main { display: flex; gap: 14px; align-items: center; min-width: 0; flex: 1; }
        .td-avatar {
          width: 84px; height: 84px; border-radius: 20px; object-fit: cover; flex-shrink: 0;
          border: 1px solid rgba(181,123,255,0.4);
          box-shadow: 0 16px 40px rgba(181,123,255,0.28);
        }
        .td-avatar-fallback {
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--p), var(--pink));
          font-family: var(--font-display); font-weight: 800; font-size: 32px;
        }
        .td-title-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .td-name {
          margin: 0; font-family: var(--font-display); font-size: clamp(28px, 4.5vw, 40px);
          font-weight: 800; letter-spacing: -0.03em; line-height: 1;
        }
        .td-ticker { color: var(--p2); font-weight: 700; font-size: 15px; }
        .td-drive {
          margin: 10px 0 0; font-size: 14px; font-weight: 800; letter-spacing: 0.12em;
          color: var(--pink); text-transform: uppercase;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .td-drive-mark {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--pink);
          box-shadow: 0 0 12px rgba(255,77,154,0.85);
          animation: tdPulse 1.6s ease-in-out infinite;
        }
        @keyframes tdPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.75); }
        }
        .td-meta-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; font-size: 12px; color: var(--t3); }
        .td-by a { color: var(--p2); text-decoration: none; font-weight: 600; }
        .td-social { color: var(--p2); text-decoration: none; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em; }
        .td-pill {
          font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(61,255,154,0.4);
          color: var(--green); background: rgba(61,255,154,0.1);
        }
        .td-price-strip { display: flex; gap: 20px; flex-wrap: wrap; }
        @media (max-width: 720px) {
          .td-hero { flex-direction: column; align-items: stretch; }
          .td-hero-main { width: 100%; }
          .td-price-strip { width: 100%; gap: 12px 16px; }
        }
        .td-desc { margin: 12px 0 0; font-size: 14px; line-height: 1.5; color: var(--t2); max-width: 72ch; }
        .td-burn-row {
          display: grid; grid-template-columns: 1.35fr 1fr; gap: 12px; margin: 16px 0;
        }
        .td-burn-monshi { min-height: 96px; }
        .td-burn-card {
          position: relative; overflow: hidden;
          border-radius: 14px; padding: 16px 18px;
          border: 1px solid rgba(255,77,154,0.4);
          background: linear-gradient(145deg, rgba(255,77,154,0.16), rgba(12,8,22,0.95) 55%, rgba(181,123,255,0.12));
          display: flex; flex-direction: column; gap: 4px; justify-content: center;
          min-height: 96px;
        }
        .td-burn-card::before {
          content: '';
          position: absolute; inset: auto -20% -40% 40%; height: 120%;
          background: radial-gradient(circle, rgba(255,77,154,0.25), transparent 65%);
          animation: tdBurnGlow 3.2s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes tdBurnGlow {
          0%, 100% { opacity: 0.55; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-6px); }
        }
        .td-burn-label {
          position: relative; z-index: 1;
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--pink);
        }
        .td-burn-label svg { animation: tdFlame 1.1s ease-in-out infinite; }
        @keyframes tdFlame {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-1px) scale(1.12); }
        }
        .td-burn-value {
          position: relative; z-index: 1;
          font-family: var(--mono); font-size: clamp(22px, 3vw, 28px); font-weight: 800; color: #fff;
          font-variant-numeric: tabular-nums;
        }
        .td-burn-sub { position: relative; z-index: 1; font-size: 12px; color: var(--t3); }
        .td-burn-pct {
          position: relative; z-index: 1;
          margin-top: 6px; height: 4px; border-radius: 999px;
          background: rgba(255,255,255,0.08); overflow: hidden;
        }
        .td-burn-pct > span {
          display: block; height: 100%; border-radius: inherit;
          background: linear-gradient(90deg, var(--pink), var(--p));
          box-shadow: 0 0 12px rgba(255,77,154,0.55);
        }
        .td-grid {
          display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(300px, 380px); gap: 14px; margin-top: 8px;
          align-items: start;
        }
        .td-main, .td-aside { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .td-panel {
          border-radius: 14px; padding: 14px;
          background: linear-gradient(180deg, rgba(28,18,48,0.75), rgba(12,8,22,0.9));
          border: 1px solid var(--bd);
        }
        .td-panel-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
          margin-bottom: 12px; color: var(--t2);
        }
        .td-hold { font-size: 13px; color: var(--t3); padding: 0 2px; }
        .td-hold b { color: #fff; }
        .td-tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .td-tool-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 10px 12px; border-radius: 10px; border: 1px solid var(--bd);
          background: rgba(255,255,255,0.03); color: #fff; font-size: 12px; font-weight: 700;
          text-decoration: none; cursor: pointer; transition: border-color 0.15s, background 0.15s, transform 0.15s;
        }
        .td-tool-btn:hover { border-color: rgba(181,123,255,0.5); background: rgba(181,123,255,0.1); transform: translateY(-1px); }
        @media (max-width: 960px) {
          .td-grid { grid-template-columns: 1fr; }
          .td-burn-row { grid-template-columns: 1fr; }
          .td-aside { order: -1; }
          .td-avatar { width: 68px; height: 68px; }
        }
      `}</style>
    </div>
  );
}

function TokenBurnCard({ symbol, burned }: { symbol: string; burned: bigint }) {
  const n = Number(formatEther(burned));
  const supply = 1_000_000_000;
  const pct = !Number.isFinite(n) || n <= 0 ? 0 : Math.min(100, (n / supply) * 100);
  const label = !Number.isFinite(n) || n <= 0 ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <div className="td-burn-card">
      <div className="td-burn-label"><Flame size={14} /> ${symbol || 'TOKEN'} burned</div>
      <div className="td-burn-value">{label}</div>
      <div className="td-burn-sub">
        {pct > 0 ? `${pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}% of supply → dead` : 'Protocol burn on every trade → dead'}
      </div>
      <div className="td-burn-pct" aria-hidden>
        <span style={{ width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct * 8))}%` }} />
      </div>
    </div>
  );
}

function ToolsPanel({
  addr, curve, symbol, name, imageUrl, shareUrl, graduated,
}: {
  addr?: Address; curve?: Address; symbol: string; name: string; imageUrl?: string; shareUrl: string; graduated: boolean;
}) {
  const [copied, setCopied] = useState('');
  const [walletMsg, setWalletMsg] = useState('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1200);
    } catch { /* ignore */ }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `$${symbol} on Monpad`, url: shareUrl });
      else await copy(shareUrl, 'share');
    } catch { /* ignore */ }
  }
  async function addToWallet() {
    if (!addr || typeof window === 'undefined') return;
    const eth = (window as any).ethereum;
    if (!eth?.request) {
      setWalletMsg('Connect a wallet first');
      setTimeout(() => setWalletMsg(''), 1600);
      return;
    }
    try {
      await eth.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: addr,
            symbol: (symbol || 'TOKEN').slice(0, 11),
            decimals: 18,
            image: imageUrl || undefined,
          },
        },
      });
      setWalletMsg('Added');
      setTimeout(() => setWalletMsg(''), 1600);
    } catch {
      setWalletMsg('Rejected');
      setTimeout(() => setWalletMsg(''), 1600);
    }
  }
  return (
    <div className="td-panel">
      <div className="td-panel-title"><Wrench size={14} /> Tools</div>
      <div className="td-tool-grid">
        <button type="button" className="td-tool-btn" onClick={() => addr && copy(addr, 'ca')}>
          <Copy size={14} /> {copied === 'ca' ? 'Copied' : 'Copy CA'}
        </button>
        <button type="button" className="td-tool-btn" onClick={share}>
          <Share2 size={14} /> {copied === 'share' ? 'Link copied' : 'Share'}
        </button>
        <button type="button" className="td-tool-btn" onClick={addToWallet}>
          <Wallet size={14} /> {walletMsg || 'Add to wallet'}
        </button>
        <button type="button" className="td-tool-btn" onClick={() => copy(shareUrl, 'link')}>
          <Link2 size={14} /> {copied === 'link' ? 'Copied' : 'Copy link'}
        </button>
        {addr && (
          <a className="td-tool-btn" href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Explorer
          </a>
        )}
        {addr && (
          <Link className="td-tool-btn" href={graduated ? `/swap?from=0x0000000000000000000000000000000000000000&to=${addr}` : `/swap?to=${addr}`}>
            <Zap size={14} /> Swap
          </Link>
        )}
        {curve && (
          <a className="td-tool-btn" href={`${MONAD_EXPLORER}/address/${curve}`} target="_blank" rel="noreferrer">
            <Shield size={14} /> Trade contract
          </a>
        )}
        <a
          className="td-tool-btn"
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`$${symbol || name} on Monpad — every trade burns Monshi.`)}&url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noreferrer"
        >
          <Share2 size={14} /> Post
        </a>
      </div>
    </div>
  );
}

function CopyChip({ addr, label = 'CA' }: { addr?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!addr) return null;
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ }
      }}
      title={`Copy ${label}: ${addr}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999,
        background: copied ? 'rgba(61,255,154,0.15)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${copied ? 'rgba(61,255,154,0.45)' : 'rgba(255,255,255,0.12)'}`,
        color: copied ? '#3DFF9A' : '#cbd5e1', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--mono)',
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      {`${addr.slice(0, 6)}…${addr.slice(-4)}`}
      <span>{copied ? '✓' : '⧉'}</span>
    </button>
  );
}

function CopyText({ addr }: { addr?: string }) {
  const [copied, setCopied] = useState(false);
  if (!addr) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ } }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12, color: copied ? '#3DFF9A' : 'var(--p2)' }}
      >
        {shortAddr(addr)} {copied ? '✓' : '⧉'}
      </button>
      <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" style={{ color: '#667', fontSize: 12 }}>↗</a>
    </span>
  );
}

function HeaderStat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || '#fff', fontFamily: 'var(--mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>}
    </div>
  );
}

function StatTile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || '#fff', marginTop: 2, fontFamily: 'var(--mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#888' }}>{sub}</div>}
    </div>
  );
}

function StatsCard({ priceMon, mcapMon, stats, monUsd }: { priceMon: number; mcapMon: number; stats: { vol: number; txns: number; buys: number; sells: number; traders: number; change: number }; monUsd: number }) {
  const usd = (m: number) => (monUsd ? `$${fmtNum(m * monUsd, m < 1 ? 8 : 2)}` : undefined);
  return (
    <div className="td-panel">
      <div className="td-panel-title">Stats</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatTile label="Price" value={`${fmtNum(priceMon, 8)} MON`} sub={usd(priceMon)} />
        <StatTile label="Market cap" value={`${fmtNum(mcapMon)} MON`} sub={usd(mcapMon)} />
        <StatTile label="Volume" value={`${fmtNum(stats.vol)} MON`} sub={usd(stats.vol)} />
        <StatTile label="Txns" value={String(stats.txns)} />
        <StatTile label="Buys / Sells" value={`${stats.buys} / ${stats.sells}`} color={stats.buys >= stats.sells ? '#3DFF9A' : '#FF5C7A'} />
        <StatTile label="Traders" value={String(stats.traders)} />
      </div>
    </div>
  );
}

function OtherInfo({ addr, curve, creator, createdAt }: { addr?: Address; curve?: Address; creator?: Address; createdAt?: string }) {
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '5px 0' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#ddd', textAlign: 'right' }}>{children}</span>
    </div>
  );
  let created = '';
  if (createdAt) { try { created = new Date(createdAt).toLocaleDateString(); } catch { created = ''; } }
  return (
    <div className="td-panel">
      <div className="td-panel-title">Info</div>
      {creator && <Row label="Creator"><Link href={`/profile/${creator}`} style={{ color: 'var(--p2)' }}>{shortAddr(creator)}</Link></Row>}
      {addr && <Row label="Contract"><CopyText addr={addr} /></Row>}
      {curve && <Row label="Trade contract"><CopyText addr={curve} /></Row>}
      {created && <Row label="Created">{created}</Row>}
    </div>
  );
}

function LiquidityBar({ graduated, canGrad, curve, onTraded }: { graduated: boolean; canGrad: boolean; curve?: Address; onTraded?: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  async function doGrad() {
    if (!curve) return;
    setTx({ status: 'pending' });
    try {
      const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'graduate', args: [] } as any);
      setTx({ status: 'pending', message: 'locking LP… ' + h.slice(0, 10) });
      setTimeout(() => onTraded?.(), 3000);
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) });
    }
  }
  return (
    <div className="td-panel" style={{ borderColor: 'rgba(61,255,154,0.35)' }}>
      <div className="td-panel-title" style={{ color: 'var(--green)' }}>On the DEX</div>
      <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.45 }}>
        Uniswap V3 · WMON pair · LP locked from the launch block.
      </div>
      {canGrad && !graduated && (
        <button type="button" onClick={doGrad} style={{ marginTop: 10, width: '100%', padding: 11, background: 'linear-gradient(135deg, var(--green), #16A34A)', color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, cursor: 'pointer' }}>
          Lock Uniswap V3 LP
        </button>
      )}
      {tx.status !== 'idle' && <div style={{ marginTop: 6, fontSize: 12, color: tx.status === 'error' ? 'var(--red)' : '#888' }}>{tx.message || tx.status}</div>}
    </div>
  );
}

function TradePanel({ token, curve, symbol, reserves, graduated, tradeTax, balance = 0n, onTraded }: { token?: Address; curve?: Address; symbol: string; reserves: Reserves | null; graduated: boolean; tradeTax: bigint; balance?: bigint; onTraded?: () => void }) {
  const { address } = useAccount();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const slippageBps = 500n;
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (isSuccess) {
      setTx({ status: 'success', message: 'confirmed' });
      setAmount('');
      onTraded?.();
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
      }
      const tokensIn = parseEther(amount);
      const gross = curveMonFor(reserves, tokensIn);
      return (gross * (10000n - SELL_FEE_BASE - tradeTax)) / 10000n;
    } catch { return null; }
  }, [reserves, amount, side, tradeTax]);

  const minOut = preview ? (preview * (10000n - slippageBps)) / 10000n : 0n;

  async function submit() {
    if (!address || !curve || !preview || !amount) return;
    setTx({ status: 'pending', message: 'submitting…' });
    try {
      if (side === 'buy') {
        const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'buy', args: [minOut], value: parseEther(amount) } as any);
        setTxHash(h);
      } else {
        const tokensIn = parseEther(amount);
        if (needsApprove && token) {
          setTx({ status: 'pending', message: 'approving…' });
          await writeContractAsync({ address: token, abi: tokenAbi as any, functionName: 'approve', args: [curve, tokensIn] } as any);
          await new Promise((r) => setTimeout(r, 1500));
        }
        const h = await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: 'sell', args: [tokensIn, minOut] } as any);
        setTxHash(h);
      }
      setTx({ status: 'pending', message: 'confirming…' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) });
    }
  }

  if (graduated) {
    return (
      <div className="td-panel" style={{ borderColor: 'rgba(61,255,154,0.35)' }}>
        <div className="td-panel-title" style={{ color: 'var(--green)' }}>Trade on DEX</div>
        <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, margin: '0 0 12px' }}>
          Liquidity is locked in the Uniswap V3 pool.
        </p>
        <Link href={`/swap?from=0x0000000000000000000000000000000000000000&to=${token}`} className="mp-create-btn" style={{ width: '100%', justifyContent: 'center' }}>
          Open swap
        </Link>
      </div>
    );
  }

  const outLabel = side === 'buy' ? (symbol || 'tokens') : 'MON';
  const inLabel = side === 'buy' ? 'MON' : (symbol || 'tokens');
  const disabled = !address || !curve || !amount || !preview || tx.status === 'pending';

  return (
    <div className="td-panel">
      <div className="td-panel-title"><Zap size={14} /> Trade</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setSide('buy')} style={{ flex: 1, padding: 10, background: side === 'buy' ? 'linear-gradient(135deg, var(--green), #16A34A)' : 'rgba(255,255,255,0.04)', color: side === 'buy' ? '#000' : '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>BUY</button>
        <button type="button" onClick={() => setSide('sell')} style={{ flex: 1, padding: 10, background: side === 'sell' ? 'linear-gradient(135deg, var(--red), #DC2626)' : 'rgba(255,255,255,0.04)', color: side === 'sell' ? '#fff' : '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}>SELL</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Amount in {inLabel}</label>
        {side === 'sell' && balance > 0n && (
          <button type="button" onClick={() => setAmount(formatEther(balance))} style={{ fontSize: 11, color: 'var(--p2)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>
            Max · {Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </button>
        )}
      </div>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.0"
        inputMode="decimal"
        style={{ width: '100%', padding: 12, marginTop: 6, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontSize: 18, fontWeight: 700, boxSizing: 'border-box', fontFamily: 'var(--mono)' }}
      />
      {preview != null && preview > 0n && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
          ≈ {Number(formatEther(preview)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {outLabel}
          <span style={{ color: '#666' }}> · min {Number(formatEther(minOut)).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        style={{
          width: '100%', marginTop: 14, padding: 14,
          background: side === 'buy' ? 'linear-gradient(135deg, var(--p), var(--pink))' : 'linear-gradient(135deg, var(--red), #991B1B)',
          color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15,
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
          boxShadow: disabled ? 'none' : '0 0 28px rgba(181,123,255,0.35)',
        }}
      >
        {!address ? 'Connect wallet' : side === 'buy' ? `Buy $${symbol || 'token'}` : `Sell $${symbol || 'token'}`}
      </button>
      {tx.status !== 'idle' && (
        <div style={{ marginTop: 8, fontSize: 13, color: tx.status === 'error' ? 'var(--red)' : tx.status === 'success' ? 'var(--green)' : '#888' }}>
          {tx.message || tx.status}
        </div>
      )}
    </div>
  );
}

function CreatorTools({
  curve, creator, wallet, graduated, symbol,
}: {
  curve?: Address; creator?: Address; wallet?: Address; graduated: boolean; symbol: string;
}) {
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const isCreator = !!wallet && !!creator && wallet.toLowerCase() === creator.toLowerCase();

  const [cfBurn, setCfBurn] = useState('0');
  const [cfLp, setCfLp] = useState('0');
  const [taxBurn, setTaxBurn] = useState('0');
  const [taxLp, setTaxLp] = useState('0');

  const reads = useReadContracts(({
    contracts: (isCreator && curve) ? [
      { address: curve, abi: curveV3Abi as any, functionName: 'creatorPending' },
      { address: curve, abi: curveV3Abi as any, functionName: 'graduationRewardClaimable' },
      { address: curve, abi: curveV3Abi as any, functionName: 'feeConfig' },
    ] : [],
    query: { enabled: isCreator && !!curve, refetchInterval: 15000 },
  }) as any);

  useEffect(() => {
    const fc = reads.data?.[2]?.result as any;
    if (!fc) return;
    // feeConfig may be tuple or object
    const burn = Number(fc.cfBurnTokenBps ?? fc[0] ?? 0) / 100;
    const lp = Number(fc.cfLpBps ?? fc[1] ?? 0) / 100;
    const tBurn = Number(fc.taxBurnTokenBps ?? fc[2] ?? 0) / 100;
    const tLp = Number(fc.taxLpBps ?? fc[3] ?? 0) / 100;
    setCfBurn(String(burn));
    setCfLp(String(lp));
    setTaxBurn(String(tBurn));
    setTaxLp(String(tLp));
  }, [reads.data]);

  if (!isCreator) return null;

  const pending = (reads.data?.[0]?.result as bigint) ?? 0n;
  const grad = reads.data?.[1]?.result as readonly [bigint, boolean] | undefined;
  const gradAmt = grad?.[0] ?? 0n;
  const gradClaimed = grad?.[1] ?? false;

  function bps(pct: string): number {
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(10000, Math.round(n * 100));
  }

  async function claim(fn: 'claimCreatorRewards' | 'claimGraduationReward') {
    if (!curve) return;
    setTx({ status: 'pending', message: 'claiming…' });
    try {
      await writeContractAsync({ address: curve, abi: curveV3Abi as any, functionName: fn, args: [] } as any);
      setTx({ status: 'success', message: 'claimed' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) });
    }
  }

  async function saveFees() {
    if (!curve) return;
    const cfB = bps(cfBurn);
    const cfL = bps(cfLp);
    const tB = bps(taxBurn);
    const tL = bps(taxLp);
    if (cfB + cfL > 10000) { setTx({ status: 'error', message: 'Creator fee routing max 100%' }); return; }
    if (tB + tL > V3_MAX_TRADE_TAX_BPS) { setTx({ status: 'error', message: `Trade tax max ${V3_MAX_TRADE_TAX_BPS / 100}%` }); return; }
    setTx({ status: 'pending', message: 'updating tools…' });
    try {
      await writeContractAsync({
        address: curve,
        abi: curveV3Abi as any,
        functionName: 'setFeeConfig',
        args: [{ cfBurnTokenBps: cfB, cfLpBps: cfL, taxBurnTokenBps: tB, taxLpBps: tL }],
      } as any);
      setTx({ status: 'success', message: 'tools updated' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 70) });
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, max: number) => (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        inputMode="decimal"
        style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid var(--bd)', background: 'rgba(0,0,0,0.3)', color: '#fff', boxSizing: 'border-box' }}
      />
      <span style={{ fontSize: 10, color: '#666' }}>0–{max}%</span>
    </label>
  );

  return (
    <div className="td-panel" style={{ borderColor: 'rgba(181,123,255,0.4)' }}>
      <div className="td-panel-title"><Wrench size={14} /> Creator tools · ${symbol}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: '#aaa' }}>Unclaimed fees</span>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{Number(formatEther(pending)).toFixed(4)} MON</span>
      </div>
      <button
        type="button"
        disabled={pending === 0n}
        onClick={() => claim('claimCreatorRewards')}
        style={{
          width: '100%', padding: 10, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13,
          background: pending > 0n ? 'linear-gradient(135deg, var(--p), var(--pink))' : 'rgba(255,255,255,0.06)',
          color: pending > 0n ? '#fff' : '#888', cursor: pending > 0n ? 'pointer' : 'not-allowed',
        }}
      >
        Claim fees
      </button>
      {graduated && gradAmt > 0n && !gradClaimed && (
        <button
          type="button"
          onClick={() => claim('claimGraduationReward')}
          style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, background: 'linear-gradient(135deg, var(--green), #16A34A)', color: '#000', cursor: 'pointer' }}
        >
          Claim launch reward ({Number(formatEther(gradAmt)).toLocaleString()} MON)
        </button>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--bd)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 8 }}>
          Fee routing
        </div>
        {field('Creator fee → burn $' + (symbol || 'token'), cfBurn, setCfBurn, 100)}
        {field('Creator fee → deepen LP', cfLp, setCfLp, 100)}
        {field('Per-trade tax → burn', taxBurn, setTaxBurn, V3_MAX_TRADE_TAX_BPS / 100)}
        {field('Per-trade tax → LP', taxLp, setTaxLp, V3_MAX_TRADE_TAX_BPS / 100)}
        <button
          type="button"
          onClick={saveFees}
          style={{ width: '100%', marginTop: 4, padding: 10, borderRadius: 10, border: '1px solid rgba(181,123,255,0.45)', background: 'rgba(181,123,255,0.12)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
        >
          Save tools
        </button>
      </div>
      {tx.status !== 'idle' && (
        <div style={{ marginTop: 8, fontSize: 12, color: tx.status === 'error' ? 'var(--red)' : tx.status === 'success' ? 'var(--green)' : '#888' }}>
          {tx.message || tx.status}
        </div>
      )}
    </div>
  );
}

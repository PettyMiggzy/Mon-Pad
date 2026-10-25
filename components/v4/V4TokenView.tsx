// Token page for a Monpad V4 pool.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { LAUNCHER_V4, QUOTE_DECIMALS } from '@/lib/v4/config';
import { launcherV4Abi } from '@/lib/v4/abis';
import { getQuoteAsset, getV4Token, type V4Token } from '@/lib/v4/chain';
import { MONAD_EXPLORER } from '@/lib/constants';
import { shortAddr } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import V4TradePanel from './V4TradePanel';
import DepthPanel from './DepthPanel';
import PriceChart from './PriceChart';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
/** Links from the AI connector open the coin with the trade box filled in: ?side=buy&pay=mon&amount=5 */
function tradeInit(q: Record<string, string | string[] | undefined>) {
  const amount = one(q.amount);
  return {
    side: one(q.side) === 'sell' ? ('sell' as const) : one(q.side) === 'buy' ? ('buy' as const) : undefined,
    pay: one(q.pay) === 'usdc' ? ('usdc' as const) : one(q.pay) === 'mon' ? ('mon' as const) : undefined,
    amount: /^\d+(\.\d+)?$/.test(amount) ? amount : undefined,
  };
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(2)}K` : `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })}`);

export default function V4TokenView({ address: tokenAddr }: { address: Address }) {
  const router = useRouter();
  const { address: me } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [t, setT] = useState<V4Token | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [usdcAddr, setUsdcAddr] = useState<Address | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => { try { setT(await getV4Token(tokenAddr)); } catch { /* keep last */ } }, [tokenAddr]);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);
  useEffect(() => { getQuoteAsset().then(setUsdcAddr).catch(() => {}); }, []);
  useEffect(() => {
    fetch(`/api/token-meta?addresses=${tokenAddr}`).then((r) => (r.ok ? r.json() : [])).then((m) => { if (Array.isArray(m) && m[0]?.image_url) setImageUrl(m[0].image_url); }).catch(() => {});
  }, [tokenAddr]);

  const { data: claimRaw, refetch: refetchClaim } = useReadContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'claimable', args: [me as Address, usdcAddr as Address], query: { enabled: !!me && !!usdcAddr } });
  const { data: tokClaimRaw, refetch: refetchTokClaim } = useReadContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'claimable', args: [me as Address, tokenAddr], query: { enabled: !!me } });
  const claimUsdc = (claimRaw as bigint | undefined) ?? 0n;
  const claimTok = (tokClaimRaw as bigint | undefined) ?? 0n;

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    if (!publicClient) return;
    setBusy(label);
    try { const h = await fn(); await publicClient.waitForTransactionReceipt({ hash: h }); toast.push(`${label} done.`); refetchClaim(); refetchTokClaim(); load(); }
    catch (e: any) { toast.push(String(e?.shortMessage || e?.message || 'Failed').slice(0, 120), 'err'); }
    finally { setBusy(null); }
  }

  if (!t) return <div className="pad-empty" style={{ margin: 24 }}>Loading token…</div>;
  const isCreator = !!me && me.toLowerCase() === t.creator.toLowerCase();

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '16px 16px 64px', display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0,1fr)' }} className="v4-token">
      <Head><title>{`${t.name} (${t.symbol}) | MONPAD`}</title></Head>
      <div className="tk-head">
        {imageUrl ? <img src={imageUrl} alt="" width={64} height={64} style={{ borderRadius: 16, objectFit: 'cover' }} /> : <span className="pad-card-pfp pad-card-letter" style={{ width: 64, height: 64, fontSize: 28 }}>{t.symbol.slice(0, 1)}</span>}
        <div>
          <h1>{t.name} <span style={{ color: 'var(--p2)', fontSize: 16 }}>${t.symbol}</span></h1>
          <div className="tk-badges">
            <span className="tk-badge">🔒 Liquidity locked</span>
            <span className="tk-badge">Fee {t.totalFeeBps / 100}% (1% + {t.taxBps / 100}% creator tax)</span>
            <span className="tk-badge">by {shortAddr(t.creator)}</span>
            <a className="tk-badge" href={`${MONAD_EXPLORER}/token/${t.address}`} target="_blank" rel="noreferrer">{shortAddr(t.address)} ↗</a>
          </div>
        </div>
        <div className="tk-price"><b>{usd(t.priceUsdc)}</b><span style={{ color: '#9B94B0', fontSize: 13 }}>Market cap {usd(t.mcapUsdc)}</span></div>
      </div>
      <div className="xch-tok">
        <div style={{ gridColumn: '1 / -1' }}><PriceChart poolId={t.poolId} symbol={t.symbol} /></div>
        <div style={{ padding: 16, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 14, lineHeight: 1.6, color: '#bbb' }}>
          <b style={{ color: '#fff' }}>How fees work.</b> Every trade pays {t.totalFeeBps / 100}%, set by the pool&apos;s hook so no router can skip it. Of the base 1%: 70% to the creator, 10% platform, 10% MONSHI, 10% buys and burns this token. The creator tax ({t.taxBps / 100}%) buys and burns this token.
          <div style={{ marginTop: 12 }}><a href={`https://dexscreener.com/monad/${t.address}`} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>Chart on DexScreener ↗</a></div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="pad-launch" disabled={!!busy || !me} onClick={() => run('Collect fees', () => writeContractAsync({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'harvest', args: [t.address] } as any))} style={{ padding: '8px 14px', opacity: busy || !me ? 0.5 : 1 }}>{busy === 'Collect fees' ? 'Collecting…' : 'Collect fees (anyone)'}</button>
          </div>
          {isCreator && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'rgba(167,139,250,0.08)' }}>
              <b style={{ color: '#fff' }}>Your earnings</b>
              <div>{formatUnits(claimUsdc, QUOTE_DECIMALS)} USDC · {Number(formatUnits(claimTok, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {t.symbol}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={!!busy || claimUsdc === 0n || !usdcAddr} onClick={() => run('Claim USDC', () => writeContractAsync({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'claim', args: [usdcAddr as Address] } as any))} style={{ padding: '6px 12px', opacity: busy || claimUsdc === 0n ? 0.5 : 1 }}>Claim USDC</button>
                <button type="button" disabled={!!busy || claimTok === 0n} onClick={() => run('Claim token', () => writeContractAsync({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'claim', args: [t.address] } as any))} style={{ padding: '6px 12px', opacity: busy || claimTok === 0n ? 0.5 : 1 }}>Claim {t.symbol}</button>
              </div>
            </div>
          )}
        </div>
        <DepthPanel token={t} />
        <V4TradePanel key={router.asPath} init={tradeInit(router.query)} token={t} onTraded={() => { load(); refetchClaim(); refetchTokClaim(); }} />
      </div>
    </div>
  );
}

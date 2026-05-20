import { useRouter } from 'next/router';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther, type Address } from 'viem';
import { api, type TokenSummary, type Trade, type Comment, type Holder } from '@/lib/api';
import { useTokenUpdates } from '@/lib/ws';
import { curveAbi } from '@/lib/abis';
import { previewBuy, previewSell, graduationProgress, monToGraduation } from '@/lib/curve';
import { GRADUATION_TARGET_MON, MONAD_EXPLORER, TOKEN_DECIMALS } from '@/lib/constants';


export const getServerSideProps: GetServerSideProps = async (
  ctx: GetServerSidePropsContext
) => {
  const raw = ctx.params?.address;
  const addrParam = typeof raw === 'string' ? raw.toLowerCase() : '';

  let initialToken: TokenSummary | null = null;
  if (addrParam && /^0x[a-f0-9]{40}$/.test(addrParam)) {
    try {
      initialToken = await api.getToken(addrParam);
    } catch {
      initialToken = null;
    }
  }

  // Edge cache: 60s fresh, 5min stale-while-revalidate. Most token pages get
  // hit by social crawlers + bursts of traffic right after a share — this
  // amortizes the origin API call to effectively zero per share burst.
  ctx.res.setHeader(
    'Cache-Control',
    'public, s-maxage=60, stale-while-revalidate=300'
  );

  return {
    props: {
      addrParam,
      initialToken,
    },
  };
};

type TokenDetailPageProps = {
  addrParam: string;
  initialToken: TokenSummary | null;
};

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };

function StatusPill({ state, onDismiss }: { state: TxState; onDismiss?: () => void }) {
  if (state.status === 'idle') return null;
  const color = state.status === 'pending' ? 'var(--muted, #888)' : state.status === 'success' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)';
  const icon = state.status === 'pending' ? '\u29D7' : state.status === 'success' ? '\u2713' : '\u2715';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${color}`, color, fontSize: 13, marginTop: 8 }}>
      <span style={{ display: 'inline-block', animation: state.status === 'pending' ? 'spin 1s linear infinite' : undefined }}>{icon}</span>
      <span style={{ flex: 1 }}>{state.message || (state.status === 'pending' ? 'submitting...' : state.status === 'success' ? 'confirmed' : 'error')}</span>
      {state.status === 'error' && onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 'none', color, cursor: 'pointer' }}>x</button>}
      <style jsx>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}

export default function TokenDetailPage({ addrParam, initialToken }: TokenDetailPageProps) {
  const router = useRouter();
  const addr = (router.query.address as string | undefined)?.toLowerCase() as Address | undefined;
  const [token, setToken] = useState<TokenSummary | null>(initialToken);
  const live = useTokenUpdates(addr);
  const [tab, setTab] = useState<'trades' | 'comments' | 'holders'>('trades');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);

  useEffect(() => {
    if (!addr) return;
    api.getToken(addr).then((t) => t && setToken(t));
    api.getTrades(addr).then(setTrades).catch(() => {});
    api.getComments(addr).then(setComments).catch(() => {});
    api.getHolders(addr).then(setHolders).catch(() => {});
  }, [addr]);

  const current = live || token;

  if (!addr) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!current) return <div style={{ padding: 24 }}>Loading token...</div>;

  const monRaisedNet = BigInt(current.monRaisedNet ?? 0);
  const progress = graduationProgress(monRaisedNet);
  const remaining = monToGraduation(monRaisedNet);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16, color: '#fff' }}>
      <Head>
        <title>{`${current.name} (${current.symbol}) | Mon-Pad`}</title>
        <meta key="description" name="description" content={`Buy or trade ${current.symbol} on Mon-Pad. Live price chart, trades, holders on Monad.`} />
        <meta key="og:title" property="og:title" content={`${current.name} (${current.symbol}) | Mon-Pad`} />
        <meta key="og:description" property="og:description" content={`Trade ${current.symbol} on Mon-Pad. Fair launch token on Monad.`} />
        <meta key="og:url" property="og:url" content={`https://www.monpad.net/token/${addr}`} />
        <meta key="twitter:title" name="twitter:title" content={`${current.name} (${current.symbol})`} />
        <meta key="twitter:description" name="twitter:description" content={`Trade ${current.symbol} on Mon-Pad.`} />
          <meta key="og:image" property="og:image" content={`https://www.monpad.net/api/og?addr=${addr}`} />
          <meta key="og:image:width" property="og:image:width" content="1200" />
          <meta key="og:image:height" property="og:image:height" content="630" />
          <meta key="og:image:type" property="og:image:type" content="image/png" />
          <meta key="twitter:card" name="twitter:card" content="summary_large_image" />
          <meta key="twitter:image" name="twitter:image" content={`https://www.monpad.net/api/og?addr=${addr}`} />
        <link key="canonical" rel="canonical" href={`https://www.monpad.net/token/${addr}`} />
          <script
            key="jsonld-product"
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: current.name,
                description: `${current.name} (${current.symbol}) on Mon-Pad — fair launch token on Monad.`,
                image: current.imageUrl || `https://www.monpad.net/api/og?addr=${addr}`,
                url: `https://www.monpad.net/token/${addr}`,
                brand: { '@type': 'Brand', name: 'Mon-Pad' },
                category: 'Cryptocurrency',
                ...(current.marketCapMon && Number(current.marketCapMon) > 0
                  ? {
                      offers: {
                        '@type': 'AggregateOffer',
                        priceCurrency: 'MON',
                        lowPrice: '0',
                        highPrice: current.marketCapMon,
                        availability: 'https://schema.org/InStock',
                      },
                    }
                  : {}),
              }),
            }}
          />
      </Head>
      <TokenHeader token={current} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16, marginTop: 16 }}>
        <div>
          <PriceChart address={addr} />
          <GraduationBar progress={progress} remaining={remaining} graduated={current.graduated} />
          <TabBar tab={tab} setTab={setTab} counts={{ trades: trades.length, comments: comments.length, holders: holders.length }} />
          <div style={{ marginTop: 12 }}>
            {tab === 'trades' && <TradesList trades={trades} symbol={current.symbol || ''} />}
            {tab === 'comments' && <CommentsList comments={comments} />}
            {tab === 'holders' && <HoldersList holders={holders} symbol={current.symbol || ''} />}
          </div>
        </div>
        <div>
          <TradePanel token={current} />
          <CreatorPanel token={current} />
        </div>
      </div>
    </div>
  );
}

function TokenHeader({ token }: { token: TokenSummary }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {token.imageUrl && <img src={token.imageUrl} alt={token.symbol} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }} />}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{token.name}</h1>
          <span style={{ color: '#888' }}>${token.symbol}</span>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          by <Link href={`/profile/${token.creator}`} style={{ color: 'var(--brand, #A78BFA)' }}>{shortAddr(token.creator)}</Link>
          {' \u00b7 '}
          <a href={`${MONAD_EXPLORER}/address/${token.address}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)' }}>contract</a>
        </div>
      </div>
    </div>
  );
}

function PriceChart({ address }: { address: Address }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    let chart: any = null;
    let cancelled = false;
    (async () => {
      const mod = await import('lightweight-charts');
      if (cancelled || !ref.current) return;
      chart = mod.createChart(ref.current, {
        width: ref.current.clientWidth,
        height: 360,
        layout: { background: { color: 'transparent' }, textColor: '#aaa' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        timeScale: { timeVisible: true, secondsVisible: false },
        handleScroll: true, handleScale: true,
      });
      const series = chart.addSeries(mod.CandlestickSeries, {
        upColor: 'var(--brand, #A78BFA)', downColor: '#6D28D9', borderUpColor: 'var(--brand, #A78BFA)', borderDownColor: '#6D28D9',
        wickUpColor: 'var(--brand, #A78BFA)', wickDownColor: '#6D28D9',
      });
      try {
        const candles = await api.getCandles(address, '5m');
        series.setData(candles.map((c: any) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
      } catch {}
      const onResize = () => { if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth }); };
      window.addEventListener('resize', onResize);
      (chart as any)._cleanup = () => window.removeEventListener('resize', onResize);
    })();
    return () => { cancelled = true; if (chart) { try { (chart as any)._cleanup?.(); chart.remove(); } catch {} } };
  }, [address]);
  return <div ref={ref} style={{ width: '100%', height: 360, background: 'rgba(255,255,255,0.02)', borderRadius: 8, overflow: 'hidden' }} />;
}

function GraduationBar({ progress, remaining, graduated }: { progress: number; remaining: bigint; graduated?: boolean }) {
  if (graduated) return <div style={{ marginTop: 12, padding: 10, background: 'rgba(74,222,128,0.1)', border: '1px solid var(--ok, #4ADE80)', borderRadius: 8, color: 'var(--ok, #4ADE80)', fontSize: 13 }}>Graduated to DEX</div>;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa', marginBottom: 4 }}>
        <span>Graduation</span>
        <span>{formatEther(remaining)} MON to go</span>
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, progress * 100).toFixed(1)}%`, height: '100%', background: 'var(--brand, #A78BFA)' }} />
      </div>
    </div>
  );
}

function TabBar({ tab, setTab, counts }: { tab: string; setTab: (t: any) => void; counts: { trades: number; comments: number; holders: number } }) {
  const tabs: { key: 'trades' | 'comments' | 'holders'; label: string }[] = [
    { key: 'trades', label: `Trades (${counts.trades})` },
    { key: 'comments', label: `Comments (${counts.comments})` },
    { key: 'holders', label: `Holders (${counts.holders})` },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '8px 12px', background: 'none', border: 'none', borderBottom: tab === t.key ? '2px solid var(--brand, #A78BFA)' : '2px solid transparent', color: tab === t.key ? '#fff' : '#888', cursor: 'pointer' }}>{t.label}</button>
      ))}
    </div>
  );
}

function TradesList({ trades, symbol }: { trades: Trade[]; symbol: string }) {
  if (!trades.length) return <div style={{ color: '#888', padding: 20 }}>No trades yet</div>;
  return (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      {trades.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ color: t.side === 'buy' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)' }}>{t.side?.toUpperCase()}</span>
          <span style={{ color: '#aaa' }}>{shortAddr(t.wallet)}</span>
          <span>{Number(formatEther(BigInt(t.monAmount ?? 0))).toFixed(4)} MON</span>
          <span style={{ color: '#888', fontSize: 11 }}>{new Date(t.ts * 1000).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}

function CommentsList({ comments }: { comments: Comment[] }) {
  return (
    <div>
      {comments.length === 0 ? (
        <div style={{ color: '#888', padding: 20 }}>No comments yet</div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {comments.map((c, i) => (
            <div key={i} style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 12, color: '#888' }}>{shortAddr(c.wallet)} \u00b7 {new Date(c.ts * 1000).toLocaleString()}</div>
              <div style={{ marginTop: 4 }}>{c.text}</div>
            </div>
          ))}
        </div>
      )}
      {/* TODO: comment composer with wallet signature */}
      <div style={{ marginTop: 12, padding: 8, fontSize: 12, color: '#888', background: 'rgba(255,255,255,0.03)', borderRadius: 6, textAlign: 'center' }}>Sign in to comment (coming soon)</div>
    </div>
  );
}

function HoldersList({ holders, symbol }: { holders: Holder[]; symbol: string }) {
  if (!holders.length) return <div style={{ color: '#888', padding: 20 }}>No holders yet</div>;
  return (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      {/* TODO: holder bubble visualization */}
      {holders.map((h, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ color: '#aaa' }}>{i + 1}. {shortAddr(h.wallet)}{h.isCreator ? ' (creator)' : ''}</span>
          <span>{((h.pctOfSupply ?? 0) * 100).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
}

function TradePanel({ token }: { token: TokenSummary }) {
  const { address } = useAccount();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippageBps] = useState(500); // 5%
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => { if (isSuccess) setTx({ status: 'success', message: 'tx confirmed' }); }, [isSuccess]);
  useEffect(() => { if (tx.status === 'success') { const t = setTimeout(() => setTx({ status: 'idle' }), 5000); return () => clearTimeout(t); } }, [tx.status]);

  const monRaisedNet = BigInt(token.monRaisedNet ?? 0);
  const quote = useMemo(() => {
    if (!amount || isNaN(Number(amount))) return null;
    try {
      if (side === 'buy') {
        const monIn = parseEther(amount);
        return previewBuy(monIn, monRaisedNet);
      } else {
        const tokensIn = parseEther(amount);
        return previewSell(tokensIn, monRaisedNet);
      }
    } catch { return null; }
  }, [amount, side, monRaisedNet]);

  const minOut = quote ? (quote * BigInt(10000 - slippageBps)) / 10000n : 0n;

  async function submit() {
    if (!address || !quote || !amount) return;
    setTx({ status: 'pending', message: side === 'buy' ? 'buying...' : 'selling...' });
    try {
      const hash = side === 'buy'
        ? await writeContractAsync({ address: token.address as Address, abi: curveAbi as any, functionName: 'buy' as any, args: [minOut] as any, value: parseEther(amount) } as any)
        : await writeContractAsync({ address: token.address as Address, abi: curveAbi as any, functionName: 'sell' as any, args: [parseEther(amount), minOut] as any } as any);
      setTxHash(hash);
      setTx({ status: 'pending', message: 'confirming...' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 60) });
    }
  }

  const outLabel = side === 'buy' ? token.symbol || 'tokens' : 'MON';
  const inLabel = side === 'buy' ? 'MON' : token.symbol || 'tokens';

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button onClick={() => setSide('buy')} style={{ flex: 1, padding: 8, background: side === 'buy' ? 'var(--ok, #4ADE80)' : 'rgba(255,255,255,0.04)', color: side === 'buy' ? '#000' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>BUY</button>
        <button onClick={() => setSide('sell')} style={{ flex: 1, padding: 8, background: side === 'sell' ? 'var(--err, #F87171)' : 'rgba(255,255,255,0.04)', color: side === 'sell' ? '#000' : '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>SELL</button>
      </div>
      <label style={{ fontSize: 12, color: '#888' }}>Amount in {inLabel}</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" type="text" inputMode="decimal" style={{ width: '100%', padding: 10, marginTop: 4, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 16, boxSizing: 'border-box' }} />
      {quote != null && quote > 0n && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#aaa' }}>
          \u2248 {Number(formatEther(quote)).toFixed(6)} {outLabel}
          <div style={{ color: '#666', marginTop: 2 }}>min received: {Number(formatEther(minOut)).toFixed(6)} (5% slip)</div>
        </div>
      )}
      <button disabled={!address || !amount || !quote || tx.status === 'pending' || waiting} onClick={submit} style={{ width: '100%', marginTop: 12, padding: 12, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 6, fontWeight: 700, cursor: (!address || !amount || !quote) ? 'not-allowed' : 'pointer', opacity: (!address || !amount || !quote) ? 0.5 : 1 }}>
        {!address ? 'Connect wallet' : side === 'buy' ? 'BUY' : 'SELL'}
      </button>
      <StatusPill state={tx} onDismiss={() => setTx({ status: 'idle' })} />
    </div>
  );
}

function CreatorPanel({ token }: { token: TokenSummary }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const isCreator = address && token.creator && address.toLowerCase() === token.creator.toLowerCase();

  const { data: creatorPending } = useReadContract({
    address: token.address as Address | undefined,
    abi: curveAbi as any,
    functionName: 'creatorPending',
    query: { enabled: !!isCreator && !!token.address, refetchInterval: 15000 },
  });

  const { data: graduationClaim } = useReadContract({
    address: token.address as Address | undefined,
    abi: curveAbi as any,
    functionName: 'graduationRewardClaimable',
    query: { enabled: !!isCreator && !!token.address, refetchInterval: 15000 },
  });

  if (!isCreator) return null;

  const pending = (creatorPending as bigint | undefined) ?? 0n;
  const [gradAmount, gradClaimable] = (graduationClaim as [bigint, boolean] | undefined) ?? [0n, false];

  async function claim(fn: 'claimCreatorRewards' | 'claimGraduationReward') {
    setTx({ status: 'pending', message: 'claiming...' });
    try {
      await writeContractAsync({ address: token.address as Address, abi: curveAbi as any, functionName: fn as any, args: [] as any } as any);
      setTx({ status: 'success', message: 'claimed' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 60) });
    }
  }

  return (
    <div style={{ marginTop: 12, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Creator</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ color: '#aaa' }}>Trading fees</span>
        <span>{Number(formatEther(pending)).toFixed(4)} MON</span>
      </div>
      <button disabled={pending === 0n} onClick={() => claim('claimCreatorRewards')} style={{ width: '100%', marginTop: 8, padding: 8, background: pending > 0n ? 'var(--brand, #A78BFA)' : 'rgba(255,255,255,0.06)', color: pending > 0n ? '#000' : '#888', border: 'none', borderRadius: 6, fontSize: 13, cursor: pending > 0n ? 'pointer' : 'not-allowed' }}>Claim fees</button>
      {gradClaimable && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 12 }}>
            <span style={{ color: '#aaa' }}>Graduation reward</span>
            <span>{Number(formatEther(gradAmount)).toFixed(2)} MON</span>
          </div>
          <button onClick={() => claim('claimGraduationReward')} style={{ width: '100%', marginTop: 8, padding: 8, background: 'var(--ok, #4ADE80)', color: '#000', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Claim 25k MON reward</button>
        </>
      )}
      <StatusPill state={tx} onDismiss={() => setTx({ status: 'idle' })} />
    </div>
  );
}

function shortAddr(a?: string) { if (!a) return '?'; return `${a.slice(0, 6)}...${a.slice(-4)}`; }

import { useState, useEffect, type ChangeEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { postJson, studioSig } from '@/lib/launchClient';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useSignMessage } from 'wagmi';
import { parseEther, decodeEventLog, type Address } from 'viem';
import { factoryV3Abi } from '@/lib/abis';
import { api } from '@/lib/api';
import {
  FACTORY_V3, ZERO_ADDRESS, V3_CREATION_FEE_MON, V3_GRADUATION_TARGET_MON, V3_CREATOR_REWARD_MON,
  V3_MAX_TRADE_TAX_BPS, V3_MAX_DEV_BUY_BPS, factoryIsSuperseded,
} from '@/lib/constants';
import Head from 'next/head';
import { FeeSplit } from '@/components/launch/FeeSplit';
import { LP_FEE_SPLIT_COPY } from '@/lib/fees';
import { setHeroMood } from '@/components/hero3d/bus';
import { useToast } from '@/components/ui/Toast';

type TxState = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };

function StatusPill({ state }: { state: TxState }) {
  if (state.status === 'idle') return null;
  const color = state.status === 'pending' ? '#888' : state.status === 'success' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)';
  return (
    <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, border: `1px solid ${color}`, color, fontSize: 13 }}>
      {state.message || state.status}
    </div>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const canonical = 'https://www.monpad.net' + router.asPath.split('?')[0];
  const { address } = useAccount();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Creator tokenomics (percent UI → bps). Defaults = no burn/LP/tax.
  const [devBuy, setDevBuy] = useState('');         // MON
  const [cfBurnPct, setCfBurnPct] = useState('0');  // % of your dev fee → buyback-burn token
  const [cfLpPct, setCfLpPct] = useState('0');      // % of your dev fee → graduation LP
  const [taxBurnPct, setTaxBurnPct] = useState('0');// per-trade tax → buyback-burn token
  const [taxLpPct, setTaxLpPct] = useState('0');    // per-trade tax → LP

  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const factoryRetired = factoryIsSuperseded();
  const toast = useToast();

  // Prefill from a Monshi chat draft: /create?name=&symbol=&desc=&img=&cid=
  const [characterId, setCharacterId] = useState<string | null>(null);
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
    if (one(q.name)) setName(one(q.name).slice(0, 32));
    if (one(q.symbol)) setSymbol(one(q.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
    if (one(q.desc)) setDescription(one(q.desc).slice(0, 240));
    if (/^https:\/\//i.test(one(q.img))) setImageUrl(one(q.img));
    if (/^[0-9a-f-]{36}$/i.test(one(q.cid))) setCharacterId(one(q.cid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (!isSuccess || !receipt || tx.status !== 'pending') return;
    let newAddr: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FACTORY_V3.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: factoryV3Abi as any, data: log.data, topics: log.topics }) as any;
        if (ev.eventName === 'Launch') { newAddr = ev.args.token as string; break; }
      } catch { /* not the Launch event */ }
    }
    setTx({ status: 'success', message: 'Token launched.' });
    setHeroMood('celebrate', 2600);
    toast.push('Token launched.');
    if (newAddr) {
      // Persist off-chain metadata (logo + socials) keyed by the new token address.
      // We sign a message so the server can verify we're the on-chain creator and
      // store this authoritatively (an unsigned squatter can't overwrite it). The
      // signature is gas-free; if the user skips it the write is still best-effort.
      const dest = newAddr;
      (async () => {
        let signature: string | undefined;
        try { if (address) signature = await signMessageAsync({ account: address, message: `Mon-Pad: set metadata for token ${dest.toLowerCase()}` }); } catch { /* skipped */ }
        fetch('/api/token-meta', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: dest, name, symbol, imageUrl, description, twitter, telegram, website, signature }),
        }).catch(() => {});
      })();
      if (characterId && address) {
        // Attach the 3D character built in chat to the new token.
        (async () => {
          try {
            const sig = await studioSig(address, signMessageAsync as any);
            await postJson(`/api/v1/launch/character/${characterId}`, { wallet: address, signature: sig, token: dest });
          } catch { /* the character can be linked later */ }
        })();
      }
      setTimeout(() => router.push(`/token/${dest}`), 1200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, receipt]);

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Same storage as the original bond pad: /api/upload → Supabase `images` bucket
      const res = await api.uploadImage(file);
      setImageUrl(res.url);
      setTx({ status: 'idle' });
    } catch (err: any) {
      setTx({
        status: 'error',
        message: err?.message?.includes('not configured')
          ? 'Image storage offline — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel (same as original pad).'
          : (err?.message || 'image upload failed'),
      });
    } finally {
      setUploading(false);
    }
  }

  function bps(pct: string): number {
    const n = Math.round((parseFloat(pct) || 0) * 100);
    return n < 0 ? 0 : n;
  }

  async function launch() {
    if (!address) return;
    // Refuse to transact with a retired factory (stale NEXT_PUBLIC_FACTORY_V3) — it
    // uses the old curve + a compromised treasury and would just burn gas on revert.
    if (factoryRetired) {
      setTx({ status: 'error', message: 'App is pointed at a retired factory. Set NEXT_PUBLIC_FACTORY_V3 to the current factory and redeploy.' });
      return;
    }
    if (!name || !symbol) { setTx({ status: 'error', message: 'Name and symbol required' }); return; }

    const cfBurn = bps(cfBurnPct), cfLp = bps(cfLpPct), taxBurn = bps(taxBurnPct), taxLp = bps(taxLpPct);
    if (cfBurn + cfLp > 10000) { setTx({ status: 'error', message: 'Dev-fee routing can’t exceed 100%' }); return; }
    if (taxBurn + taxLp > V3_MAX_TRADE_TAX_BPS) { setTx({ status: 'error', message: `Per-trade tax can’t exceed ${V3_MAX_TRADE_TAX_BPS / 100}%` }); return; }

    let devBuyWei = 0n;
    try { if (devBuy && Number(devBuy) > 0) devBuyWei = parseEther(devBuy); } catch { setTx({ status: 'error', message: 'invalid dev buy' }); return; }

    setTx({ status: 'pending', message: 'submitting...' });
    try {
      // (off-chain metadata is saved AFTER the tx confirms, keyed by the new token
      // address — see the success effect above.)

      // Use the ACTUAL on-chain fee (applies the MONSHI holder discount) so holders
      // pay the discounted fee instead of overpaying — and the surplus never becomes
      // an unintended dev-buy. Falls back to the listed fee if the read fails.
      let feeWei = parseEther(V3_CREATION_FEE_MON.toString());
      try {
        const onchainFee = await publicClient!.readContract({
          address: FACTORY_V3 as Address, abi: factoryV3Abi as any,
          functionName: 'creationFeeFor', args: [address],
        }) as bigint;
        if (onchainFee && onchainFee > 0n) feeWei = onchainFee;
      } catch { /* keep listed fee */ }

      const feeConfig = { cfBurnTokenBps: cfBurn, cfLpBps: cfLp, taxBurnTokenBps: taxBurn, taxLpBps: taxLp };
      const value = feeWei + devBuyWei;
      const hash = await writeContractAsync({
        address: FACTORY_V3 as Address,
        abi: factoryV3Abi as any,
        functionName: 'createLaunch',
        args: [name, symbol, feeConfig],
        value,
      } as any);
      setTxHash(hash);
      setTx({ status: 'pending', message: 'confirming...' });
    } catch (e: any) {
      const message = String(e?.shortMessage || e?.message || 'Launch failed').slice(0, 90);
      setTx({ status: 'error', message });
      setHeroMood('facepalm', 1800);
      toast.push(message, 'err');
    }
  }

  const step = tx.status === 'success' ? 3 : tx.message === 'confirming...' ? 2 : tx.status === 'pending' ? 1 : 0;
  const monshiPose = tx.status === 'success' ? 'pop' : tx.status === 'error' ? 'down' : '';
  const blocked = !address || !name || !symbol || tx.status === 'pending' || factoryRetired || !FACTORY_V3 || FACTORY_V3 === ZERO_ADDRESS;

  return (
    <div className="pad-create">
      <Head>
        <title>Launch a token | MONPAD</title>
        <meta key="description" name="description" content="Launch a token on Monad into a Uniswap V3 pool. LP fees pay the creator, the platform, and two burns." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      <div>
      <p className="pad-kicker">Create</p>
      <h1>Launch a token</h1>
      <p style={{ color: 'var(--t3)', marginTop: -8, marginBottom: 16 }}>Name, picture, socials, optional dev-bot buy. The pool is live when the transaction lands.</p>
      {(!FACTORY_V3 || FACTORY_V3 === ZERO_ADDRESS) && <div className="pad-empty">Launch opens when the factory is live.</div>}
      {factoryRetired && <div className="pad-empty">This factory is retired. Launching is off until a new one is set.</div>}
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Name" value={name} onChange={setName} placeholder="Awesome Coin" maxLength={32} />
        <Field label="Symbol" value={symbol} onChange={(v) => setSymbol(v.toUpperCase())} placeholder="AWESOME" maxLength={10} />
        <div>
          <label style={{ fontSize: 13, color: '#aaa' }}>Token profile picture</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFileChange} style={{ display: 'block', marginTop: 4, color: '#aaa' }} />
          {uploading && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Uploading to Supabase…</div>}
          {imageUrl ? (
            <Image src={imageUrl} alt="preview" width={80} height={80} unoptimized style={{ marginTop: 8, borderRadius: 8, objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>PNG, JPEG, WebP, or GIF.</div>
          )}
        </div>
        <Field label="Description" value={description} onChange={setDescription} placeholder="What’s this token about?" multiline />
        <Field label="Twitter" value={twitter} onChange={setTwitter} placeholder="https://x.com/..." />
        <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="https://t.me/..." />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
      </div>

      {/* Dev bot = Minta-style atomic first buy in the same launch tx (so you aren't sniped on your own coin). */}
      <div style={{ marginTop: 24, padding: 16, background: 'rgba(236,72,153,0.06)', border: '1px solid rgba(236,72,153,0.28)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: 'var(--pink, #EC4899)' }}>Dev bot on deploy</div>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10, lineHeight: 1.45 }}>
          Same pattern as Minta: your first buy lands <strong style={{ color: '#ddd' }}>in the launch transaction</strong>, before anyone else can trade.
          Fee-free and tax-free, capped at {V3_MAX_DEV_BUY_BPS / 100}% of supply. Bots and agents can trade the moment the pool exists.
        </div>
        <Field label="Dev buy (MON)" value={devBuy} onChange={setDevBuy} placeholder="0" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {[
            { label: 'Skip', v: '' },
            { label: '0.5 MON', v: '0.5' },
            { label: '1 MON', v: '1' },
            { label: '5 MON', v: '5' },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setDevBuy(p.v)}
              style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${devBuy === p.v ? 'rgba(236,72,153,0.7)' : 'rgba(255,255,255,0.1)'}`,
                background: devBuy === p.v ? 'rgba(236,72,153,0.2)' : 'transparent',
                color: devBuy === p.v ? '#fff' : '#aaa',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Creator tokenomics */}
      <div style={{ marginTop: 24, padding: 16, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your tokenomics (optional, editable later)</div>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
          Optional extras on top of LP fees ({LP_FEE_SPLIT_COPY}).
        </div>
        <PctRow label="Creator fee to buyback and burn" value={cfBurnPct} onChange={setCfBurnPct} max={100} />
        <PctRow label="Creator fee to deepen LP" value={cfLpPct} onChange={setCfLpPct} max={100} />
        <PctRow label="Per-trade tax to buyback and burn" value={taxBurnPct} onChange={setTaxBurnPct} max={V3_MAX_TRADE_TAX_BPS / 100} />
        <PctRow label="Per-trade tax to deepen LP" value={taxLpPct} onChange={setTaxLpPct} max={V3_MAX_TRADE_TAX_BPS / 100} />
      </div>

      <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Launch params</div>
        <Stat label="Creation fee" value={`${V3_CREATION_FEE_MON} MON`} />
        <Stat label="DEX" value="Uniswap V3 · 1% pool fee" />
        <Stat label="LP fee split" value={LP_FEE_SPLIT_COPY} />
        <Stat label="Total supply" value="1,000,000,000" />
        <Stat label="Profile storage" value="Supabase images + token_meta (original pad)" />
      </div>

      <div className="pad-steps" aria-hidden>
        <i className={step >= 1 ? 'on' : ''} />
        <i className={step >= 2 ? 'on' : ''} />
        <i className={step >= 3 ? 'on' : ''} />
      </div>
      <p style={{ color: 'var(--t4)', fontSize: 12, marginTop: 4 }}>Sign → launch → done</p>
      <button type="button" className="pad-launch" onClick={launch} disabled={blocked} style={{ width: '100%', marginTop: 12, opacity: blocked ? 0.5 : 1 }}>
        {!address ? 'Connect wallet' : factoryRetired || !FACTORY_V3 || FACTORY_V3 === ZERO_ADDRESS ? 'Waiting on the factory' : `Launch (${V3_CREATION_FEE_MON} MON${devBuy && Number(devBuy) > 0 ? ` + ${devBuy} MON dev bot` : ''})`}
      </button>
      <StatusPill state={tx} />
      </div>
      <aside className="pad-preview">
        <img src="/meshy/monshi-mascot.png" alt="" className={monshiPose ? `pad-monshi ${monshiPose}` : 'pad-monshi'} />
        {imageUrl ? (
          <Image src={imageUrl} alt="" width={320} height={320} unoptimized style={{ width: '100%', height: 'auto', borderRadius: 16, objectFit: 'cover' }} />
        ) : (
          <div className="ph" />
        )}
        <h2 style={{ marginTop: 12 }}>{name || 'Your token'}</h2>
        <p style={{ color: 'var(--pink)', fontWeight: 800 }}>${symbol || 'TICKER'}</p>
        <FeeSplit />
        <p style={{ color: 'var(--t3)', fontSize: 13 }}>{description || 'The card traders will see.'}</p>
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, maxLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number }) {
  const shared = {
    value,
    placeholder,
    maxLength,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <label className="pad-field">
      <span>{label}</span>
      {multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />}
    </label>
  );
}

function PctRow({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
      <span style={{ color: '#aaa', fontSize: 13 }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="number" min={0} max={max} step={0.5} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 64, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 13, textAlign: 'right' }} />
        <span style={{ color: '#888', fontSize: 13 }}>%</span>
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

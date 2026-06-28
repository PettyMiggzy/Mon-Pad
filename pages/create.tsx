import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, decodeEventLog, type Address } from 'viem';
import { factoryV3Abi } from '@/lib/abis';
import { api } from '@/lib/api';
import {
  FACTORY_V3, V3_CREATION_FEE_MON, V3_GRADUATION_TARGET_MON, V3_CREATOR_REWARD_MON,
  V3_MAX_TRADE_TAX_BPS, V3_MAX_DEV_BUY_BPS,
} from '@/lib/constants';
import Head from 'next/head';

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
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (isSuccess && receipt && tx.status === 'pending') {
    let newAddr: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FACTORY_V3.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: factoryV3Abi as any, data: log.data, topics: log.topics }) as any;
        if (ev.eventName === 'Launch') { newAddr = ev.args.token as string; break; }
      } catch { /* not the Launch event */ }
    }
    setTx({ status: 'success', message: 'Token launched!' });
    if (newAddr) setTimeout(() => router.push(`/token/${newAddr}`), 1200);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      setImageUrl(res.url);
    } catch {
      setTx({ status: 'error', message: 'image upload failed' });
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
    if (!name || !symbol) { setTx({ status: 'error', message: 'Name and symbol required' }); return; }

    const cfBurn = bps(cfBurnPct), cfLp = bps(cfLpPct), taxBurn = bps(taxBurnPct), taxLp = bps(taxLpPct);
    if (cfBurn + cfLp > 10000) { setTx({ status: 'error', message: 'Dev-fee routing can’t exceed 100%' }); return; }
    if (taxBurn + taxLp > V3_MAX_TRADE_TAX_BPS) { setTx({ status: 'error', message: `Per-trade tax can’t exceed ${V3_MAX_TRADE_TAX_BPS / 100}%` }); return; }

    let devBuyWei = 0n;
    try { if (devBuy && Number(devBuy) > 0) devBuyWei = parseEther(devBuy); } catch { setTx({ status: 'error', message: 'invalid dev buy' }); return; }

    setTx({ status: 'pending', message: 'submitting...' });
    try {
      // off-chain metadata (best-effort; backend may be down)
      try {
        await fetch(`${process.env.NEXT_PUBLIC_INDEXER_URL || ''}/api/launches/prepare`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, symbol, description, twitter, telegram, website, imageUrl, creator: address }),
        });
      } catch {}

      const feeConfig = { cfBurnTokenBps: cfBurn, cfLpBps: cfLp, taxBurnTokenBps: taxBurn, taxLpBps: taxLp };
      const value = parseEther(V3_CREATION_FEE_MON.toString()) + devBuyWei;
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
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 90) });
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, color: '#fff' }}>
      <Head>
        <title>Launch a Token | Mon-Pad</title>
        <meta key="description" name="description" content="Launch a fair-launch token on Monad. Pay in MON, set your own tokenomics, graduate to a locked DEX pool." />
        <link key="canonical" rel="canonical" href={canonical} />
      </Head>
      <h1 style={{ marginBottom: 24 }}>Launch a token</h1>
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Name" value={name} onChange={setName} placeholder="Awesome Coin" maxLength={32} />
        <Field label="Symbol" value={symbol} onChange={(v) => setSymbol(v.toUpperCase())} placeholder="AWESOME" maxLength={10} />
        <div>
          <label style={{ fontSize: 13, color: '#aaa' }}>Image</label>
          <input type="file" accept="image/*" onChange={onFileChange} style={{ display: 'block', marginTop: 4, color: '#aaa' }} />
          {uploading && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>uploading...</div>}
          {imageUrl ? (
            <Image src={imageUrl} alt="preview" width={80} height={80} unoptimized style={{ marginTop: 8, borderRadius: 8, objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : null}
        </div>
        <Field label="Description" value={description} onChange={setDescription} placeholder="What’s this token about?" multiline />
        <Field label="Twitter" value={twitter} onChange={setTwitter} placeholder="https://x.com/..." />
        <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="https://t.me/..." />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
      </div>

      {/* Creator tokenomics */}
      <div style={{ marginTop: 24, padding: 16, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your tokenomics (optional, editable later)</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Route your own dev fee, and/or add a per-trade tax that everyone pays. Both go to buyback-burning your token or its graduation LP — never to anyone else.</div>
        <PctRow label="Dev fee → buyback &amp; burn" value={cfBurnPct} onChange={setCfBurnPct} max={100} />
        <PctRow label="Dev fee → liquidity (at graduation)" value={cfLpPct} onChange={setCfLpPct} max={100} />
        <PctRow label="Per-trade tax → buyback &amp; burn" value={taxBurnPct} onChange={setTaxBurnPct} max={V3_MAX_TRADE_TAX_BPS / 100} />
        <PctRow label="Per-trade tax → liquidity" value={taxLpPct} onChange={setTaxLpPct} max={V3_MAX_TRADE_TAX_BPS / 100} />
        <div style={{ marginTop: 10 }}>
          <Field label={`Optional dev buy (MON, ≤ ${V3_MAX_DEV_BUY_BPS / 100}% of supply, fee-free)`} value={devBuy} onChange={setDevBuy} placeholder="0" />
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Launch params (locked)</div>
        <Stat label="Creation fee" value={`${V3_CREATION_FEE_MON} MON`} />
        <Stat label="Graduation target" value={`${V3_GRADUATION_TARGET_MON.toLocaleString()} MON`} />
        <Stat label="Creator graduation reward" value={`${V3_CREATOR_REWARD_MON.toLocaleString()} MON`} />
        <Stat label="Base trade fee" value={`2% buy / 2% sell`} />
        <Stat label="Total supply" value="1,000,000,000" />
      </div>

      <button onClick={launch} disabled={!address || !name || !symbol || tx.status === 'pending'} style={{ width: '100%', marginTop: 16, padding: 14, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: (!address || !name || !symbol) ? 'not-allowed' : 'pointer', opacity: (!address || !name || !symbol) ? 0.5 : 1 }}>
        {!address ? 'Connect wallet' : `Launch (${V3_CREATION_FEE_MON} MON${devBuy && Number(devBuy) > 0 ? ` + ${devBuy} dev buy` : ''})`}
      </button>
      <StatusPill state={tx} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder, multiline, maxLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; maxLength?: number }) {
  const common = { value, onChange: (e: any) => onChange(e.target.value), placeholder, maxLength, style: { width: '100%', padding: 10, marginTop: 4, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', fontSize: 14, boxSizing: 'border-box' as const, fontFamily: 'inherit' } };
  return (
    <div>
      <label style={{ fontSize: 13, color: '#aaa' }}>{label}</label>
      {multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
    </div>
  );
}

function PctRow({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
      <span style={{ color: '#aaa', fontSize: 13 }} dangerouslySetInnerHTML={{ __html: label }} />
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

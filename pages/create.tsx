import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { factoryAbi } from '@/lib/abis';
import { api } from '@/lib/api';
import { CONTRACTS, CREATION_FEE_MON, GRADUATION_TARGET_MON, CREATOR_GRADUATION_REWARD_MON, BUY_FEE_CREATOR_BPS } from '@/lib/constants';
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
  const [tx, setTx] = useState<TxState>({ status: 'idle' });
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { data: receipt, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // When tx is confirmed, push to the new token’s page if we can extract its address
  if (isSuccess && receipt && tx.status === 'pending') {
    // Parse logs to find the new token address (best-effort)
    const log = receipt.logs?.find((l) => l.address?.toLowerCase() !== CONTRACTS.factoryV2?.toLowerCase());
    const newAddr = log?.address;
    setTx({ status: 'success', message: 'Token launched!' });
    if (newAddr) {
      setTimeout(() => router.push(`/token/${newAddr}`), 1500);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      setImageUrl(res.url);
    } catch (err: any) {
      setTx({ status: 'error', message: 'image upload failed' });
    } finally {
      setUploading(false);
    }
  }

  async function launch() {
    if (!address) return;
    if (!name || !symbol) { setTx({ status: 'error', message: 'Name and symbol required' }); return; }
    if (!CONTRACTS.factoryV2) { setTx({ status: 'error', message: 'Factory not configured' }); return; }
    setTx({ status: 'pending', message: 'submitting...' });
    try {
      // Post off-chain metadata first (best-effort)
      try {
        await fetch(`${process.env.NEXT_PUBLIC_INDEXER_URL || ''}/api/launches/prepare`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, symbol, description, twitter, telegram, website, imageUrl, creator: address }),
        });
      } catch {}
      const hash = await writeContractAsync({
        address: CONTRACTS.factoryV2 as Address,
        abi: factoryAbi as any,
        functionName: 'createLaunch' as any,
        args: [name, symbol] as any,
        value: parseEther('100'),
      } as any);
      setTxHash(hash);
      setTx({ status: 'pending', message: 'confirming...' });
    } catch (e: any) {
      setTx({ status: 'error', message: (e?.shortMessage || e?.message || 'error').slice(0, 80) });
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24, color: '#fff' }}>
      <Head>
        <title>Launch a Token | Mon-Pad</title>
        <meta key="description" name="description" content="Launch a fair-launch token on Monad in minutes. 100 MON fee, no presale, no team allocation. Earn 2% of trading fees forever." />
        <meta key="og:title" property="og:title" content="Launch a Token | Mon-Pad" />
        <meta key="og:description" property="og:description" content="Launch a fair-launch token on Monad in minutes. 100 MON fee, no presale." />
        <meta key="og:url" property="og:url" content={canonical} />
        <meta key="twitter:title" name="twitter:title" content="Launch a Token | Mon-Pad" />
        <meta key="twitter:description" name="twitter:description" content="Launch a fair-launch token on Monad in minutes." />
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
          <Image
            src={imageUrl}
            alt="preview"
            width={80}
            height={80}
            unoptimized
            style={{ marginTop: 8, borderRadius: 8, objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : null}
        </div>
        <Field label="Description" value={description} onChange={setDescription} placeholder="What’s this token about?" multiline />
        <Field label="Twitter" value={twitter} onChange={setTwitter} placeholder="https://x.com/..." />
        <Field label="Telegram" value={telegram} onChange={setTelegram} placeholder="https://t.me/..." />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Launch params (locked)</div>
        <Stat label="Creation fee" value={`${CREATION_FEE_MON} MON`} />
        <Stat label="Graduation target" value={`${GRADUATION_TARGET_MON.toString()} MON`} />
        <Stat label="Creator graduation reward" value={`${CREATOR_GRADUATION_REWARD_MON.toString()} MON`} />
        <Stat label="Creator trade fee" value={`${BUY_FEE_CREATOR_BPS / 100}%`} />
        <Stat label="Total supply" value="1,000,000,000" />
      </div>

      <button onClick={launch} disabled={!address || !name || !symbol || tx.status === 'pending'} style={{ width: '100%', marginTop: 16, padding: 14, background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: (!address || !name || !symbol) ? 'not-allowed' : 'pointer', opacity: (!address || !name || !symbol) ? 0.5 : 1 }}>
        {!address ? 'Connect wallet' : 'Launch (100 MON)'}
      </button>
      <StatusPill state={tx} />
      {/* TODO: image cropping, preview pane, richer validation */}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

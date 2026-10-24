// Launch form for Monpad V4: the creation fee and an optional dev buy are paid in USDC; the pool is USDC / token.
import { useEffect, useState, type ChangeEvent } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useAccount, useBalance, usePublicClient, useReadContract, useSignMessage, useWriteContract } from 'wagmi';
import { decodeEventLog, formatEther, formatUnits, parseEther, parseUnits, type Address, type Hex } from 'viem';
import { api } from '@/lib/api';
import { LAUNCHER_V4, MAX_CREATOR_TAX_BPS, MAX_DEV_BUY_BPS, QUOTE_DECIMALS } from '@/lib/v4/config';
import { erc20V4Abi, launcherV4Abi } from '@/lib/v4/abis';
import { monUsdcRaw } from '@/lib/v4/chain';
import { setHeroMood } from '@/components/hero3d/bus';
import { useToast } from '@/components/ui/Toast';

type Tx = { status: 'idle' | 'pending' | 'success' | 'error'; message?: string };
const usd = (v: bigint) => Number(formatUnits(v, QUOTE_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 });

function friendly(e: any): string {
  const m = String(e?.shortMessage || e?.message || 'Launch failed');
  if (/dev buy over cap/i.test(m)) return `Dev buy is over the ${MAX_DEV_BUY_BPS / 100}% of supply cap. Lower it.`;
  if (/launches paused/i.test(m)) return 'Launches are paused right now.';
  if (/not enough USDC/i.test(m)) return 'MON price moved while launching, or the amount is too small. Try again.';
  if (/blacklist|paused/i.test(m)) return 'USDC refused the transfer (paused or blacklisted). Try again later.';
  if (/User rejected|denied/i.test(m)) return 'Cancelled in wallet.';
  return m.slice(0, 120);
}

export default function V4Create() {
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [taxPct, setTaxPct] = useState('0');
  const [devBuy, setDevBuy] = useState('');
  const [payWith, setPayWith] = useState<'MON' | 'USDC'>('MON');
  const [monRaw, setMonRaw] = useState<number | null>(null);
  useEffect(() => { monUsdcRaw().then(setMonRaw).catch(() => {}); }, []);
  const { data: monBal } = useBalance({ address, query: { enabled: !!address } });
  const [tx, setTx] = useState<Tx>({ status: 'idle' });

  const { data: usdcAddr } = useReadContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'quoteAsset' });
  const { data: feeRaw } = useReadContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'creationFee' });
  const { data: pausedRaw } = useReadContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'launchPaused' });
  const { data: balRaw, refetch: refetchBal } = useReadContract({
    address: usdcAddr as Address, abi: erc20V4Abi, functionName: 'balanceOf', args: [address as Address], query: { enabled: !!usdcAddr && !!address },
  });

  const fee = (feeRaw as bigint | undefined) ?? 0n;
  const bal = (balRaw as bigint | undefined) ?? 0n;
  const taxBps = Math.min(MAX_CREATOR_TAX_BPS, Math.max(0, Math.round((parseFloat(taxPct) || 0) * 100)));
  let devWei = 0n;
  let devBad = false;
  try { if (devBuy && Number(devBuy) > 0) devWei = parseUnits(devBuy, QUOTE_DECIMALS); } catch { devBad = true; }
  // MON path: the launcher converts MON to USDC inside the launch transaction. Only offered while the creation fee is 0.
  const monMode = payWith === 'MON' && fee === 0n;
  let devMon = 0n;
  let devMonBad = false;
  try { if (devBuy && Number(devBuy) > 0) devMon = parseEther(devBuy); } catch { devMonBad = true; }
  const expectedUsdc = monRaw ? BigInt(Math.floor(Number(devMon) * monRaw)) : 0n;
  const total = monMode ? 0n : fee + devWei;
  const paused = pausedRaw === true;
  const monHave = monBal?.value ?? 0n;
  const short = monMode ? monHave < devMon : bal < total;

  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query; const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
    if (one(q.name)) setName(one(q.name).slice(0, 32));
    if (one(q.symbol)) setSymbol(one(q.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
    if (one(q.desc)) setDescription(one(q.desc).slice(0, 240));
    if (/^https:\/\//i.test(one(q.img))) setImageUrl(one(q.img));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { setImageUrl((await api.uploadImage(file)).url); setTx({ status: 'idle' }); }
    catch (err: any) { setTx({ status: 'error', message: err?.message || 'image upload failed' }); }
    finally { setUploading(false); }
  }

  async function launch() {
    if (!address || !publicClient || !usdcAddr) return;
    if (!name.trim() || !symbol.trim()) return setTx({ status: 'error', message: 'Name and symbol required' });
    if (monMode ? devMonBad : devBad) return setTx({ status: 'error', message: 'Invalid dev buy amount' });
    try {
      if (monMode) {
        if (devMon > 0n && !monRaw) return setTx({ status: 'error', message: 'MON price not loaded yet, try again.' });
        setTx({ status: 'pending', message: 'Launching' });
        const sb = new Uint8Array(32); crypto.getRandomValues(sb);
        const salt0 = `0x${Array.from(sb, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
        const minUsdc = (expectedUsdc * 97n) / 100n; // 3% below the pool price; reverts if MON/USDC moved against us
        const h0 = await writeContractAsync({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'launchWithMon', args: [name.trim(), symbol.trim(), salt0, taxBps, minUsdc], value: devMon } as any);
        return await finish(h0);
      }
      const allowance = (await publicClient.readContract({ address: usdcAddr as Address, abi: erc20V4Abi, functionName: 'allowance', args: [address, LAUNCHER_V4] })) as bigint;
      if (allowance < total) {
        setTx({ status: 'pending', message: `Step 1 of 2: approve ${usd(total)} USDC` });
        const ah = await writeContractAsync({ address: usdcAddr as Address, abi: erc20V4Abi, functionName: 'approve', args: [LAUNCHER_V4, total] } as any);
        await publicClient.waitForTransactionReceipt({ hash: ah });
      }
      setTx({ status: 'pending', message: 'Step 2 of 2: launching' });
      const saltBytes = new Uint8Array(32); crypto.getRandomValues(saltBytes);
      const salt = `0x${Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
      const hash = await writeContractAsync({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'launch', args: [name.trim(), symbol.trim(), salt, taxBps, devWei] } as any);
      await finish(hash);
    } catch (e: any) {
      const message = friendly(e);
      setTx({ status: 'error', message });
      setHeroMood('facepalm', 1800);
      toast.push(message, 'err');
    }
  }

  async function finish(hash: Hex) {
    if (!publicClient || !address) return;
    {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Launch transaction failed');
      let newAddr: string | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== LAUNCHER_V4.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: launcherV4Abi, data: log.data, topics: (log as any).topics }) as any;
          if (ev.eventName === 'Launched') { newAddr = ev.args.token as string; break; }
        } catch { /* other event */ }
      }
      setTx({ status: 'success', message: 'Token launched.' });
      setHeroMood('celebrate', 2600);
      toast.push('Token launched.');
      refetchBal();
      if (newAddr) {
        const dest = newAddr;
        (async () => {
          let signature: string | undefined;
          try { signature = await signMessageAsync({ account: address, message: `Mon-Pad: set metadata for token ${dest.toLowerCase()}` }); } catch { /* optional */ }
          fetch('/api/token-meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: dest, name, symbol, imageUrl, description, twitter, telegram, website, signature }) }).catch(() => {});
        })();
        setTimeout(() => router.push(`/token/${dest}`), 1200);
      }
    }
  }

  const blocked = !address || !name.trim() || !symbol.trim() || tx.status === 'pending' || paused || short || devBad || devMonBad;
  const label = !address ? 'Connect wallet' : paused ? 'Launches paused'
    : monMode ? (short ? `Need ${formatEther(devMon)} MON` : devMon > 0n ? `Launch (${devBuy} MON dev buy)` : 'Launch (free)')
    : short ? `Need ${usd(total)} USDC (you have ${usd(bal)})` : `Launch (${usd(total)} USDC)`;

  return (
    <div className="pad-create">
      <Head><title>Launch a token | MONPAD</title></Head>
      <div>
        <p className="pad-kicker">Create</p>
        <h1>Launch a token</h1>
        <p style={{ color: 'var(--t3)', marginTop: -8, marginBottom: 16 }}>Your token launches straight into a Uniswap V4 pool against USDC. No bonding curve, tradable the moment the transaction lands.</p>
        <div style={{ display: 'grid', gap: 16 }}>
          <label className="pad-field"><span>Name</span><input type="text" value={name} maxLength={32} placeholder="Awesome Coin" onChange={(e) => setName(e.target.value)} /></label>
          <label className="pad-field"><span>Symbol</span><input type="text" value={symbol} maxLength={10} placeholder="AWESOME" onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
          <div>
            <label style={{ fontSize: 13, color: '#aaa' }}>Token profile picture</label>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFile} style={{ display: 'block', marginTop: 4, color: '#aaa' }} />
            {uploading && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Uploading…</div>}
            {imageUrl && <Image src={imageUrl} alt="preview" width={80} height={80} unoptimized style={{ marginTop: 8, borderRadius: 8, objectFit: 'cover' }} />}
          </div>
          <label className="pad-field"><span>Description</span><textarea rows={3} value={description} placeholder="What's this token about?" onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="pad-field"><span>Twitter</span><input type="text" value={twitter} placeholder="https://x.com/..." onChange={(e) => setTwitter(e.target.value)} /></label>
          <label className="pad-field"><span>Telegram</span><input type="text" value={telegram} placeholder="https://t.me/..." onChange={(e) => setTelegram(e.target.value)} /></label>
          <label className="pad-field"><span>Website</span><input type="text" value={website} placeholder="https://..." onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Creator tax: {taxBps / 100}%</div>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
            Every trade pays 1% plus this tax (0 to {MAX_CREATOR_TAX_BPS / 100}%), enforced inside the pool. The tax buys and burns your token. It cannot be changed after launch.
          </div>
          <input type="range" min={0} max={MAX_CREATOR_TAX_BPS / 100} step={0.1} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} style={{ width: '100%' }} aria-label="Creator tax percent" />
        </div>

        <div style={{ marginTop: 16, padding: 16, background: 'rgba(236,72,153,0.06)', border: '1px solid rgba(236,72,153,0.28)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: 'var(--pink, #EC4899)' }}>Dev buy (optional)</div>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10, lineHeight: 1.45 }}>
            Your first buy lands in the launch transaction, before anyone else can trade. Capped at {MAX_DEV_BUY_BPS / 100}% of supply.
            {fee === 0n ? ' Pay in MON and we convert it to USDC for you in the same transaction.' : ''}
          </div>
          {fee === 0n && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['MON', 'USDC'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setPayWith(k)} aria-pressed={payWith === k} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(167,139,250,0.5)', color: '#fff', background: payWith === k ? 'rgba(167,139,250,0.35)' : 'transparent', cursor: 'pointer' }}>{k}</button>
              ))}
            </div>
          )}
          <label className="pad-field"><span>Dev buy ({monMode ? 'MON' : 'USDC'})</span><input type="text" inputMode="decimal" value={devBuy} placeholder="0" onChange={(e) => setDevBuy(e.target.value)} /></label>
        </div>

        <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Launch summary</div>
          {(monMode
            ? [['Creation fee', 'Free'], ['Dev buy', devMon > 0n ? `${devBuy} MON (about $${(Number(expectedUsdc) / 1e6).toFixed(2)})` : 'none'], ['Your MON', address ? `${Number(formatEther(monHave)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MON` : 'connect a wallet']]
            : [['Creation fee', `${usd(fee)} USDC`], ['Dev buy', `${usd(devWei)} USDC`], ['Total', `${usd(total)} USDC`], ['Your USDC', address ? `${usd(bal)} USDC` : 'connect a wallet']]
          ).concat([ ['Trade fee', `${(100 + taxBps) / 100}% (1% + ${taxBps / 100}% tax)`], ['Supply', '1,000,000,000']]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span style={{ color: '#aaa' }}>{k}</span><span>{v}</span></div>
          ))}
          <div style={{ color: '#888', fontSize: 11, marginTop: 6 }}>Gas is paid in MON.{monMode ? ' Any unused MON is refunded.' : ' USDC is the only token you spend on the launch.'}</div>
        </div>

        <button type="button" className="pad-launch" onClick={launch} disabled={blocked} style={{ width: '100%', marginTop: 16, opacity: blocked ? 0.5 : 1 }}>{tx.status === 'pending' ? tx.message : label}</button>
        {tx.status !== 'idle' && tx.status !== 'pending' && (
          <div role="status" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, border: `1px solid ${tx.status === 'success' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)'}`, color: tx.status === 'success' ? 'var(--ok, #4ADE80)' : 'var(--err, #F87171)', fontSize: 13 }}>{tx.message}</div>
        )}
      </div>
      <aside className="pad-preview">
        <img src="/meshy/monshi-mascot.png" alt="" className={tx.status === 'success' ? 'pad-monshi pop' : tx.status === 'error' ? 'pad-monshi down' : 'pad-monshi'} />
        {imageUrl ? <Image src={imageUrl} alt="" width={320} height={320} unoptimized style={{ width: '100%', height: 'auto', borderRadius: 16, objectFit: 'cover' }} /> : <div className="ph" />}
        <h2 style={{ marginTop: 12 }}>{name || 'Your token'}</h2>
        <p style={{ color: 'var(--pink)', fontWeight: 800 }}>${symbol || 'TICKER'}</p>
        <p style={{ color: 'var(--t3)', fontSize: 13 }}>{description || 'The card traders will see.'}</p>
      </aside>
    </div>
  );
}

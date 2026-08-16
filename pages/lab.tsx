import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import Head from 'next/head';
import {
  createPublicClient, http, defineChain, keccak256, encodeAbiParameters, concat,
  getCreate2Address, parseEther, formatEther, stringToHex, pad as padHex, type Address,
} from 'viem';
import { isAdmin, ADMIN_WALLETS } from '@/lib/constants';
import { REKT_PAD_ABI, PAD_TOKEN_BYTECODE } from '@/lib/rekt/abi';

/**
 * HIDDEN launcher — RektPad, Robinhood Chain (4663).
 *
 * UNLISTED: no nav entry anywhere (compare /admin, which IS linked for admin wallets), gated to
 * ADMIN_WALLETS, noindex,nofollow. URL only.
 *
 * SELF-CONTAINED: reads 4663 through its own viem client and signs through the connected wallet with an
 * explicit chain id. lib/wagmi.ts is untouched — adding 4663 there would put a chain switcher in front
 * of every ordinary Monad user for the sake of one hidden page.
 *
 * WHAT THE PRESETS ENCODE, measured over ~2,900 real launches on this chain:
 *   Two settings decide whether bots show up, and they only mean anything TOGETHER — which launchpad
 *   made the pool, and which side the token address sorts on. e51960f1+token1 drew a fast bot 85% of
 *   the time; 1f7d7550+token0 51%; 1f7d7550+token1 32%; e51960f1+token0 13%. Seeded token count matters
 *   separately: 0.5-5B drew 51% against 8% for under 0.5B. Seeding 1.0 ETH reaches 92%, but only within
 *   a narrow band around exactly 1.0 — $50 or $500 does nothing, so there is no cheap version of it.
 *
 *   The DEV BUY is a separate lever and does NOT change any of that: launches with one drew bots 45% of
 *   the time versus 44% without. It is not bait, it is your position — it rides inside the launch
 *   transaction, so nothing can get in front of it, not even a bot watching the mempool.
 *
 * WHY A FORM AND NOT THE CLI: scripts/run-arm.js runs controlled multi-launch arms and carries resume,
 * pre-registration checks and a salt layout that keeps arms comparable. This is for launching ONE token
 * and watching what happens. It still does the staticCall preflight, because a launch that reverts on
 * chain costs gas for nothing.
 */

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://robinhoodchain.blockscout.com/api/eth-rpc'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});
const EXPLORER = robinhood.blockExplorers.default.url;
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as Address;

const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 } as const;

/** Each preset is a measured cell, not a guess. `hit` is the observed fast-bot rate. */
const PRESETS = [
  {
    id: 'free-best', label: 'Best free', hit: '85%', cost: 'gas only',
    note: 'Highest rate that costs nothing. Needs the pad deployed against factory e51960f1.',
    wantTokenIsToken0: false, seedQuoteWei: 0n,
  },
  {
    id: 'free-alt', label: 'Free, other factory', hit: '51%', cost: 'gas only',
    note: 'For a pad deployed against factory 1f7d7550 — the token must sort as token0 there.',
    wantTokenIsToken0: true, seedQuoteWei: 0n,
  },
  {
    id: 'paid', label: 'Seed 1 ETH', hit: '92%', cost: '~$1,883',
    note: 'Seven points more than free, and that ETH sits in the pool for anyone to sell into.',
    wantTokenIsToken0: false, seedQuoteWei: parseEther('1'),
  },
] as const;

const SUPPLY = 10n ** 27n;          // 1,000,000,000 tokens at 18dp
const SEED_TOKENS = 98n * 10n ** 25n; // 980,000,000 — inside the measured 0.5-5B window
const FEE = 10000;
const OPENING_TICK = 253000;

const S = {
  page: { maxWidth: 780, margin: '0 auto', padding: 24, color: '#fff' } as const,
  card: { border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'rgba(255,255,255,.03)' } as const,
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 } as const,
  lab: { fontSize: 12, opacity: .6, marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' as const },
  input: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.3)', color: '#fff', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 } as const,
  btn: (on: boolean) => ({
    border: '1px solid ' + (on ? '#5EC5B8' : 'rgba(255,255,255,.2)'),
    background: on ? 'rgba(94,197,184,.15)' : 'rgba(255,255,255,.06)',
    color: '#fff', borderRadius: 6, padding: '10px 16px', fontSize: 14,
    cursor: on ? 'pointer' : 'not-allowed', opacity: on ? 1 : .5,
  }),
  warn: { border: '1px solid rgba(239,68,68,.5)', background: 'rgba(239,68,68,.12)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 } as const,
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '4px 0' } as const,
};

export default function LabPage() {
  const { address, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();

  const [padAddr, setPadAddr] = useState('');
  const [preset, setPreset] = useState<string>('free-best');
  const [devBuy, setDevBuy] = useState('0');
  const [name, setName] = useState('Rekt');
  const [symbol, setSymbol] = useState('REKT');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; tx: string } | null>(null);

  // Deliberately does NOT redirect. Bouncing an unrecognised wallet to "/" is indistinguishable from
  // the page not existing — it silently lands you on the normal pad and looks like a broken link. The
  // gate still refuses to render anything operational; it just says why, and which address it saw.

  const client = useMemo(() => createPublicClient({ chain: robinhood, transport: http() }), []);
  const cfg = PRESETS.find((p) => p.id === preset)!;
  const padOk = /^0x[a-fA-F0-9]{40}$/.test(padAddr);

  /** Mine a CREATE2 salt so the token lands on the wanted side of WETH. ~2 tries on average. */
  const mineSalt = useCallback((pad: Address, wantToken0: boolean) => {
    const args = encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }],
      [name, symbol, 18, SUPPLY, pad],
    );
    const initHash = keccak256(concat([PAD_TOKEN_BYTECODE as `0x${string}`, args]));
    for (let i = 0; i < 200000; i++) {
      const salt = padHex(`0x${i.toString(16)}` as `0x${string}`, { size: 32 });
      const token = getCreate2Address({ from: pad, salt, bytecodeHash: initHash });
      if ((BigInt(token) < BigInt(WETH)) === wantToken0) return { salt, token };
    }
    throw new Error('no salt found');
  }, [name, symbol]);

  const buildParams = useCallback((pad: Address) => {
    const { salt } = mineSalt(pad, cfg.wantTokenIsToken0);
    const quote = cfg.seedQuoteWei;
    // A position holding quote must straddle the price; a token-only position must sit below it.
    // That is V3 arithmetic, not a preference — so the range follows the seed, it is not a knob.
    const tickLower = quote > 0n ? -887200 : 46000;
    const tickUpper = quote > 0n ? 887200 : OPENING_TICK;
    return {
      experimentId: keccak256(stringToHex('live')),
      armId: keccak256(stringToHex(cfg.id)),
      replicate: 1,
      name, symbol, decimals: 18, totalSupply: SUPPLY,
      tokenSalt: salt, wantTokenIsToken0: cfg.wantTokenIsToken0,
      fee: FEE, openingTick: OPENING_TICK, tickLower, tickUpper,
      seedTokenAmount: SEED_TOKENS, seedQuoteWei: quote,
      seedTokenMin: 0n, seedQuoteMin: 0n,
      lpTo: Recipient.OPERATOR,
      devBuyQuoteWei: devBuy && Number(devBuy) > 0 ? parseEther(devBuy) : 0n,
      devBuyMinTokensOut: 0n, devBuySqrtPriceLimitX96: 0n,
      devBuyTo: Recipient.OPERATOR, residualTo: Recipient.BURN,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    };
  }, [cfg, devBuy, mineSalt, name, symbol]);

  const check = useCallback(async () => {
    if (!padOk) return;
    setBusy(true); setStatus('checking…'); setPreview(null); setResult(null);
    try {
      const pad = padAddr as Address;
      const p = buildParams(pad);
      const pv = await client.readContract({ address: pad, abi: REKT_PAD_ABI, functionName: 'previewLaunch', args: [p] });
      // The preflight that matters: simulate the REAL call. previewLaunch skips several checks, so a
      // nonzero preview is not proof the launch would land.
      await client.simulateContract({
        address: pad, abi: REKT_PAD_ABI, functionName: 'launch', args: [p],
        value: p.seedQuoteWei + p.devBuyQuoteWei, account: address as Address,
      });
      setPreview({ pv, params: p });
      setStatus('ready — this would go through');
    } catch (e: any) {
      setStatus('would fail: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, buildParams, client, padAddr, padOk]);

  const launch = useCallback(async () => {
    if (!wallet || !preview) return;
    setBusy(true); setStatus('confirm in your wallet…');
    try {
      const p = preview.params;
      const hash = await wallet.writeContract({
        address: padAddr as Address, abi: REKT_PAD_ABI, functionName: 'launch', args: [p],
        value: p.seedQuoteWei + p.devBuyQuoteWei, chain: robinhood, account: address as Address,
      });
      setStatus('sent, waiting for the chain…');
      await client.waitForTransactionReceipt({ hash });
      setResult({ token: preview.pv[0], tx: hash });
      setStatus('launched');
    } catch (e: any) {
      setStatus('failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, client, padAddr, preview, wallet]);

  if (!isConnected) return <div style={S.page}>Connect a wallet to continue.</div>;
  if (!isAdmin(address)) {
    return (
      <div style={S.page}>
        <Head><title>Lab | Mon-Pad</title><meta key="robots" name="robots" content="noindex,nofollow" /></Head>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>This wallet isn&apos;t on the list</h1>
        <div style={S.card}>
          <div style={S.lab}>Connected</div>
          <div style={S.mono}>{address}</div>
        </div>
        <div style={S.card}>
          <div style={S.lab}>Allowed</div>
          {ADMIN_WALLETS.map((w) => <div key={w} style={{ ...S.mono, marginBottom: 4 }}>{w}</div>)}
        </div>
        <p style={{ fontSize: 13, opacity: .7, maxWidth: '48ch' }}>
          Either connect one of those, or add the address above to <code style={S.mono}>ADMIN_WALLETS</code> in
          <code style={S.mono}> lib/constants.ts</code> and redeploy.
        </p>
      </div>
    );
  }

  const total = (cfg.seedQuoteWei + (devBuy && Number(devBuy) > 0 ? parseEther(devBuy) : 0n));

  return (
    <div style={S.page}>
      <Head><title>Lab | Mon-Pad</title><meta key="robots" name="robots" content="noindex,nofollow" /></Head>

      <h1 style={{ fontSize: 22, marginBottom: 4 }}>RektPad</h1>
      <div style={{ opacity: .6, fontSize: 13, marginBottom: 20 }}>Robinhood Chain · 4663 · unlisted</div>

      <div style={S.warn}>
        Real chain, real money. Tokens matching this pattern die in about three minutes — 0 of 330 were
        still trading six hours later. Bots arriving is not the same as the coin going anywhere.
      </div>

      <div style={S.card}>
        <div style={S.lab}>Pad address</div>
        <input style={S.input} value={padAddr} onChange={(e) => setPadAddr(e.target.value.trim())} placeholder="0x… (deploy first)" />
      </div>

      <div style={S.card}>
        <div style={S.lab}>Setup</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map((p) => (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: 8, borderRadius: 6, background: preset === p.id ? 'rgba(94,197,184,.1)' : 'transparent' }}>
              <input type="radio" name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} style={{ marginTop: 3 }} />
              <span>
                <b>{p.label}</b> · <span style={{ color: '#5EC5B8' }}>{p.hit} draw a bot</span> · <span style={{ opacity: .65 }}>{p.cost}</span>
                <br /><span style={{ fontSize: 12, opacity: .6 }}>{p.note}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div style={S.card}>
        <div style={S.lab}>Your buy (goes in the same transaction — nothing can front-run it)</div>
        <input style={S.input} value={devBuy} onChange={(e) => setDevBuy(e.target.value.trim())} placeholder="0" />
        <div style={{ fontSize: 12, opacity: .6, marginTop: 6 }}>
          ETH. Doesn&apos;t change whether bots come (45% with, 44% without) — it decides whether you&apos;re in front of them.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}><div style={S.lab}>Name</div><input style={S.input} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div style={{ flex: 1 }}><div style={S.lab}>Symbol</div><input style={S.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.row}><span style={{ opacity: .6 }}>Seeded into the pool</span><span style={S.mono}>{formatEther(cfg.seedQuoteWei)} ETH + 980,000,000 {symbol}</span></div>
        <div style={S.row}><span style={{ opacity: .6 }}>Your buy</span><span style={S.mono}>{devBuy || '0'} ETH</span></div>
        <div style={{ ...S.row, borderTop: '1px solid rgba(255,255,255,.12)', marginTop: 6, paddingTop: 10 }}>
          <span><b>Total you send</b></span><span style={{ ...S.mono, fontSize: 15 }}><b>{formatEther(total)} ETH</b></span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={S.btn(padOk && !busy)} disabled={!padOk || busy} onClick={() => void check()}>Check first</button>
        <button style={S.btn(!!preview && !busy)} disabled={!preview || busy} onClick={() => void launch()}>Launch</button>
        {status && <span style={{ fontSize: 13, opacity: .8 }}>{status}</span>}
      </div>

      {preview && !result && (
        <div style={{ ...S.card, marginTop: 16 }}>
          <div style={S.lab}>Token address it will land on</div>
          <div style={S.mono}>{preview.pv[0]}</div>
          <div style={{ fontSize: 12, opacity: .6, marginTop: 6 }}>
            Sorts as {preview.pv[2] ? 'token0' : 'token1'} — this is the setting that decides the bot rate.
          </div>
        </div>
      )}

      {result && (
        <div style={{ ...S.card, marginTop: 16, borderColor: '#5EC5B8' }}>
          <div style={S.lab}>Launched</div>
          <a href={`${EXPLORER}/address/${result.token}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc' }}>{result.token}</a>
          <div style={{ marginTop: 8 }}>
            <a href={`${EXPLORER}/tx/${result.tx}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc', fontSize: 12 }}>view transaction</a>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, opacity: .45, marginTop: 24 }}>
        Unlisted: no nav entry, admin-gated, noindex. Your wallet signs — no key is ever held here.
      </div>
    </div>
  );
}

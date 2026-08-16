import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSendTransaction, useWalletClient } from 'wagmi';
import Head from 'next/head';
import {
  createPublicClient, http, keccak256, encodeAbiParameters, encodeDeployData, concat,
  getCreate2Address, parseEther, formatEther, stringToHex, pad as padHex, type Address,
} from 'viem';
import { robinhood } from '@/lib/wagmi';
import { isAdmin, ADMIN_WALLETS } from '@/lib/constants';
import { REKT_PAD_ABI, PAD_TOKEN_BYTECODE } from '@/lib/rekt/abi';
import { VENUES, START_LAUNCH_ID, ROBINHOOD_CHAIN_ID, type VenueId } from '@/lib/rekt/venues';

/**
 * HIDDEN launcher — RektPad, Robinhood Chain (4663).
 *
 * UNLISTED: no nav entry anywhere (compare /admin, which IS linked for admin wallets), gated to
 * ADMIN_WALLETS, noindex,nofollow. URL only.
 *
 * READS ARE SELF-CONTAINED: the preflight goes through this page's own viem client, so "Check first"
 * works whatever chain the wallet is on. SIGNING is not — 4663 is declared in lib/wagmi.ts because
 * wagmi ignores a switch to any chain it doesn't know, which pinned the app to Monad and made
 * RainbowKit report "Wrong network" with no way out. See the note there.
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

const EXPLORER = robinhood.blockExplorers.default.url;
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as Address;

const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 } as const;

/**
 * Each preset is a measured cell, not a guess. `hit` is the observed fast-bot rate.
 *
 * `venue` is part of the cell, not a footnote: the factory and the sort side only mean anything together,
 * so a preset run against a pad built on the other factory isn't a weaker version of the same bet — it is
 * a different cell entirely (e51960f1+token1 is 85%, e51960f1+token0 is 13%). The pad you point at is
 * therefore checked against this field before anything can launch.
 */
const PRESETS = [
  {
    id: 'free-best', label: 'Best free', hit: '85%', cost: 'gas only',
    note: 'Highest rate that costs nothing.',
    wantTokenIsToken0: false, seedQuoteWei: 0n, venue: 'sushi' as VenueId,
  },
  {
    id: 'free-alt', label: 'Free, other factory', hit: '51%', cost: 'gas only',
    note: 'The other venue — there the token has to sort as token0 instead.',
    wantTokenIsToken0: true, seedQuoteWei: 0n, venue: 'canonical' as VenueId,
  },
  {
    id: 'paid', label: 'Seed 1 ETH', hit: '92%', cost: '~$1,883',
    note: 'Seven points more than free, and that ETH sits in the pool for anyone to sell into.',
    wantTokenIsToken0: false, seedQuoteWei: parseEther('1'), venue: 'sushi' as VenueId,
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

/**
 * Wallet picker that names wallets by EIP-6963 rdns instead of the isMetaMask flag.
 *
 * The header uses RainbowKit's modal, and its "MetaMask" button resolves a provider through
 * getInjectedProvider({ flag: 'isMetaMask' }) — it takes the first injected provider whose
 * `isMetaMask` property is truthy. Uniswap Wallet sets isMetaMask = true (so do Rabby, Brave and
 * Phantom) for compatibility with dapps that only check that one boolean. So on a machine where
 * one of those won the window.ethereum race, RainbowKit's MetaMask button opens THAT wallet, and
 * RainbowKit will even show MetaMask as "installed" when it isn't.
 *
 * EIP-6963 is the fix for exactly this: each extension announces itself with a reverse-DNS id, so
 * io.metamask and org.uniswap are distinguishable and neither can claim the other's name. wagmi
 * turns every announcement into its own connector, and this lists them by that id — what you click
 * is what opens.
 */
function WalletPicker() {
  const { connect, connectors, isPending, error } = useConnect();
  // rdns ids are dotted ("io.metamask"); the flag-guessing built-ins are not ("metaMask").
  const detected = connectors.filter((c) => c.id.includes('.'));
  const list = detected.length > 0 ? detected : connectors;
  const wc = detected.length > 0 ? connectors.find((c) => c.id === 'walletConnect') : undefined;

  const item = (c: (typeof connectors)[number]) => (
    <button
      key={c.uid}
      onClick={() => connect({ connector: c })}
      disabled={isPending}
      style={{ ...S.btn(!isPending), display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left' }}
    >
      {c.icon && <img src={c.icon} alt="" width={20} height={20} style={{ borderRadius: 4 }} />}
      <b style={{ flex: 1 }}>{c.name}</b>
      <span style={{ ...S.mono, fontSize: 11, opacity: .5 }}>{c.id}</span>
    </button>
  );

  return (
    <div style={S.page}>
      <Head><title>Lab | Mon-Pad</title><meta key="robots" name="robots" content="noindex,nofollow" /></Head>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>RektPad</h1>
      <div style={{ opacity: .6, fontSize: 13, marginBottom: 20 }}>Robinhood Chain · 4663 · unlisted</div>

      <div style={S.card}>
        <div style={S.lab}>{detected.length > 0 ? 'Wallets this browser actually has' : 'Connect'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.length > 0 ? list.map(item) : <div style={{ fontSize: 13, opacity: .7 }}>No wallet extension detected.</div>}
        </div>
        {wc && <div style={{ marginTop: 12 }}>{item(wc)}</div>}
      </div>

      <p style={{ fontSize: 12, opacity: .55, maxWidth: '54ch' }}>
        Use these buttons, not the one in the header. The header&apos;s &ldquo;MetaMask&rdquo; picks whichever
        extension claims <code style={S.mono}>isMetaMask</code>, and Uniswap Wallet claims it too — which is why
        clicking MetaMask up there can open Uniswap. The ids above come from each extension&apos;s own EIP-6963
        announcement, so they can&apos;t be borrowed.
      </p>
      {error && <div style={S.warn}>{String(error.message || error).slice(0, 200)}</div>}
    </div>
  );
}

export default function LabPage() {
  const { address, isConnected, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const { disconnect } = useDisconnect();
  const { sendTransactionAsync } = useSendTransaction();

  // Connector list is browser-only (EIP-6963 announcements arrive after mount), so the server render
  // and the first client render would disagree. Hold the first paint rather than hydrate a mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  /**
   * Deploy a pad from the browser, so running this needs a wallet and nothing else — no funded deploy key,
   * no CLI, no env vars. Same constructor arguments scripts/deploy-experiment-pad.js passes, with the
   * venue's measured factory/NPM/WETH and its verified init-code-hash-plus-probe pair.
   *
   * Owner, rescue recipient and LP vault all become the connected wallet: it is the only address the
   * browser can prove control of, and every one of those is a destination for value. The vault is where
   * position NFTs land, so pointing it anywhere unverified is how liquidity gets lost.
   */
  const deployPad = useCallback(async () => {
    if (!wallet || !address) return;
    const venue = VENUES[cfg.venue];
    setBusy(true); setStatus('preparing pad bytecode…'); setResult(null); setPreview(null);
    try {
      // ~20 KB of bytecode that only matters on this click — keep it out of the page's first load.
      const { REKT_PAD_BYTECODE, REKT_PAD_CONSTRUCTOR_ABI } = await import('@/lib/rekt/padBytecode');
      // encodeDeployData + sendTransaction rather than wallet.deployContract: the latter's parameter type is
      // a union that TypeScript resolves into the EIP-4844 blob branch here and then demands a `kzg` field.
      // This is what deployContract does internally anyway, and the constructor args still typecheck against
      // the ABI — which is the part worth keeping, since they are ten near-identical addresses in a row.
      const data = encodeDeployData({
        abi: REKT_PAD_CONSTRUCTOR_ABI, bytecode: REKT_PAD_BYTECODE,
        args: [
          address as Address,             // owner
          address as Address,             // rescue recipient
          address as Address,             // LP vault — position NFTs land here
          venue.factory, venue.npm, venue.weth,
          BigInt(ROBINHOOD_CHAIN_ID), START_LAUNCH_ID,
          venue.initCodeHash, venue.probe,
        ],
      });
      setStatus('confirm the deploy in your wallet…');
      // wagmi's sendTransaction rather than the wallet client's: viem's own parameter type is a union over
      // transaction kinds that, with a generic chain, resolves to the EIP-4844 blob branch and demands a KZG
      // trusted setup for a plain deploy. wagmi's version is written over the configured chains, so it
      // resolves concretely — which is the other reason 4663 belongs in the wagmi config.
      const hash = await sendTransactionAsync({ chainId: ROBINHOOD_CHAIN_ID, data });
      setStatus('deploying, waiting for the chain…');
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('deploy mined without a contract address');
      setPadAddr(receipt.contractAddress);
      setStatus(`pad deployed on ${venue.label} — now Check first`);
    } catch (e: any) {
      setStatus('deploy failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, cfg.venue, client, sendTransactionAsync, wallet]);

  const check = useCallback(async () => {
    if (!padOk) return;
    setBusy(true); setStatus('checking…'); setPreview(null); setResult(null);
    try {
      const pad = padAddr as Address;
      // The factory is half of the measured cell, so a pad built on the other venue quietly turns an 85%
      // setup into a 13% one. Ask the pad which factory it is welded to before trusting the preset's number.
      const padFactory = await client.readContract({ address: pad, abi: REKT_PAD_ABI, functionName: 'FACTORY' }) as Address;
      const want = VENUES[cfg.venue];
      if (padFactory.toLowerCase() !== want.factory.toLowerCase()) {
        const actual = Object.values(VENUES).find((v) => v.factory.toLowerCase() === padFactory.toLowerCase());
        setStatus(
          `wrong pad for this setup: "${cfg.label}" was measured on ${want.label} (${want.short}), but this pad is built on ` +
          `${actual ? `${actual.label} (${actual.short})` : padFactory} — pick the matching setup, or deploy a pad below.`,
        );
        setBusy(false);
        return;
      }
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
  }, [address, buildParams, cfg.label, cfg.venue, client, padAddr, padOk]);

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

  /**
   * 4663 is deliberately absent from lib/wagmi.ts (see header), so useSwitchChain can't reach it —
   * it only knows configured chains. Go through the wallet client directly: try the switch first,
   * and fall back to addChain, because a wallet that already has 4663 rejects a duplicate add.
   */
  const switchToRobinhood = useCallback(async () => {
    if (!wallet) return;
    setStatus('');
    try {
      await wallet.switchChain({ id: robinhood.id });
    } catch {
      try {
        await wallet.addChain({ chain: robinhood });
        await wallet.switchChain({ id: robinhood.id });
      } catch (e: any) {
        setStatus('chain switch failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 160));
      }
    }
  }, [wallet]);
  const onRobinhood = chainId === robinhood.id;

  if (!mounted) return <div style={S.page} />;
  if (!isConnected) return <WalletPicker />;
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
        <button style={S.btn(true)} onClick={() => disconnect()}>Disconnect and pick another wallet</button>
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

      {!onRobinhood && (
        <div style={{ ...S.warn, borderColor: 'rgba(245,158,11,.5)', background: 'rgba(245,158,11,.12)' }}>
          <div style={{ marginBottom: 10 }}>
            Your wallet is on chain <b>{chainId ?? '?'}</b>. This pad is on <b>Robinhood Chain (4663)</b> — the
            launch won&apos;t sign until you switch. Your wallet may ask to add the network first.
          </div>
          <button style={S.btn(!!wallet)} disabled={!wallet} onClick={() => void switchToRobinhood()}>
            Switch to Robinhood Chain
          </button>
        </div>
      )}

      <div style={S.card}>
        <div style={S.lab}>Pad address</div>
        <input style={S.input} value={padAddr} onChange={(e) => setPadAddr(e.target.value.trim())} placeholder="0x… paste one, or deploy below" />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button style={S.btn(!!wallet && !busy && onRobinhood)} disabled={!wallet || busy || !onRobinhood} onClick={() => void deployPad()}>
            Deploy a pad on {VENUES[cfg.venue].label}
          </button>
          <span style={{ fontSize: 12, opacity: .6 }}>one-off, gas only — reuse it for every launch after</span>
        </div>
        <div style={{ fontSize: 12, opacity: .55, marginTop: 10, lineHeight: 1.5 }}>
          A pad is welded to one venue when it&apos;s built, and the venue is half of what decides whether bots
          come — so the button follows the setup you picked below. You end up owner, and the LP positions come
          to you. Deploying twice on the same venue just wastes gas; keep the address.
        </div>
      </div>

      <div style={S.card}>
        <div style={S.lab}>Setup</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map((p) => (
            <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: 8, borderRadius: 6, background: preset === p.id ? 'rgba(94,197,184,.1)' : 'transparent' }}>
              <input type="radio" name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} style={{ marginTop: 3 }} />
              <span>
                <b>{p.label}</b> · <span style={{ color: '#5EC5B8' }}>{p.hit} draw a bot</span> · <span style={{ opacity: .65 }}>{p.cost}</span>
                <br /><span style={{ fontSize: 12, opacity: .6 }}>
                  {p.note} Needs a pad on {VENUES[p.venue].label} ({VENUES[p.venue].short}), token as {p.wantTokenIsToken0 ? 'token0' : 'token1'}.
                </span>
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
        <button style={S.btn(!!preview && !busy && onRobinhood)} disabled={!preview || busy || !onRobinhood} onClick={() => void launch()}>Launch</button>
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

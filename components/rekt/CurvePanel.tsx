import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useSendTransaction, useWalletClient } from 'wagmi';
import {
  createPublicClient, http, keccak256, encodeAbiParameters, encodeDeployData, concat,
  getCreate2Address, parseEther, formatEther, pad as padHex, type Address,
} from 'viem';
import { robinhood } from '@/lib/wagmi';
import { PAD_TOKEN_BYTECODE } from '@/lib/rekt/abi';
import { REKT_CURVE_ABI } from '@/lib/rekt/curve';
import { VENUES, ROBINHOOD_CHAIN_ID, type VenueId } from '@/lib/rekt/venues';

/**
 * RektCurve — the bonding-curve pad, where the ETH the curve raises IS the ETH the pool opens with.
 *
 * The difference from the one-shot pad, in one line: there, a pool that opens holding 1 ETH costs the
 * launcher 1 ETH. Here the buyers pay it, and at the target every wei of the raise is wrapped and minted
 * as the quote side of the position. The launcher's cost is gas.
 *
 * The numbers below are not free parameters. With virtualToken = 2 x curveSupply the curve raises exactly
 * `target` over the whole supply and closes at 2*target/curveSupply; seeding curveSupply/2 against that
 * raise prices the pool at the same number, so it opens where the last buyer bought instead of gapping and
 * paying the difference to an arbitrageur. The contract CHECKS the split rather than trusting this file.
 */

const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as Address;
const FEE = 10000;

const TOTAL_SUPPLY = 15n * 10n ** 26n;   // 1.5B
const CURVE_SUPPLY = 10n ** 27n;         // 1B sold on the curve
const SEED_TOKENS = CURVE_SUPPLY / 2n;   // 500M — the checked half, and inside the 0.5-5B bot window

const S = {
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
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '4px 0' } as const,
};

const EXPLORER = robinhood.blockExplorers.default.url;

export function CurvePanel({ onRobinhood }: { onRobinhood: boolean }) {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [venueId, setVenueId] = useState<VenueId>('sushi');
  const [curveAddr, setCurveAddr] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('Rekt');
  const [symbol, setSymbol] = useState('REKT');
  const [target, setTarget] = useState('1');
  const [buyAmt, setBuyAmt] = useState('0.05');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ raised: bigint; target: bigint; sold: bigint; graduated: boolean; pool: Address } | null>(null);

  const client = useMemo(() => createPublicClient({ chain: robinhood, transport: http() }), []);
  const venue = VENUES[venueId];
  const curveOk = /^0x[a-fA-F0-9]{40}$/.test(curveAddr);
  const tokenOk = /^0x[a-fA-F0-9]{40}$/.test(token);

  /**
   * Mine the CREATE2 salt for the sort side. Which side the token lands on is half of what decides whether
   * bots show up, so it is mined, not left to chance — and it is mined here in the browser because doing it
   * on chain would mean paying to guess.
   */
  const mineSalt = useCallback((curve: Address, wantToken0: boolean) => {
    const args = encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }],
      [name, symbol, 18, TOTAL_SUPPLY, curve],
    );
    const initHash = keccak256(concat([PAD_TOKEN_BYTECODE as `0x${string}`, args]));
    for (let i = 0; i < 200000; i++) {
      const salt = padHex(`0x${i.toString(16)}` as `0x${string}`, { size: 32 });
      const t = getCreate2Address({ from: curve, salt, bytecodeHash: initHash });
      if ((BigInt(t) < BigInt(WETH)) === wantToken0) return { salt, token: t };
    }
    throw new Error('no salt found');
  }, [name, symbol]);

  const refresh = useCallback(async () => {
    if (!curveOk || !tokenOk) return;
    try {
      const c = await client.readContract({
        address: curveAddr as Address, abi: REKT_CURVE_ABI, functionName: 'curves', args: [token as Address],
      }) as readonly unknown[];
      // curves() returns the struct fields in declaration order.
      setState({
        target: c[2] as bigint,
        sold: c[8] as bigint,
        raised: c[9] as bigint,
        graduated: c[10] as boolean,
        pool: c[11] as Address,
      });
    } catch { /* not created yet */ }
  }, [client, curveAddr, curveOk, token, tokenOk]);

  useEffect(() => { void refresh(); }, [refresh]);

  const deployCurve = useCallback(async () => {
    if (!address) return;
    setBusy(true); setStatus('preparing…');
    try {
      // Its own module, so importing the ABI above does not drag 26 KB of bytecode into the page chunk.
      const { REKT_CURVE_BYTECODE } = await import('@/lib/rekt/curveBytecode');
      const data = encodeDeployData({
        abi: REKT_CURVE_ABI, bytecode: REKT_CURVE_BYTECODE,
        args: [
          address as Address,   // owner
          address as Address,   // LP vault — graduated positions land here
          venue.factory, venue.npm, venue.weth,
          BigInt(ROBINHOOD_CHAIN_ID), venue.initCodeHash, venue.probe,
        ],
      });
      setStatus('confirm the deploy…');
      const hash = await sendTransactionAsync({ chainId: ROBINHOOD_CHAIN_ID, data });
      setStatus('deploying…');
      const r = await client.waitForTransactionReceipt({ hash });
      if (!r.contractAddress) throw new Error('deploy mined without a contract address');
      setCurveAddr(r.contractAddress);
      setStatus(`curve pad deployed on ${venue.label} — now create a token`);
    } catch (e: any) {
      setStatus('deploy failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, client, sendTransactionAsync, venue]);

  const createToken = useCallback(async () => {
    if (!wallet || !address || !curveOk) return;
    setBusy(true); setStatus('mining a salt for the sort side…');
    try {
      const curve = curveAddr as Address;
      // token1 on the sushi venue, token0 on the canonical one — the two measured cells.
      const wantToken0 = venueId === 'canonical';
      const { salt, token: predicted } = mineSalt(curve, wantToken0);
      const p = {
        name, symbol, decimals: 18, totalSupply: TOTAL_SUPPLY,
        tokenSalt: salt, wantTokenIsToken0: wantToken0,
        curveSupply: CURVE_SUPPLY, target: parseEther(target || '1'), fee: FEE,
      };
      setStatus('checking it would go through…');
      await client.simulateContract({
        address: curve, abi: REKT_CURVE_ABI, functionName: 'create', args: [p], account: address as Address,
      });
      setStatus('confirm in your wallet…');
      const hash = await wallet.writeContract({
        address: curve, abi: REKT_CURVE_ABI, functionName: 'create', args: [p],
        chain: robinhood, account: address as Address,
      });
      await client.waitForTransactionReceipt({ hash });
      setToken(predicted);
      setStatus('curve open — anyone can buy now');
    } catch (e: any) {
      setStatus('create failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, client, curveAddr, curveOk, mineSalt, name, symbol, target, venueId, wallet]);

  const buy = useCallback(async () => {
    if (!wallet || !address || !tokenOk) return;
    setBusy(true); setStatus('confirm the buy…');
    try {
      const hash = await wallet.writeContract({
        address: curveAddr as Address, abi: REKT_CURVE_ABI, functionName: 'buy',
        args: [token as Address, 0n, BigInt(Math.floor(Date.now() / 1000) + 1800)],
        value: parseEther(buyAmt || '0'), chain: robinhood, account: address as Address,
      });
      await client.waitForTransactionReceipt({ hash });
      setStatus('bought');
      await refresh();
    } catch (e: any) {
      setStatus('buy failed: ' + String(e?.shortMessage || e?.message || e).slice(0, 180));
    } finally { setBusy(false); }
  }, [address, buyAmt, client, curveAddr, refresh, token, tokenOk, wallet]);

  const pct = state && state.target > 0n ? Number((state.raised * 1000n) / state.target) / 10 : 0;

  return (
    <div>
      <div style={{ ...S.card, borderColor: 'rgba(94,197,184,.4)', background: 'rgba(94,197,184,.07)' }}>
        <b>The raise is the seed.</b> Buyers pay ETH into the curve. At the target, every wei of it is wrapped
        and minted as the ETH side of the pool — not swept, not split, no fee. A pool that opens holding 1 ETH
        costs you gas instead of 1 ETH, and 1.0 ETH seeded is the 92% cell.
        <div style={{ fontSize: 12, opacity: .7, marginTop: 8 }}>
          The pool opens at the price the last curve buyer paid, so there is no gap for an arbitrageur to take
          out of the raise. That is enforced in the contract, not just arranged here.
        </div>
      </div>

      <div style={S.card}>
        <div style={S.lab}>Venue</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(Object.keys(VENUES) as VenueId[]).map((v) => (
            <button key={v} style={{ ...S.btn(true), flex: 1, borderColor: venueId === v ? '#5EC5B8' : 'rgba(255,255,255,.2)' }} onClick={() => setVenueId(v)}>
              {VENUES[v].label} <span style={{ opacity: .55, fontSize: 12 }}>{VENUES[v].short}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, opacity: .6, marginTop: 8 }}>
          Sets the sort side too: token1 on SushiSwap (85% cell), token0 on the canonical fork (51%).
        </div>
      </div>

      <div style={S.card}>
        <div style={S.lab}>Curve pad address</div>
        <input style={S.input} value={curveAddr} onChange={(e) => setCurveAddr(e.target.value.trim())} placeholder="0x… deploy one below" />
        <div style={{ marginTop: 12 }}>
          <button style={S.btn(!!address && !busy && onRobinhood)} disabled={!address || busy || !onRobinhood} onClick={() => void deployCurve()}>
            Deploy a curve pad on {venue.label}
          </button>
          <span style={{ fontSize: 12, opacity: .6, marginLeft: 10 }}>one-off — reuse for every token after</span>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><div style={S.lab}>Name</div><input style={S.input} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div style={{ flex: 1 }}><div style={S.lab}>Symbol</div><input style={S.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
          <div style={{ flex: 1 }}><div style={S.lab}>Target (ETH)</div><input style={S.input} value={target} onChange={(e) => setTarget(e.target.value.trim())} /></div>
        </div>
        <div style={{ ...S.row, marginTop: 12, opacity: .7 }}><span>Sold on the curve</span><span style={S.mono}>1,000,000,000 {symbol}</span></div>
        <div style={{ ...S.row, opacity: .7 }}><span>Seeded into the pool at graduation</span><span style={S.mono}>500,000,000 {symbol} + {target || '1'} ETH</span></div>
        <div style={{ ...S.row, opacity: .7 }}><span>Your cost</span><span style={S.mono}>gas</span></div>
        <div style={{ marginTop: 12 }}>
          <button style={S.btn(curveOk && !busy && onRobinhood)} disabled={!curveOk || busy || !onRobinhood} onClick={() => void createToken()}>
            Create the token and open the curve
          </button>
        </div>
      </div>

      {tokenOk && (
        <div style={S.card}>
          <div style={S.lab}>Token</div>
          <a href={`${EXPLORER}/address/${token}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc' }}>{token}</a>
          {state && (
            <>
              <div style={{ height: 8, background: 'rgba(255,255,255,.1)', borderRadius: 4, margin: '12px 0 6px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#5EC5B8' }} />
              </div>
              <div style={S.row}>
                <span style={{ opacity: .6 }}>{state.graduated ? 'Graduated' : 'Raised'}</span>
                <span style={S.mono}>{formatEther(state.raised)} / {formatEther(state.target)} ETH ({pct.toFixed(1)}%)</span>
              </div>
              {state.graduated && state.pool !== '0x0000000000000000000000000000000000000000' && (
                <div style={{ marginTop: 8 }}>
                  <a href={`${EXPLORER}/address/${state.pool}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc', fontSize: 12 }}>
                    pool — the raise is in here now
                  </a>
                </div>
              )}
            </>
          )}
          {!state?.graduated && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <input style={{ ...S.input, width: 120 }} value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.trim())} />
              <button style={S.btn(!busy && onRobinhood)} disabled={busy || !onRobinhood} onClick={() => void buy()}>Buy ETH worth</button>
              <button style={S.btn(!busy)} disabled={busy} onClick={() => void refresh()}>Refresh</button>
            </div>
          )}
          <div style={{ fontSize: 12, opacity: .55, marginTop: 10 }}>
            Your buy is a normal curve buy — it does not change whether bots come (45% with, 44% without), it
            decides whether you are in front of them. Graduation fires automatically on the buy that completes
            the raise.
          </div>
        </div>
      )}

      {status && <div style={{ fontSize: 13, opacity: .85, marginTop: 8 }}>{status}</div>}
    </div>
  );
}

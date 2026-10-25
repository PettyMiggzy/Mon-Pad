import {
  decodeEventLog, encodeAbiParameters, formatEther, keccak256, maxUint256, toHex, zeroAddress,
  type Address, type Hex,
} from 'viem';
import { erc20Abi, launcherAbi, routerAbi, stateViewAbi } from './abis.js';
import { MAINNET, MON_USDC_POOL, MONPAD_POOL, TOKEN_SUPPLY } from './chain-config.js';
import { resolveAddresses, type MonpadCreateOptions, type ResolvedAddresses } from './config.js';
import { MonpadError, NotAMonpadToken, Paused, SlippageExceeded, WalletRequired, DeadlineExpired } from './errors.js';

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export type Token = {
  token: Address;
  name: string;
  symbol: string;
  creator: Address;
  creatorTaxBps: number;
  /** 1% base fee plus the creator tax, in basis points. */
  totalFeeBps: number;
  poolId: Hex;
  poolKey: PoolKey;
  priceUsd: number;
  marketCapUsd: number;
  liquidity: bigint;
};

export type TradeResult = { hash?: Hex; amountOut: bigint; minOut: bigint; simulated: boolean };
export type LaunchResult = { hash?: Hex; token?: Address; simulated: boolean; minUsdc: bigint };

const BASE_FEE_BPS = 100;
const SIM_FROM: Address = MAINNET.dead as Address;
const bps = (n: bigint, slip: number) => (n * BigInt(10_000 - slip)) / 10_000n;

const mapSlot = (owner: Address, slot: bigint): Hex => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner, slot]));
const allowSlot = (owner: Address, spender: Address, slot: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender, mapSlot(owner, slot)]));
const word = (n: bigint): Hex => toHex(n, { size: 32 });

export function createMonpad(opts: MonpadCreateOptions) {
  // viem's strict generics don't help with a dynamic ABI/override layer, so the clients are loosely typed inside
  const pc: any = opts.publicClient;
  const wallet: any = opts.walletClient;
  const a: ResolvedAddresses = resolveAddresses(opts.addresses);
  const me = (): Address | undefined => (wallet?.account as any)?.address;
  const needWallet = () => { if (!wallet || !wallet.account) throw new WalletRequired(); return wallet; };
  const deadline = (sec = 600) => BigInt(Math.floor(Date.now() / 1000) + sec);

  const quoteIs0 = (token: Address) => BigInt(a.usdc) < BigInt(token);
  const poolKeyFor = (token: Address): PoolKey => {
    const q0 = quoteIs0(token);
    return { currency0: q0 ? a.usdc : token, currency1: q0 ? token : a.usdc, fee: MONPAD_POOL.fee, tickSpacing: MONPAD_POOL.tickSpacing, hooks: a.hook };
  };
  const poolIdOf = (k: PoolKey): Hex => keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

  /** Whole USDC per whole token, from the pool's sqrt price (USDC has 6 decimals, tokens 18). */
  const usdcPerToken = (sqrt: bigint, q0: boolean) => {
    const raw = Number(sqrt * sqrt) / Number(2n ** 192n);
    if (!(raw > 0) || !Number.isFinite(raw)) return 0;
    return q0 ? 1e12 / raw : raw * 1e12;
  };

  /** USDC base units per wei of MON, from the MON/USDC pool the router converts through. */
  async function monUsdcRaw(): Promise<number> {
    const id = poolIdOf({ currency0: zeroAddress, currency1: a.usdc, fee: MON_USDC_POOL.fee, tickSpacing: MON_USDC_POOL.tickSpacing, hooks: zeroAddress });
    const s0 = (await pc.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [id] })) as any;
    const sqrt = s0[0] as bigint;
    return Number(sqrt * sqrt) / Number(2n ** 192n);
  }
  const monPriceUsd = async () => (await monUsdcRaw()) * 1e12;

  async function getToken(token: Address): Promise<Token> {
    const [creator, taxBps, , poolId] = (await pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'launches', args: [token] })) as [Address, number, bigint, Hex];
    if (creator === zeroAddress) throw new NotAMonpadToken(token);
    const [name, symbol, slot0, liquidity] = await Promise.all([
      pc.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => '?'),
      pc.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
      pc.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
      pc.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
    ]);
    const price = usdcPerToken((slot0 as any)[0] as bigint, quoteIs0(token));
    return {
      token, name: name as string, symbol: symbol as string, creator, creatorTaxBps: Number(taxBps), totalFeeBps: BASE_FEE_BPS + Number(taxBps),
      poolId, poolKey: poolKeyFor(token), priceUsd: price, marketCapUsd: price * TOKEN_SUPPLY, liquidity: liquidity as bigint,
    };
  }

  /** Newest first. */
  async function listLaunches({ limit = 10 }: { limit?: number } = {}) {
    const count = Number(await pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'tokenCount' }));
    const idx = Array.from({ length: Math.min(count, limit) }, (_, i) => count - 1 - i);
    const tokens = (await Promise.all(idx.map((i) => pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'allTokens', args: [BigInt(i)] })))) as Address[];
    const launches = (await Promise.all(tokens.map((t) => getToken(t).catch(() => null)))).filter((x): x is Token => !!x);
    return { count, launches };
  }

  // ── quotes: simulate the router with storage overrides so no balance or approval is needed ──
  const usdcOverride = (owner: Address, spender: Address, amt: bigint) => ({
    address: a.usdc, stateDiff: [{ slot: mapSlot(owner, 9n), value: word(amt) }, { slot: allowSlot(owner, spender, 10n), value: word(amt) }],
  });
  const tokenOverride = (token: Address, owner: Address, spender: Address, balance?: bigint) => ({
    address: token, stateDiff: [{ slot: allowSlot(owner, spender, 1n), value: word(maxUint256) }, ...(balance !== undefined ? [{ slot: mapSlot(owner, 0n), value: word(balance) }] : [])],
  });

  async function quoteBuy({ token, monIn, usdcIn }: { token: Address; monIn?: bigint; usdcIn?: bigint }): Promise<{ tokensOut: bigint }> {
    const account = me() ?? SIM_FROM;
    const key = poolKeyFor(token);
    if (monIn && monIn > 0n) {
      const { result } = await pc.simulateContract({ address: a.router, abi: routerAbi, functionName: 'buyWithMon', args: [key, 0n, 0n, deadline(), 0n, 0n], account, value: monIn, stateOverride: [{ address: account, balance: monIn + 10n ** 18n }] });
      return { tokensOut: result as bigint };
    }
    if (usdcIn && usdcIn > 0n) {
      const { result } = await pc.simulateContract({ address: a.router, abi: routerAbi, functionName: 'buyWithUsdc', args: [key, usdcIn, 0n, deadline(), 0n], account, stateOverride: [usdcOverride(account, a.router, usdcIn)] });
      return { tokensOut: result as bigint };
    }
    throw new MonpadError('pass monIn or usdcIn');
  }

  async function quoteSell({ token, tokensIn, receive = 'mon' }: { token: Address; tokensIn: bigint; receive?: 'mon' | 'usdc' }): Promise<{ amountOut: bigint }> {
    const account = me() ?? SIM_FROM;
    const key = poolKeyFor(token);
    const stateOverride = [tokenOverride(token, account, a.router, me() ? undefined : tokensIn)];
    if (receive === 'mon') {
      const { result } = await pc.simulateContract({ address: a.router, abi: routerAbi, functionName: 'sellToMon', args: [key, tokensIn, 0n, 0n, deadline(), 0n, 0n], account, stateOverride });
      return { amountOut: result as bigint };
    }
    const { result } = await pc.simulateContract({ address: a.router, abi: routerAbi, functionName: 'sellToUsdc', args: [key, tokensIn, 0n, deadline(), 0n], account, stateOverride });
    return { amountOut: result as bigint };
  }

  function friendly(e: any): never {
    const m = String(e?.shortMessage || e?.message || e);
    if (/slippage|too little|Slippage/i.test(m)) throw new SlippageExceeded();
    if (/Expired/i.test(m)) throw new DeadlineExpired();
    if (/launches paused/i.test(m)) throw new Paused();
    throw e instanceof MonpadError ? e : new MonpadError(m.slice(0, 300));
  }

  async function ensureAllowance(asset: Address, spender: Address, need: bigint) {
    const w = needWallet();
    const have = (await pc.readContract({ address: asset, abi: erc20Abi, functionName: 'allowance', args: [me()!, spender] })) as bigint;
    if (have >= need) return;
    const h = await w.writeContract({ address: asset, abi: erc20Abi, functionName: 'approve', args: [spender, need], account: w.account!, chain: w.chain } as any);
    await pc.waitForTransactionReceipt({ hash: h });
  }

  async function send(req: Record<string, any>, simulate: boolean): Promise<Hex | undefined> {
    const w = needWallet();
    if (simulate) { await pc.simulateContract({ ...req, account: w.account }); return undefined; }
    const { request } = await pc.simulateContract({ ...req, account: w.account });
    const hash = await w.writeContract(request);
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new MonpadError(`transaction reverted (${hash})`);
    return hash;
  }

  /** Buy with MON (monIn) or USDC (usdcIn). The minimum out is set from a live quote and `slippageBps` unless you pass minTokensOut. */
  async function buy(p: { token: Address; monIn?: bigint; usdcIn?: bigint; slippageBps?: number; minTokensOut?: bigint; deadlineSec?: number; simulate?: boolean }): Promise<TradeResult> {
    needWallet();
    const { tokensOut } = await quoteBuy(p);
    const minOut = p.minTokensOut ?? bps(tokensOut, p.slippageBps ?? 100);
    const key = poolKeyFor(p.token);
    try {
      if (p.monIn && p.monIn > 0n) {
        const hash = await send({ address: a.router, abi: routerAbi, functionName: 'buyWithMon', args: [key, minOut, 0n, deadline(p.deadlineSec), 0n, 0n], value: p.monIn }, !!p.simulate);
        return { hash, amountOut: tokensOut, minOut, simulated: !!p.simulate };
      }
      if (!p.simulate) await ensureAllowance(a.usdc, a.router, p.usdcIn!);
      const hash = await send({ address: a.router, abi: routerAbi, functionName: 'buyWithUsdc', args: [key, p.usdcIn!, minOut, deadline(p.deadlineSec), 0n] }, !!p.simulate);
      return { hash, amountOut: tokensOut, minOut, simulated: !!p.simulate };
    } catch (e) { return friendly(e); }
  }

  /** Sell for MON (default) or USDC. Handles the token approval. */
  async function sell(p: { token: Address; tokensIn: bigint; receive?: 'mon' | 'usdc'; slippageBps?: number; minOut?: bigint; deadlineSec?: number; simulate?: boolean }): Promise<TradeResult> {
    needWallet();
    const receive = p.receive ?? 'mon';
    const { amountOut } = await quoteSell({ token: p.token, tokensIn: p.tokensIn, receive });
    const minOut = p.minOut ?? bps(amountOut, p.slippageBps ?? 100);
    const key = poolKeyFor(p.token);
    try {
      if (!p.simulate) await ensureAllowance(p.token, a.router, p.tokensIn);
      const req = receive === 'mon'
        ? { address: a.router, abi: routerAbi, functionName: 'sellToMon', args: [key, p.tokensIn, minOut, 0n, deadline(p.deadlineSec), 0n, 0n] }
        : { address: a.router, abi: routerAbi, functionName: 'sellToUsdc', args: [key, p.tokensIn, minOut, deadline(p.deadlineSec), 0n] };
      if (p.simulate) {
        // an approval may not exist yet: simulate with the approval overridden so the dry run still works
        const account = me() ?? SIM_FROM;
        await pc.simulateContract({ ...req, account, stateOverride: [tokenOverride(p.token, account, a.router)] });
        return { amountOut, minOut, simulated: true };
      }
      const hash = await send(req, false);
      return { hash, amountOut, minOut, simulated: false };
    } catch (e) { return friendly(e); }
  }

  /** Launch a coin. Pay a dev buy in MON (devBuyMon) or USDC (devBuyUsdc). Creator tax is 0 to 500 bps. There is no creation fee. */
  async function launch(p: { name: string; symbol: string; creatorTaxBps?: number; devBuyMon?: bigint; devBuyUsdc?: bigint; salt?: Hex; slippageBps?: number; simulate?: boolean }): Promise<LaunchResult> {
    needWallet();
    const tax = p.creatorTaxBps ?? 0;
    if (!Number.isInteger(tax) || tax < 0 || tax > 500) throw new MonpadError('creatorTaxBps must be 0 to 500');
    const paused = (await pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'launchPaused' })) as boolean;
    if (paused) throw new Paused();
    const salt: Hex = p.salt ?? (`0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex);
    let hash: Hex | undefined;
    let minUsdc = 0n;
    try {
      if (p.devBuyUsdc && p.devBuyUsdc > 0n) {
        const fee = (await pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'creationFee' })) as bigint;
        if (!p.simulate) await ensureAllowance(a.usdc, a.launcher, fee + p.devBuyUsdc);
        hash = await send({ address: a.launcher, abi: launcherAbi, functionName: 'launch', args: [p.name, p.symbol, salt, tax, p.devBuyUsdc] }, !!p.simulate);
      } else {
        const value = p.devBuyMon ?? 0n;
        // the launcher swaps MON to USDC first; refuse if that conversion lands more than slippage below the pool price
        if (value > 0n) minUsdc = bps(BigInt(Math.floor((await monUsdcRaw()) * Number(value))), p.slippageBps ?? 300);
        hash = await send({ address: a.launcher, abi: launcherAbi, functionName: 'launchWithMon', args: [p.name, p.symbol, salt, tax, minUsdc], value }, !!p.simulate);
      }
      let token: Address | undefined;
      if (hash) {
        const receipt = await pc.getTransactionReceipt({ hash });
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== a.launcher.toLowerCase()) continue;
          try { const ev = decodeEventLog({ abi: launcherAbi, data: log.data, topics: (log as any).topics }) as any; if (ev.eventName === 'Launched') { token = ev.args.token; break; } } catch { /* other event */ }
        }
      }
      return { hash, token, simulated: !!p.simulate, minUsdc };
    } catch (e) { return friendly(e); }
  }

  const claimable = async (account: Address, asset: Address) => (await pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'claimable', args: [account, asset] })) as bigint;
  /** Claim creator earnings in one asset (USDC or a coin you launched). */
  async function claim(asset: Address, simulate = false) {
    try { return { hash: await send({ address: a.launcher, abi: launcherAbi, functionName: 'claim', args: [asset] }, simulate), simulated: simulate }; } catch (e) { return friendly(e); }
  }
  /** Split the fees a pool has earned. Anyone can call this. */
  async function harvest(token: Address, simulate = false) {
    try { return { hash: await send({ address: a.launcher, abi: launcherAbi, functionName: 'harvest', args: [token] }, simulate), simulated: simulate }; } catch (e) { return friendly(e); }
  }

  async function getMonshiBurned() {
    const [burned, totalSupply] = await Promise.all([
      pc.readContract({ address: a.monshi, abi: erc20Abi, functionName: 'balanceOf', args: [MAINNET.dead] }) as Promise<bigint>,
      pc.readContract({ address: a.monshi, abi: erc20Abi, functionName: 'totalSupply' }) as Promise<bigint>,
    ]);
    return { burned, totalSupply, circulating: totalSupply - burned };
  }

  async function getSpec() {
    const [creationFee, paused] = await Promise.all([
      pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'creationFee' }) as Promise<bigint>,
      pc.readContract({ address: a.launcher, abi: launcherAbi, functionName: 'launchPaused' }) as Promise<boolean>,
    ]);
    return {
      chainId: MAINNET.chainId,
      contracts: a,
      pools: 'Uniswap V4, quoted in USDC. Pay and receive MON through the router.',
      supply: TOKEN_SUPPLY,
      baseFeeBps: BASE_FEE_BPS,
      maxCreatorTaxBps: 500,
      creationFeeUsdc: formatEther(creationFee * 10n ** 12n),
      launchPaused: paused,
      feeSplitOfBase: { creator: '70%', platform: '10%', burnMonshi: '10%', burnToken: '10%' },
    };
  }

  return { addresses: a, poolKeyFor, poolIdOf, getToken, listLaunches, quoteBuy, quoteSell, buy, sell, launch, claimable, claim, harvest, getMonshiBurned, getSpec, monPriceUsd };
}

export type MonpadClient = ReturnType<typeof createMonpad>;

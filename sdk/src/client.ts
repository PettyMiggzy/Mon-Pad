import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  parseAbiItem,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';

function randomSalt(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}` as Hex;
}
import { launcherAbi, hookAbi, stateViewAbi, routerAbi, erc20Abi, fiatTokenAbi } from './abis.js';
import {
  type MonpadCreateOptions,
  type RemoteSpec,
  type ResolvedAddresses,
  requireLauncher,
  requireRouter,
  resolveAddresses,
} from './config.js';
import {
  ContractsNotDeployed,
  InsufficientQuoteBalance,
  MaxMonExceeded,
  MaxUsdcExceeded,
  MonpadError,
  Paused,
  PoolNotFound,
  QuoteAssetBlocked,
  SlippageExceeded,
  WalletRequired,
} from './errors.js';
import {
  erc20AllowanceStateOverride,
  poolKeyForToken,
  poolIdFromKey,
  quoteAmountOfSwap,
  quoteIsCurrency0,
  usdcPerTokenFromSqrt,
  usdcStateOverride,
} from './pool.js';

const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
);

const BASE_FEE_BPS = 100;
const VOLUME_BLOCKS = Number(process.env.MONPAD_VOLUME_BLOCKS || '5000');
const QUOTE_DECIMALS = 6;

export type MonpadClient = ReturnType<typeof createMonpad>;

export function createMonpad(options: MonpadCreateOptions = {}) {
  const rpcUrl = options.rpcUrl || process.env.RPC_URL || process.env.MONAD_RPC || 'https://rpc.monad.xyz';
  const chain: Chain =
    (options.chain as Chain | undefined) ??
    ({
      id: Number(process.env.MONPAD_CHAIN_ID || 143),
      name: 'Monad',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as Chain);

  let publicClient: PublicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  let walletClient = options.walletClient;
  let addrs: ResolvedAddresses | null = null;
  let remoteSpec: RemoteSpec | null = null;
  let quoteCache: Address | null = null;
  const maxMonPerTx = options.maxMonPerTx ?? parseEther(process.env.MAX_MON_PER_TX || '5');
  const maxUsdcPerTx = options.maxUsdcPerTx ?? parseUnits(process.env.MAX_USDC_PER_TX || '25', QUOTE_DECIMALS);

  async function ensureAddrs() {
    if (!addrs) addrs = await resolveAddresses(options);
    return addrs;
  }

  /** USDC address: explicit config first, otherwise the launcher's immutable `quoteAsset`. */
  async function quoteAsset(): Promise<Address> {
    if (quoteCache) return quoteCache;
    const a = await ensureAddrs();
    if (a.quoteAsset) return (quoteCache = a.quoteAsset);
    const { launcher } = requireLauncher(a);
    quoteCache = (await publicClient.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: 'quoteAsset',
    })) as Address;
    return quoteCache;
  }

  function assertMaxMon(amount: bigint) {
    if (amount > maxMonPerTx) {
      throw new MaxMonExceeded(
        `${formatEther(amount)} MON exceeds maxMonPerTx (${formatEther(maxMonPerTx)} MON)`,
      );
    }
  }

  function assertMaxUsdc(amount: bigint) {
    if (amount > maxUsdcPerTx) {
      throw new MaxUsdcExceeded(
        `${formatUnits(amount, QUOTE_DECIMALS)} USDC exceeds maxUsdcPerTx (${formatUnits(maxUsdcPerTx, QUOTE_DECIMALS)} USDC)`,
      );
    }
  }

  function deadlineSeconds(offsetSec = 300) {
    return BigInt(Math.floor(Date.now() / 1000) + offsetSec);
  }

  function minOut(amount: bigint, slippageBps: number) {
    return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
  }

  function simulateAccount(): Address {
    return ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
  }

  function requireWallet(): WalletClient {
    if (!walletClient?.account) throw new WalletRequired();
    return walletClient;
  }

  function accountAddress(account: NonNullable<WalletClient['account']> | Address): Address {
    return typeof account === 'string' ? account : account.address;
  }

  async function poolKey(token: Address) {
    const a = await ensureAddrs();
    const { hook } = requireLauncher(a);
    return poolKeyForToken(token, hook, await quoteAsset());
  }

  async function assertKnownToken(token: Address) {
    const a = await ensureAddrs();
    const { launcher } = requireLauncher(a);
    const [creator] = await publicClient.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: 'launches',
      args: [token],
    });
    if (creator === zeroAddress) throw new PoolNotFound(token);
  }

  /** USDC reverts every transfer while paused or when a party is blacklisted; surface that as one clear error. */
  function rethrowQuoteBlocked(e: unknown): never {
    const parts: string[] = [];
    for (let cur = e as { message?: string; shortMessage?: string; details?: string; cause?: unknown } | undefined, i = 0; cur && i < 8; i++) {
      parts.push(cur.shortMessage ?? '', cur.details ?? '', cur.message ?? '');
      cur = cur.cause as typeof cur;
    }
    if (/blacklist|paused|Pausable/i.test(parts.join(' '))) throw new QuoteAssetBlocked();
    throw e;
  }

  /** Run a simulation or send and translate USDC pause/blacklist reverts into `QuoteAssetBlocked`. */
  async function guardQuote<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      return rethrowQuoteBlocked(e);
    }
  }

  /**
   * USDC (a Circle FiatToken) can be paused and can blacklist any address. Dry runs cannot see that: the simulated
   * balance override overwrites the slot that also stores the blacklist flag. So check it explicitly. Skipped when the
   * quote asset has no such functions (a plain ERC-20 in tests).
   */
  async function quoteHealthOf(parties: Record<string, Address>) {
    const usdc = await quoteAsset();
    try {
      const paused = await publicClient.readContract({ address: usdc, abi: fiatTokenAbi, functionName: 'paused' });
      const blacklisted: Record<string, boolean> = {};
      for (const [label, who] of Object.entries(parties)) {
        blacklisted[label] = await publicClient.readContract({
          address: usdc,
          abi: fiatTokenAbi,
          functionName: 'isBlacklisted',
          args: [who],
        });
      }
      return { usdc, paused, blacklisted, checked: true as const };
    } catch {
      return { usdc, paused: false, blacklisted: {} as Record<string, boolean>, checked: false as const };
    }
  }

  async function assertQuoteUsable(parties: Record<string, Address>) {
    const h = await quoteHealthOf(parties);
    if (h.paused) throw new QuoteAssetBlocked('USDC is paused: every Monpad trade and launch will revert until it is unpaused');
    for (const [label, bad] of Object.entries(h.blacklisted)) {
      if (bad) throw new QuoteAssetBlocked(`USDC has blacklisted the ${label} address (${parties[label]})`);
    }
  }

  /** Approve `spender` for USDC when the current allowance is short. */
  async function ensureQuoteAllowance(w: WalletClient, spender: Address, amount: bigint) {
    const usdc = await quoteAsset();
    const owner = w.account!.address;
    const have = (await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })) as bigint;
    if (have < amount) throw new InsufficientQuoteBalance(formatUnits(amount, QUOTE_DECIMALS), formatUnits(have, QUOTE_DECIMALS));
    const allowance = await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    });
    if (allowance >= amount) return;
    try {
      const hash = await w.writeContract({
        address: usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
        account: w.account!,
        chain,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      rethrowQuoteBlocked(e);
    }
  }

  async function volumeUsdc(poolId: Hex, quoteIs0: boolean, fromBlock: bigint, toBlock: bigint) {
    const a = await ensureAddrs();
    let vol = 0n;
    if (!a.poolManager) return vol;
    try {
      const logs = await publicClient.getLogs({
        address: a.poolManager,
        event: swapEvent,
        args: { id: poolId },
        fromBlock,
        toBlock,
      });
      for (const log of logs) vol += quoteAmountOfSwap(log.args.amount0 ?? 0n, log.args.amount1 ?? 0n, quoteIs0);
    } catch {
      /* log range limits on some RPCs: volume is approximate */
    }
    return vol;
  }

  return {
    get publicClient() {
      return publicClient;
    },
    setPublicClient(client: PublicClient) {
      publicClient = client;
    },
    get walletClient() {
      return walletClient;
    },
    setWalletClient(w: WalletClient | undefined) {
      walletClient = w;
    },
    /** The quote asset (USDC) every Monpad pool is paired with. */
    quoteAsset,
    /**
     * Is USDC usable right now? Reports `paused` and whether the launcher, router and PoolManager are blacklisted.
     * Any of those freezes launches, trades and (for the launcher) fee harvests and claims.
     */
    async quoteHealth() {
      const a = await ensureAddrs();
      const parties: Record<string, Address> = {};
      if (a.launcher) parties.launcher = a.launcher;
      if (a.v4Router) parties.router = a.v4Router;
      if (a.poolManager) parties.poolManager = a.poolManager;
      const h = await quoteHealthOf(parties);
      return { ...h, ok: h.checked && !h.paused && !Object.values(h.blacklisted).some(Boolean) };
    },

    async getSpec() {
      const a = await ensureAddrs();
      const fetchFn = options.fetch ?? globalThis.fetch;
      const specUrl =
        options.specUrl ??
        process.env.MONPAD_SPEC_URL ??
        (process.env.MONPAD_SITE ? `${process.env.MONPAD_SITE.replace(/\/$/, '')}/api/v1/spec` : '');
      if (specUrl && fetchFn) {
        try {
          const res = await fetchFn(specUrl);
          if (res.ok) remoteSpec = (await res.json()) as RemoteSpec;
        } catch {
          /* */
        }
      }
      let platform = a.platform;
      let hook = a.hook;
      if (a.launcher) {
        try {
          platform =
            platform ||
            ((await publicClient.readContract({
              address: a.launcher,
              abi: launcherAbi,
              functionName: 'platform',
            })) as Address);
          hook =
            hook ||
            ((await publicClient.readContract({
              address: a.launcher,
              abi: launcherAbi,
              functionName: 'hook',
            })) as Address);
        } catch {
          /* */
        }
      }
      return {
        chainId: chain.id,
        remote: remoteSpec,
        contracts: { ...a, platform, hook, quoteAsset: await quoteAsset().catch(() => '' as const) },
        feePolicy: {
          baseSwapFeeBps: BASE_FEE_BPS,
          maxCreatorTaxBps: 500,
          fromApi: remoteSpec?.fees ?? null,
        },
        maxMonPerTx: maxMonPerTx.toString(),
        maxUsdcPerTx: maxUsdcPerTx.toString(),
      };
    },

    async getMonshiBurned() {
      const a = await ensureAddrs();
      if (!a.monshi || !a.dead) throw new ContractsNotDeployed('monshi/dead not in spec');
      const [burned, totalSupply] = await Promise.all([
        publicClient.readContract({ address: a.monshi, abi: erc20Abi, functionName: 'balanceOf', args: [a.dead] }),
        publicClient.readContract({ address: a.monshi, abi: erc20Abi, functionName: 'totalSupply' }),
      ]);
      return { burned, totalSupply, circulating: totalSupply > burned ? totalSupply - burned : 0n };
    },

    async listLaunches({ limit = 10, cursor }: { limit?: number; cursor?: number } = {}) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const n = Number(await publicClient.readContract({ address: launcher, abi: launcherAbi, functionName: 'tokenCount' }));
      const end = cursor != null ? cursor - 1 : n - 1;
      const start = Math.max(0, end - limit + 1);
      const launches = [];
      for (let i = end; i >= start && i >= 0; i--) {
        const token = await publicClient.readContract({
          address: launcher,
          abi: launcherAbi,
          functionName: 'allTokens',
          args: [BigInt(i)],
        });
        const [creator, taxBps, , poolId] = await publicClient.readContract({
          address: launcher,
          abi: launcherAbi,
          functionName: 'launches',
          args: [token],
        });
        let name = '?';
        let symbol = '?';
        try {
          name = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' });
          symbol = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
        } catch {
          /* */
        }
        launches.push({ index: i, token, creator, creatorTaxBps: taxBps, poolId, name, symbol });
      }
      const nextCursor = start > 0 ? start : null;
      return { count: n, launches, nextCursor };
    },

    async getToken(token: Address) {
      await assertKnownToken(token);
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const [, taxBps, , poolId] = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'launches',
        args: [token],
      });
      const quote = await quoteAsset();
      const key = await poolKey(token);
      const quoteIs0 = quoteIsCurrency0(quote, token);
      if (!a.stateView) throw new ContractsNotDeployed('stateView not configured');
      const [slot0, liquidity, reserve] = await Promise.all([
        publicClient.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
        publicClient.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
        publicClient.readContract({ address: launcher, abi: launcherAbi, functionName: 'tokenReserve', args: [token] }),
      ]);
      const block = await publicClient.getBlockNumber();
      const fromBlock = block > BigInt(VOLUME_BLOCKS) ? block - BigInt(VOLUME_BLOCKS) : 0n;
      const volume = await volumeUsdc(poolId, quoteIs0, fromBlock, block);
      return {
        token,
        quoteAsset: quote,
        creatorTaxBps: taxBps,
        totalSwapFeeBps: BASE_FEE_BPS + Number(taxBps),
        poolId,
        poolKey: key,
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        approxUsdcPerToken: usdcPerTokenFromSqrt(slot0[0], quoteIs0),
        liquidity,
        volumeUsdcApprox: volume,
        buybackReserveUsdc: reserve,
      };
    },

    async trending({ limit = 10, windowBlocks = VOLUME_BLOCKS } = {}) {
      const { launches, count } = await this.listLaunches({ limit: Math.min(limit, 50) });
      const quote = await quoteAsset();
      const block = await publicClient.getBlockNumber();
      const fromBlock = block > BigInt(windowBlocks) ? block - BigInt(windowBlocks) : 0n;
      const scored = [];
      for (const L of launches) {
        const volume = await volumeUsdc(L.poolId, quoteIsCurrency0(quote, L.token), fromBlock, block);
        scored.push({ ...L, volumeUsdc: volume });
      }
      scored.sort((x, y) => (y.volumeUsdc > x.volumeUsdc ? 1 : -1));
      return { count, trending: scored.slice(0, limit) };
    },

    /** USDC and launch-token fees waiting for `account` in the launcher (call `harvest` first to refresh). */
    async creatorEarnings(account: Address) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const usdc = await quoteAsset();
      const n = Number(await publicClient.readContract({ address: launcher, abi: launcherAbi, functionName: 'tokenCount' }));
      const perToken: { token: Address; claimableToken: bigint }[] = [];
      for (let i = 0; i < n; i++) {
        const token = await publicClient.readContract({
          address: launcher,
          abi: launcherAbi,
          functionName: 'allTokens',
          args: [BigInt(i)],
        });
        const cTok = await publicClient.readContract({
          address: launcher,
          abi: launcherAbi,
          functionName: 'claimable',
          args: [account, token],
        });
        if (cTok > 0n) perToken.push({ token, claimableToken: cTok });
      }
      const claimableUsdc = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'claimable',
        args: [account, usdc],
      });
      return { claimableUsdc, perToken };
    },

    // ── quotes ──────────────────────────────────────────────────────────────────

    /** Quote a USDC → token buy by simulating the router. `usdcIn` is in USDC base units (6 decimals). */
    async quoteBuy(token: Address, usdcIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const usdc = await quoteAsset();
      const account = walletClient?.account ?? simulateAccount();
      await assertQuoteUsable({ sender: accountAddress(account), router, poolManager: (await ensureAddrs()).poolManager });
      const { result: tokensOut } = await guardQuote(() =>
        publicClient.simulateContract({
          address: router,
          abi: routerAbi,
          functionName: 'buyWithUsdc',
          args: [key, usdcIn, 0n, deadlineSeconds(300), 0n],
          account,
          stateOverride: [usdcStateOverride(usdc, accountAddress(account), router, usdcIn)],
        }),
      );
      const before = await this.getToken(token);
      const priceImpact =
        before.approxUsdcPerToken != null && tokensOut > 0n
          ? Number(formatUnits(usdcIn, QUOTE_DECIMALS)) / Number(formatEther(tokensOut)) / before.approxUsdcPerToken - 1
          : null;
      return { tokensOut, minOut: minOut(tokensOut, slippageBps), priceImpact, slippageBps };
    },

    /** Quote a MON → USDC → token buy (two hops: the hookless MON/USDC pool, then the launch pool). */
    async quoteBuyWithMon(token: Address, monIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const account = walletClient?.account ?? simulateAccount();
      const { result: tokensOut } = await publicClient.simulateContract({
        address: router,
        abi: routerAbi,
        functionName: 'buyWithMon',
        args: [key, 0n, 0n, deadlineSeconds(300), 0n, 0n],
        value: monIn,
        account,
      });
      return { tokensOut, minOut: minOut(tokensOut, slippageBps), slippageBps };
    },

    /** Quote a token → USDC sell. */
    async quoteSell(token: Address, tokensIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const account = walletClient?.account ?? simulateAccount();
      const { result: usdcOut } = await publicClient.simulateContract({
        address: router,
        abi: routerAbi,
        functionName: 'sellToUsdc',
        args: [key, tokensIn, 0n, deadlineSeconds(300), 0n],
        account,
        stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)],
      });
      return { usdcOut, minOut: minOut(usdcOut, slippageBps), priceImpact: null, slippageBps };
    },

    /** Quote a token → USDC → MON sell. */
    async quoteSellForMon(token: Address, tokensIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const account = walletClient?.account ?? simulateAccount();
      const { result: monOut } = await publicClient.simulateContract({
        address: router,
        abi: routerAbi,
        functionName: 'sellToMon',
        args: [key, tokensIn, 0n, 0n, deadlineSeconds(300), 0n, 0n],
        account,
        stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)],
      });
      return { monOut, minOut: minOut(monOut, slippageBps), slippageBps };
    },

    // ── trades ──────────────────────────────────────────────────────────────────

    /** Buy with USDC. Approves the router for exactly `usdcIn` when sending. Simulates by default. */
    async buy(
      token: Address,
      usdcIn: bigint,
      opts: {
        slippageBps?: number;
        deadline?: number;
        simulate?: boolean;
        maxUsdcPerTx?: bigint;
        minTokensOut?: bigint;
      } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      if (usdcIn <= 0n) throw new MonpadError('usdcIn must be greater than zero');
      const cap = opts.maxUsdcPerTx ?? maxUsdcPerTx;
      if (usdcIn > cap) {
        throw new MaxUsdcExceeded(
          `${formatUnits(usdcIn, QUOTE_DECIMALS)} USDC exceeds maxUsdcPerTx (${formatUnits(cap, QUOTE_DECIMALS)} USDC)`,
        );
      }
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const usdc = await quoteAsset();

      const quote = await this.quoteBuy(token, usdcIn, slippageBps);
      const minTokensOut = opts.minTokensOut ?? minOut(quote.tokensOut, slippageBps);
      if (minTokensOut === 0n) throw new SlippageExceeded('minTokensOut would be zero');

      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simulateAccount();
      if (w) await ensureQuoteAllowance(w, router, usdcIn);
      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'buyWithUsdc' as const,
        args: [key, usdcIn, minTokensOut, deadlineSeconds(dl), 0n] as const,
        account,
        ...(simulate ? { stateOverride: [usdcStateOverride(usdc, accountAddress(account), router, usdcIn)] } : {}),
      };

      const sim = await guardQuote(() => publicClient.simulateContract(txArgs));
      if (simulate) {
        return { simulated: true as const, ...quote, minTokensOut, tokensOut: sim.result, request: sim.request };
      }

      const hash = await guardQuote(() => w!.writeContract({ ...txArgs, account: w!.account!, chain }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('buy transaction reverted');
      return { simulated: false as const, hash, tokensOut: sim.result, minTokensOut };
    },

    /**
     * Buy with native MON: the router swaps MON → USDC on the hookless MON/USDC pool, then USDC → token.
     * `minTokensOut` guards the whole trade; `minUsdcOut` guards the MON → USDC leg on its own.
     */
    async buyWithMon(
      token: Address,
      monIn: bigint,
      opts: {
        slippageBps?: number;
        deadline?: number;
        simulate?: boolean;
        maxMonPerTx?: bigint;
        minTokensOut?: bigint;
        minUsdcOut?: bigint;
      } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      if (monIn <= 0n) throw new MonpadError('monIn must be greater than zero');
      assertMaxMon(opts.maxMonPerTx ?? monIn);
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);

      const quote = await this.quoteBuyWithMon(token, monIn, slippageBps);
      const minTokensOut = opts.minTokensOut ?? minOut(quote.tokensOut, slippageBps);
      if (minTokensOut === 0n) throw new SlippageExceeded('minTokensOut would be zero');
      const minUsdcOut = opts.minUsdcOut ?? 1n;

      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simulateAccount();
      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'buyWithMon' as const,
        args: [key, minTokensOut, minUsdcOut, deadlineSeconds(dl), 0n, 0n] as const,
        value: monIn,
        account,
      };
      const sim = await publicClient.simulateContract(txArgs);
      if (simulate) {
        return { simulated: true as const, ...quote, minTokensOut, minUsdcOut, tokensOut: sim.result, request: sim.request };
      }
      const hash = await w!.writeContract({ ...txArgs, account: w!.account!, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('buyWithMon transaction reverted');
      return { simulated: false as const, hash, tokensOut: sim.result, minTokensOut, minUsdcOut };
    },

    /** Sell tokens for USDC. Approves the router for exactly `tokensIn` when sending. */
    async sell(
      token: Address,
      tokensIn: bigint,
      opts: { slippageBps?: number; deadline?: number; simulate?: boolean; minUsdcOut?: bigint } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simulateAccount();

      if (w) await ensureTokenAllowance(w, token, router, tokensIn);

      const quote = await this.quoteSell(token, tokensIn, slippageBps);
      const minUsdcOut = opts.minUsdcOut ?? minOut(quote.usdcOut, slippageBps);
      if (minUsdcOut === 0n) throw new SlippageExceeded('minUsdcOut would be zero');

      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'sellToUsdc' as const,
        args: [key, tokensIn, minUsdcOut, deadlineSeconds(dl), 0n] as const,
        account,
        ...(simulate
          ? { stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)] }
          : {}),
      };
      await assertQuoteUsable({ recipient: accountAddress(account), router, poolManager: (await ensureAddrs()).poolManager });
      const sim = await guardQuote(() => publicClient.simulateContract(txArgs));
      if (simulate) {
        return { simulated: true as const, ...quote, minUsdcOut, request: sim.request };
      }

      const hash = await guardQuote(() => w!.writeContract({ ...txArgs, account: w!.account!, chain }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('sell transaction reverted');
      return { simulated: false as const, hash, usdcOut: sim.result, minUsdcOut };
    },

    /** Sell tokens and receive native MON (token → USDC → MON). */
    async sellForMon(
      token: Address,
      tokensIn: bigint,
      opts: { slippageBps?: number; deadline?: number; simulate?: boolean; minMonOut?: bigint; minUsdcOut?: bigint } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simulateAccount();

      if (w) await ensureTokenAllowance(w, token, router, tokensIn);

      const quote = await this.quoteSellForMon(token, tokensIn, slippageBps);
      const minMonOut = opts.minMonOut ?? minOut(quote.monOut, slippageBps);
      if (minMonOut === 0n) throw new SlippageExceeded('minMonOut would be zero');
      const minUsdcOut = opts.minUsdcOut ?? 1n;

      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'sellToMon' as const,
        args: [key, tokensIn, minMonOut, minUsdcOut, deadlineSeconds(dl), 0n, 0n] as const,
        account,
        ...(simulate
          ? { stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)] }
          : {}),
      };
      const sim = await publicClient.simulateContract(txArgs);
      if (simulate) {
        return { simulated: true as const, ...quote, minMonOut, minUsdcOut, request: sim.request };
      }
      const hash = await w!.writeContract({ ...txArgs, account: w!.account!, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('sellForMon transaction reverted');
      return { simulated: false as const, hash, monOut: sim.result, minMonOut, minUsdcOut };
    },

    /**
     * Launch a token. The creation fee and the optional dev buy are both paid in USDC
     * (`creationFee + devBuyUsdc`, pulled by the launcher, so it must be approved first; this method does that).
     */
    async launch(
      params: {
        name: string;
        symbol: string;
        metadataUri?: string;
        creatorTaxBps?: number;
        /** Dev buy in USDC base units (6 decimals). Capped on-chain at 5% of supply. */
        devBuyUsdc?: bigint;
        salt?: Hex;
        simulate?: boolean;
      },
    ) {
      const simulate = params.simulate !== false;
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const usdc = await quoteAsset();
      const paused = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'launchPaused',
      });
      if (paused) throw new Paused();

      const tax = params.creatorTaxBps ?? 0;
      if (tax < 0 || tax > 500) throw new MonpadError('creatorTaxBps must be 0–500 (0–5%)');
      const creationFee = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'creationFee',
      });
      const dev = params.devBuyUsdc ?? 0n;
      const total = creationFee + dev;
      if (!simulate) assertMaxUsdc(total);

      const salt = params.salt ?? randomSalt();
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simulateAccount();
      if (w) await ensureQuoteAllowance(w, launcher, total);
      const txArgs = {
        address: launcher,
        abi: launcherAbi,
        functionName: 'launch' as const,
        args: [params.name, params.symbol, salt, tax, dev] as const,
        account,
        ...(simulate ? { stateOverride: [usdcStateOverride(usdc, accountAddress(account), launcher, total)] } : {}),
      };

      await assertQuoteUsable({ sender: accountAddress(account), launcher, poolManager: a.poolManager });
      await guardQuote(() => publicClient.simulateContract(txArgs));
      // Some nodes (e.g. a local Hardhat fork) reject state overrides on eth_estimateGas; gas is informational.
      const gas = await publicClient.estimateContractGas({ ...txArgs, account }).catch(() => null);

      if (simulate) {
        return {
          simulated: true as const,
          gas,
          creationFee,
          devBuyUsdc: dev,
          totalUsdc: total,
          metadataUri: params.metadataUri ?? null,
          note: params.metadataUri ? 'metadataUri is off-chain until token-meta is wired' : undefined,
        };
      }

      const hash = await guardQuote(() => w!.writeContract({ ...txArgs, account: w!.account!, chain }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new MonpadError('launch reverted');
      return { simulated: false as const, hash, gas: receipt.gasUsed, totalUsdc: total };
    },

    /** Claim fees. Pass the USDC address for the quote-side payout or a launch token for its token-side share. */
    async claim(asset: Address) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const w = requireWallet();
      let hash: Hex;
      try {
        hash = await w.writeContract({
          address: launcher,
          abi: launcherAbi,
          functionName: 'claim',
          args: [asset],
          account: w.account!,
          chain,
        });
      } catch (e) {
        rethrowQuoteBlocked(e);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new MonpadError('claim reverted');
      return { hash };
    },

    async harvest(token: Address) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const w = requireWallet();
      const hash = await w.writeContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'harvest',
        args: [token],
        account: w.account!,
        chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new MonpadError('harvest reverted');
      return { hash };
    },
  };

  async function ensureTokenAllowance(w: WalletClient, token: Address, spender: Address, amount: bigint) {
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [w.account!.address, spender],
    });
    if (allowance >= amount) return;
    const hash = await w.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
      account: w.account!,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

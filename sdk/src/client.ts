import {
  createPublicClient,
  formatEther,
  http,
  parseAbiItem,
  parseEther,
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
import { launcherAbi, hookAbi, stateViewAbi, routerAbi, erc20Abi } from './abis.js';
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
  MaxMonExceeded,
  MonpadError,
  Paused,
  PoolNotFound,
  SlippageExceeded,
  WalletRequired,
} from './errors.js';
import {
  erc20AllowanceStateOverride,
  monPerTokenFromSqrt,
  poolKeyForToken,
  poolIdFromKey,
} from './pool.js';

const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
);

const BASE_FEE_BPS = 100;
const VOLUME_BLOCKS = Number(process.env.MONPAD_VOLUME_BLOCKS || '5000');

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
  const maxMonPerTx = options.maxMonPerTx ?? parseEther(process.env.MAX_MON_PER_TX || '5');

  async function ensureAddrs() {
    if (!addrs) addrs = await resolveAddresses(options);
    return addrs;
  }

  function assertMaxMon(amount: bigint) {
    if (amount > maxMonPerTx) {
      throw new MaxMonExceeded(
        `${formatEther(amount)} MON exceeds maxMonPerTx (${formatEther(maxMonPerTx)} MON)`,
      );
    }
  }

  function deadlineSeconds(offsetSec = 300) {
    return BigInt(Math.floor(Date.now() / 1000) + offsetSec);
  }

  function minOut(amount: bigint, slippageBps: number) {
    return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
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
    return poolKeyForToken(token, hook);
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
        contracts: { ...a, platform, hook },
        feePolicy: {
          baseSwapFeeBps: BASE_FEE_BPS,
          maxCreatorTaxBps: 500,
          fromApi: remoteSpec?.fees ?? null,
        },
        maxMonPerTx: maxMonPerTx.toString(),
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
      const { launcher, hook } = requireLauncher(a);
      const [, taxBps, , poolId] = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'launches',
        args: [token],
      });
      const key = poolKeyForToken(token, hook);
      if (!a.stateView) throw new ContractsNotDeployed('stateView not configured');
      const [slot0, liquidity] = await Promise.all([
        publicClient.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
        publicClient.readContract({ address: a.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
      ]);
      const block = await publicClient.getBlockNumber();
      const fromBlock = block > BigInt(VOLUME_BLOCKS) ? block - BigInt(VOLUME_BLOCKS) : 0n;
      let volumeMon = 0n;
      if (a.poolManager) {
        try {
          const logs = await publicClient.getLogs({
            address: a.poolManager,
            event: swapEvent,
            args: { id: poolId },
            fromBlock,
            toBlock: block,
          });
          for (const log of logs) {
            const a0 = log.args.amount0 ?? 0n;
            volumeMon += a0 < 0n ? -a0 : a0;
          }
        } catch {
          /* */
        }
      }
      return {
        token,
        creatorTaxBps: taxBps,
        totalSwapFeeBps: BASE_FEE_BPS + Number(taxBps),
        poolId,
        poolKey: key,
        sqrtPriceX96: slot0[0],
        tick: slot0[1],
        approxMonPerToken: monPerTokenFromSqrt(slot0[0]),
        liquidity,
        volumeMonApprox: volumeMon,
      };
    },

    async trending({ limit = 10, windowBlocks = VOLUME_BLOCKS } = {}) {
      const { launches, count } = await this.listLaunches({ limit: Math.min(limit, 50) });
      const a = await ensureAddrs();
      const block = await publicClient.getBlockNumber();
      const fromBlock = block > BigInt(windowBlocks) ? block - BigInt(windowBlocks) : 0n;
      const scored = [];
      for (const L of launches) {
        let volumeMon = 0n;
        if (a.poolManager) {
          try {
            const logs = await publicClient.getLogs({
              address: a.poolManager,
              event: swapEvent,
              args: { id: L.poolId },
              fromBlock,
              toBlock: block,
            });
            for (const log of logs) {
              const a0 = log.args.amount0 ?? 0n;
              volumeMon += a0 < 0n ? -a0 : a0;
            }
          } catch {
            /* */
          }
        }
        scored.push({ ...L, volumeMon });
      }
      scored.sort((x, y) => (y.volumeMon > x.volumeMon ? 1 : -1));
      return { count, trending: scored.slice(0, limit) };
    },

    async creatorEarnings(account: Address) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
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
      const claimableMon = await publicClient.readContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'claimable',
        args: [account, zeroAddress],
      });
      return { claimableMon, perToken };
    },

    async quoteBuy(token: Address, monIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const simAddr = ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
      const account = walletClient?.account ?? simAddr;
      const { result: tokensOut } = await publicClient.simulateContract({
        address: router,
        abi: routerAbi,
        functionName: 'buyExactIn',
        args: [key, 0n, deadlineSeconds(300), 0n],
        value: monIn,
        account,
      });
      const before = await this.getToken(token);
      const priceImpact =
        before.approxMonPerToken != null && tokensOut > 0n
          ? Number(monIn) / Number(tokensOut) / before.approxMonPerToken - 1
          : null;
      const minOutWei = minOut(tokensOut, slippageBps);
      return { tokensOut, minOut: minOutWei, priceImpact, slippageBps };
    },

    async quoteSell(token: Address, tokensIn: bigint, slippageBps = 100) {
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const simAddr = ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
      const account = walletClient?.account ?? simAddr;
      const { result: monOut } = await publicClient.simulateContract({
        address: router,
        abi: routerAbi,
        functionName: 'sellExactIn',
        args: [key, tokensIn, 0n, deadlineSeconds(300), 0n],
        account,
        stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)],
      });
      return { monOut, minOut: minOut(monOut, slippageBps), priceImpact: null, slippageBps };
    },

    async buy(
      token: Address,
      monIn: bigint,
      opts: {
        slippageBps?: number;
        deadline?: number;
        simulate?: boolean;
        maxMonPerTx?: bigint;
        minTokensOut?: bigint;
      } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      assertMaxMon(opts.maxMonPerTx ?? monIn);
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);

      const quote = await this.quoteBuy(token, monIn, slippageBps);
      const minTokensOut = opts.minTokensOut ?? minOut(quote.tokensOut, slippageBps);
      if (minTokensOut === 0n) throw new SlippageExceeded('minTokensOut would be zero');

      const simAddr = ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simAddr;
      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'buyExactIn' as const,
        args: [key, minTokensOut, deadlineSeconds(dl), 0n] as const,
        value: monIn,
        account,
      };

      const sim = await publicClient.simulateContract(txArgs);
      if (simulate) {
        return { simulated: true as const, ...quote, minTokensOut, tokensOut: sim.result, request: sim.request };
      }

      const hash = await w!.writeContract({ ...txArgs, account: w!.account!, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('buy transaction reverted');
      return { simulated: false as const, hash, tokensOut: sim.result, minTokensOut };
    },

    async sell(
      token: Address,
      tokensIn: bigint,
      opts: { slippageBps?: number; deadline?: number; simulate?: boolean; minMonOut?: bigint } = {},
    ) {
      const slippageBps = opts.slippageBps ?? 100;
      const simulate = opts.simulate !== false;
      const dl = opts.deadline ?? 300;
      const router = requireRouter(await ensureAddrs());
      const key = await poolKey(token);
      await assertKnownToken(token);
      const simAddr = ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simAddr;

      if (!simulate) {
        const allowance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [w!.account!.address, router],
        });
        if (allowance < tokensIn) {
          const ah = await w!.writeContract({
            address: token,
            abi: erc20Abi,
            functionName: 'approve',
            args: [router, tokensIn],
            account: w!.account!,
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: ah });
        }
      }

      const quote = await this.quoteSell(token, tokensIn, slippageBps);
      const minMonOut = opts.minMonOut ?? minOut(quote.monOut, slippageBps);
      if (minMonOut === 0n) throw new SlippageExceeded('minMonOut would be zero');

      const txArgs = {
        address: router,
        abi: routerAbi,
        functionName: 'sellExactIn' as const,
        args: [key, tokensIn, minMonOut, deadlineSeconds(dl), 0n] as const,
        account,
        ...(simulate
          ? { stateOverride: [erc20AllowanceStateOverride(token, accountAddress(account), router)] }
          : {}),
      };
      const sim = await publicClient.simulateContract(txArgs);
      if (simulate) {
        return { simulated: true as const, ...quote, minMonOut, request: sim.request };
      }

      const hash = await w!.writeContract({ ...txArgs, account: w!.account!, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new SlippageExceeded('sell transaction reverted');
      return { simulated: false as const, hash, monOut: sim.result, minMonOut };
    },

    async launch(
      params: {
        name: string;
        symbol: string;
        metadataUri?: string;
        creatorTaxBps?: number;
        devBuyMon?: bigint;
        salt?: Hex;
        simulate?: boolean;
      },
    ) {
      const simulate = params.simulate !== false;
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
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
      const dev = params.devBuyMon ?? 0n;
      const value = creationFee + dev;
      if (!simulate) assertMaxMon(value);

      const salt = params.salt ?? randomSalt();
      const simAddr = ((process.env.MONPAD_SIMULATE_ADDRESS as Address) || zeroAddress) as Address;
      const w = simulate ? undefined : requireWallet();
      const account = w?.account ?? simAddr;
      const txArgs = {
        address: launcher,
        abi: launcherAbi,
        functionName: 'launch' as const,
        args: [params.name, params.symbol, salt, tax] as const,
        value,
        account,
      };

      const sim = await publicClient.simulateContract(txArgs);
      const gas = await publicClient.estimateContractGas({ ...txArgs, account });

      if (simulate) {
        return {
          simulated: true as const,
          gas,
          creationFee,
          metadataUri: params.metadataUri ?? null,
          note: params.metadataUri ? 'metadataUri is off-chain until token-meta is wired' : undefined,
        };
      }

      const hash = await w!.writeContract({ ...txArgs, account: w!.account!, chain });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new MonpadError('launch reverted');
      return { simulated: false as const, hash, gas: receipt.gasUsed };
    },

    async claim(asset: Address) {
      const a = await ensureAddrs();
      const { launcher } = requireLauncher(a);
      const w = requireWallet();
      const hash = await w.writeContract({
        address: launcher,
        abi: launcherAbi,
        functionName: 'claim',
        args: [asset],
        account: w.account!,
        chain,
      });
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
}

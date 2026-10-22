/**
 * @monpad/sdk — public trader / bot / AI surface for Monpad on Monad.
 * Bots and snipers are welcome. No anti-sniper delay or whitelist.
 *
 * Creator "dev bot" = optional `devBuyMon` in `encodeLaunchValue` / launch helpers —
 * same atomic first-buy-in-create-tx pattern as Minta `firstBuyUsdc`.
 */
import {
  createPublicClient,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';

export const MONAD_CHAIN_ID = 143;
export const MONSHI_TOKEN = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777' as const;
export const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
export const PLATFORM_WALLET = '0x5899a0576A94327a6316E01190f951edf7645914' as const;

/** Protocol skim (bps). Creator tax is independent. */
export const FEES = {
  burnTokenBps: 1000,
  burnMonshiBps: 1000,
  platformBps: 1000,
  creatorSaleShareBps: 8000,
  defaultSlippageBps: 200, // 2% — bots welcome; competing fills expected
} as const;

export const monad = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
} as const;

export type FeeConfig = {
  cfBurnTokenBps: number;
  cfLpBps: number;
  taxBurnTokenBps: number;
  taxLpBps: number;
};

export const ZERO_FEE_CONFIG: FeeConfig = {
  cfBurnTokenBps: 0,
  cfLpBps: 0,
  taxBurnTokenBps: 0,
  taxLpBps: 0,
};

export type MonpadAddresses = {
  factory: Address;
  graduator: Address;
  monshi: typeof MONSHI_TOKEN;
  platform: typeof PLATFORM_WALLET;
  dead: typeof DEAD;
};

export function getAddresses(env: NodeJS.ProcessEnv = process.env): MonpadAddresses {
  const factory = (env.MONPAD_FACTORY || env.NEXT_PUBLIC_FACTORY_V3 || env.FACTORY_V3 || '') as Address;
  const graduator = (env.MONPAD_GRADUATOR || env.NEXT_PUBLIC_GRADUATOR_V3 || '') as Address;
  if (!factory || factory === '0x') throw new Error('Set MONPAD_FACTORY / NEXT_PUBLIC_FACTORY_V3');
  return {
    factory,
    graduator,
    monshi: MONSHI_TOKEN,
    platform: PLATFORM_WALLET,
    dead: DEAD,
  };
}

export function createMonpadPublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: monad as any,
    transport: http(rpcUrl || process.env.RPC_URL || process.env.MONAD_RPC || 'https://rpc.monad.xyz'),
  });
}

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const factoryAbi = parseAbi([
  'function creationFeeFor(address) view returns (uint256)',
  'function allCounts() view returns (uint256, uint256)',
  'function allTokens(uint256) view returns (address)',
  'function allCurves(uint256) view returns (address)',
  'function createLaunch(string name, string symbol, (uint16 cfBurnTokenBps, uint16 cfLpBps, uint16 taxBurnTokenBps, uint16 taxLpBps) cfg) payable returns (address token, address curve)',
]);

const curveAbi = parseAbi([
  'function buy(uint256 minTokensOut) payable returns (uint256)',
  'function sell(uint256 tokensIn, uint256 minMonOut) returns (uint256)',
  'function priceWeiPerToken() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function monRaisedNet() view returns (uint256)',
  'function token() view returns (address)',
  'function creator() view returns (address)',
]);

const tokenMetaAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

/** msg.value for createLaunch = creationFee + optional Minta-style dev bot (first buy). */
export async function encodeLaunchValue(
  publicClient: PublicClient,
  factory: Address,
  creator: Address,
  devBuyMon: bigint = 0n,
): Promise<bigint> {
  const fee = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'creationFeeFor',
    args: [creator],
  })) as bigint;
  return fee + devBuyMon;
}

export async function getMonshiBurned(publicClient: PublicClient) {
  const [burned, totalSupply] = await Promise.all([
    publicClient.readContract({
      address: MONSHI_TOKEN,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [DEAD],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: MONSHI_TOKEN,
      abi: erc20Abi,
      functionName: 'totalSupply',
    }) as Promise<bigint>,
  ]);
  return {
    burned,
    burnedFormatted: formatEther(burned),
    totalSupply,
    circulating: totalSupply > burned ? totalSupply - burned : 0n,
    platformWallet: PLATFORM_WALLET,
    fees: FEES,
  };
}

export async function listLaunches(publicClient: PublicClient, factory: Address, limit = 20) {
  const counts = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'allCounts',
  })) as [bigint, bigint];
  const n = Number(counts[0]);
  const start = Math.max(0, n - limit);
  const out: { index: number; token: Address; curve: Address; name?: string; symbol?: string }[] = [];
  for (let i = n - 1; i >= start; i--) {
    const [token, curve] = await Promise.all([
      publicClient.readContract({ address: factory, abi: factoryAbi, functionName: 'allTokens', args: [BigInt(i)] }) as Promise<Address>,
      publicClient.readContract({ address: factory, abi: factoryAbi, functionName: 'allCurves', args: [BigInt(i)] }) as Promise<Address>,
    ]);
    let name: string | undefined;
    let symbol: string | undefined;
    try {
      [name, symbol] = await Promise.all([
        publicClient.readContract({ address: token, abi: tokenMetaAbi, functionName: 'name' }) as Promise<string>,
        publicClient.readContract({ address: token, abi: tokenMetaAbi, functionName: 'symbol' }) as Promise<string>,
      ]);
    } catch { /* ignore */ }
    out.push({ index: i, token, curve, name, symbol });
  }
  return { count: n, launches: out };
}

export type LaunchParams = {
  name: string;
  symbol: string;
  feeConfig?: FeeConfig;
  /** Minta-style atomic first buy (dev bot) in MON wei */
  devBuyMon?: bigint;
};

/**
 * Launch a token. With `devBuyMon`, the creator buys in the same tx before others can trade.
 */
export async function launch(
  wallet: WalletClient,
  publicClient: PublicClient,
  factory: Address,
  p: LaunchParams,
): Promise<{ hash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  const creator = account.address;
  const cfg = p.feeConfig ?? ZERO_FEE_CONFIG;
  const value = await encodeLaunchValue(publicClient, factory, creator, p.devBuyMon ?? 0n);
  const hash = await wallet.writeContract({
    chain: monad as any,
    account,
    address: factory,
    abi: factoryAbi,
    functionName: 'createLaunch',
    args: [p.name, p.symbol, cfg],
    value,
  });
  return { hash };
}

export async function buy(
  wallet: WalletClient,
  _publicClient: PublicClient,
  curve: Address,
  monIn: bigint,
  minTokensOut: bigint = 0n,
): Promise<{ hash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  const hash = await wallet.writeContract({
    chain: monad as any,
    account,
    address: curve,
    abi: curveAbi,
    functionName: 'buy',
    args: [minTokensOut],
    value: monIn,
  });
  return { hash };
}

export async function sell(
  wallet: WalletClient,
  publicClient: PublicClient,
  curve: Address,
  tokensIn: bigint,
  minMonOut: bigint = 0n,
): Promise<{ hash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error('wallet has no account');
  const token = (await publicClient.readContract({
    address: curve,
    abi: curveAbi,
    functionName: 'token',
  })) as Address;
  await wallet.writeContract({
    chain: monad as any,
    account,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [curve, tokensIn],
  });
  const hash = await wallet.writeContract({
    chain: monad as any,
    account,
    address: curve,
    abi: curveAbi,
    functionName: 'sell',
    args: [tokensIn, minMonOut],
  });
  return { hash };
}

export function parseMon(amount: string): bigint {
  return parseEther(amount);
}

export function getSpec() {
  return {
    chainId: MONAD_CHAIN_ID,
    name: 'Monpad',
    policy: {
      botsAndSnipers: 'welcome',
      antiSniper: false,
      creatorDevBot: 'optional atomic first buy in createLaunch (devBuyMon)',
    },
    fees: FEES,
    platformWallet: PLATFORM_WALLET,
    monshi: MONSHI_TOKEN,
    note: 'Platform fee is always quote (MON) on sells — never taken as project tokens.',
  };
}

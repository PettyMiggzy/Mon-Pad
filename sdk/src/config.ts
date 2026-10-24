import type { Address } from 'viem';
import { DEFAULT_INFRA } from './chain-config.js';
import { ContractsNotDeployed } from './errors.js';

export type RemoteSpec = {
  chainId?: number;
  name?: string;
  fees?: Record<string, unknown>;
  addresses?: Record<string, string | undefined>;
  uv4?: {
    launcher?: string;
    hook?: string;
    v4Router?: string;
    quoteAsset?: string;
    poolManager?: string;
    stateView?: string;
  };
};

export type ResolvedAddresses = {
  launcher: Address | '';
  hook: Address | '';
  v4Router: Address | '';
  /** USDC. Left empty it is read from `launcher.quoteAsset()`. */
  quoteAsset: Address | '';
  poolManager: Address;
  stateView: Address;
  monshi: Address | '';
  dead: Address | '';
  platform: Address | '';
};

export type MonpadCreateOptions = {
  chain?: { id: number; name?: string; rpcUrls?: { default: { http: string[] } } };
  rpcUrl?: string;
  walletClient?: import('viem').WalletClient;
  specUrl?: string;
  addresses?: Partial<ResolvedAddresses>;
  /** Cap for one MON-denominated send (MON entry points of the router). */
  maxMonPerTx?: bigint;
  /** Cap for one USDC-denominated send (launch, buy, sell). In USDC base units (6 decimals). */
  maxUsdcPerTx?: bigint;
  fetch?: typeof fetch;
};

function envAddr(name: string): Address | '' {
  const v = process.env[name]?.trim();
  return v && v.startsWith('0x') ? (v as Address) : '';
}

export async function resolveAddresses(opts: MonpadCreateOptions): Promise<ResolvedAddresses> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  let remote: RemoteSpec = {};
  const specUrl =
    opts.specUrl ??
    process.env.MONPAD_SPEC_URL ??
    (process.env.MONPAD_SITE ? `${process.env.MONPAD_SITE.replace(/\/$/, '')}/api/v1/spec` : '');

  if (specUrl && fetchFn) {
    try {
      const res = await fetchFn(specUrl);
      if (res.ok) remote = (await res.json()) as RemoteSpec;
    } catch {
      /* offline / CI */
    }
  }

  const fromSpec = remote.addresses ?? {};
  const uv4 = remote.uv4 ?? {};

  const merged: ResolvedAddresses = {
    launcher: (opts.addresses?.launcher ||
      envAddr('MONPAD_LAUNCHER') ||
      uv4.launcher ||
      '') as Address | '',
    hook: (opts.addresses?.hook || envAddr('MONPAD_HOOK') || uv4.hook || '') as Address | '',
    v4Router: (opts.addresses?.v4Router ||
      envAddr('MONPAD_V4_ROUTER') ||
      uv4.v4Router ||
      '') as Address | '',
    quoteAsset: (opts.addresses?.quoteAsset ||
      envAddr('MONPAD_QUOTE_ASSET') ||
      uv4.quoteAsset ||
      '') as Address | '',
    poolManager: (opts.addresses?.poolManager ||
      envAddr('MONPAD_POOL_MANAGER') ||
      uv4.poolManager ||
      DEFAULT_INFRA.poolManager ||
      '') as Address,
    stateView: (opts.addresses?.stateView ||
      envAddr('MONPAD_STATE_VIEW') ||
      uv4.stateView ||
      DEFAULT_INFRA.stateView ||
      '') as Address,
    monshi: (opts.addresses?.monshi || (fromSpec.monshi as Address) || envAddr('MONSHI') || '') as Address | '',
    dead: (opts.addresses?.dead || (fromSpec.dead as Address) || '') as Address | '',
    platform: (opts.addresses?.platform || (fromSpec.platformWallet as Address) || '') as Address | '',
  };

  return merged;
}

export function requireLauncher(addrs: ResolvedAddresses): { launcher: Address; hook: Address } {
  if (!addrs.launcher || !addrs.hook) throw new ContractsNotDeployed();
  return { launcher: addrs.launcher, hook: addrs.hook };
}

export function requireRouter(addrs: ResolvedAddresses): Address {
  if (!addrs.v4Router) throw new ContractsNotDeployed('MONPAD_V4_ROUTER not set');
  return addrs.v4Router;
}

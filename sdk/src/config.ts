import type { Address } from 'viem';
import { MAINNET } from './chain-config.js';

export type ResolvedAddresses = {
  launcher: Address;
  hook: Address;
  router: Address;
  usdc: Address;
  poolManager: Address;
  stateView: Address;
  monshi: Address;
};

export type MonpadCreateOptions = {
  publicClient: import('viem').PublicClient;
  walletClient?: import('viem').WalletClient;
  /** Override any address (defaults are Monad mainnet). */
  addresses?: Partial<ResolvedAddresses>;
};

export function resolveAddresses(over: Partial<ResolvedAddresses> = {}): ResolvedAddresses {
  return {
    launcher: over.launcher ?? MAINNET.launcher,
    hook: over.hook ?? MAINNET.hook,
    router: over.router ?? MAINNET.router,
    usdc: over.usdc ?? MAINNET.usdc,
    poolManager: over.poolManager ?? MAINNET.poolManager,
    stateView: over.stateView ?? MAINNET.stateView,
    monshi: over.monshi ?? MAINNET.monshi,
  };
}

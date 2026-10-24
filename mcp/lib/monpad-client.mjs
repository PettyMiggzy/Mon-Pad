import { createMonpad } from '@monpad/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.mjs';
import { getSimulateAccount } from './clients.mjs';

/**
 * @param {{ dryRun?: boolean }} opts
 */
export async function getMonpad({ dryRun = true } = {}) {
  const config = loadConfig();
  const chain = {
    id: config.chainId,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };

  let walletClient;
  if (!dryRun && process.env.MONPAD_PRIVATE_KEY?.trim()) {
    const pk = process.env.MONPAD_PRIVATE_KEY.trim();
    const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
    walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  }

  process.env.MONPAD_SIMULATE_ADDRESS = getSimulateAccount();

  return createMonpad({
    rpcUrl: config.rpcUrl,
    chain,
    walletClient,
    addresses: {
      launcher: config.contracts.launcher,
      hook: config.contracts.hook,
      v4Router: config.contracts.v4Router,
      quoteAsset: config.contracts.quoteAsset,
      poolManager: config.contracts.poolManager,
      stateView: config.contracts.stateView,
      monshi: config.contracts.monshi,
    },
  });
}

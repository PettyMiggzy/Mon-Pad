import { createMonpad } from '@monpad/sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.mjs';

function chainOf(config) {
  return { id: config.chainId, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } };
}

/** The wallet exists only when you ask for a real transaction (dryRun=false) and MONPAD_PRIVATE_KEY is set. */
export function getMonpad({ withWallet = false } = {}) {
  const config = loadConfig();
  const chain = chainOf(config);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  let walletClient;
  if (withWallet) {
    const pk = process.env.MONPAD_PRIVATE_KEY?.trim();
    if (!pk) throw new Error('Set MONPAD_PRIVATE_KEY (a small burner wallet) to send transactions. Dry runs work without a key.');
    walletClient = createWalletClient({ account: privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`), chain, transport: http(config.rpcUrl) });
  }
  return { monpad: createMonpad({ publicClient, walletClient, addresses: config.addresses }), publicClient, walletClient };
}

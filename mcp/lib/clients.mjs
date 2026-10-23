import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.mjs';

/** Hardhat / Anvil account #0 — used only for dry-run simulation when no key is set. */
export const DEFAULT_SIMULATE_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function monadChain(config) {
  return {
    id: config.chainId,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };
}

export function getPublicClient(config = loadConfig()) {
  return createPublicClient({
    chain: monadChain(config),
    transport: http(config.rpcUrl),
  });
}

export function getSimulateAccount() {
  const a = process.env.MONPAD_SIMULATE_ADDRESS?.trim();
  if (a && isAddress(a)) return a;
  return DEFAULT_SIMULATE_ACCOUNT;
}

/** @returns {{ address: `0x${string}` }} */
export function getSimulateAccountRef() {
  return { address: getSimulateAccount() };
}

/** Wallet for writes — reads MONPAD_PRIVATE_KEY only; never log the key. */
export function getWalletClient(config = loadConfig()) {
  const pk = process.env.MONPAD_PRIVATE_KEY;
  if (!pk?.trim()) {
    throw new Error('Set MONPAD_PRIVATE_KEY to broadcast transactions (dryRun=true works without a key)');
  }
  const account = privateKeyToAccount(pk.trim().startsWith('0x') ? pk.trim() : `0x${pk.trim()}`);
  return createWalletClient({
    account,
    chain: monadChain(config),
    transport: http(config.rpcUrl),
  });
}

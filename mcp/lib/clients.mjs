import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.mjs';

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

/** Wallet for writes — reads MONPAD_PRIVATE_KEY only; never log the key. */
export function getWalletClient(config = loadConfig()) {
  const pk = process.env.MONPAD_PRIVATE_KEY;
  if (!pk?.trim()) {
    throw new Error('Set MONPAD_PRIVATE_KEY to enable write tools (launch / buy / sell)');
  }
  const account = privateKeyToAccount(pk.trim().startsWith('0x') ? pk.trim() : `0x${pk.trim()}`);
  return createWalletClient({
    account,
    chain: monadChain(config),
    transport: http(config.rpcUrl),
  });
}

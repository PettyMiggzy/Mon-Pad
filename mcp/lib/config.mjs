import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dir, '..', 'config.json');

const ENV_MAP = {
  launcher: 'MONPAD_LAUNCHER',
  hook: 'MONPAD_HOOK',
  poolManager: 'MONPAD_POOL_MANAGER',
  stateView: 'MONPAD_STATE_VIEW',
  monshi: 'MONSHI',
  v4Router: 'MONPAD_V4_ROUTER',
  quoteAsset: 'MONPAD_QUOTE_ASSET',
  platform: 'MONPAD_PLATFORM',
};

let cached;

/** @returns {{ chainId: number, contracts: Record<string, string>, rpcUrl: string }} */
export function loadConfig() {
  if (cached) return cached;

  let file = { chainId: 143, contracts: {} };
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    /* optional file */
  }

  const contracts = { ...file.contracts };
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    if (process.env[envName]?.trim()) contracts[key] = process.env[envName].trim();
  }
  // Legacy env name — do not document; map to router if v4Router unset
  if (!contracts.v4Router && process.env.MONPAD_V4_TRADER?.trim()) {
    contracts.v4Router = process.env.MONPAD_V4_TRADER.trim();
  }
  if (!contracts.v4Router && contracts.v4Trader) {
    contracts.v4Router = contracts.v4Trader;
  }

  cached = {
    chainId: Number(process.env.MONPAD_CHAIN_ID || file.chainId || 143),
    contracts,
    rpcUrl: process.env.RPC_URL || process.env.MONAD_RPC || 'https://rpc.monad.xyz',
  };
  return cached;
}

export function resetConfigCache() {
  cached = undefined;
}

export function requireLauncher(config = loadConfig()) {
  const { launcher, hook } = config.contracts;
  if (!launcher || !hook) {
    throw new Error('contracts not deployed yet — set MONPAD_LAUNCHER and MONPAD_HOOK (or config.json)');
  }
  return { launcher, hook };
}

export function requireV4Router(config = loadConfig()) {
  const router = config.contracts.v4Router;
  if (!router) {
    throw new Error(
      'contracts not deployed yet — set MONPAD_V4_ROUTER to the Monpad V4 swap router for buy/sell',
    );
  }
  return router;
}

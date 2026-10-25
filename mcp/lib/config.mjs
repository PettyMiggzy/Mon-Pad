/** Monad mainnet defaults come from the SDK. Override any contract with an env var (MONPAD_LAUNCHER, MONPAD_HOOK, MONPAD_V4_ROUTER, ...). */
const ENV_MAP = {
  launcher: 'MONPAD_LAUNCHER',
  hook: 'MONPAD_HOOK',
  router: 'MONPAD_V4_ROUTER',
  usdc: 'MONPAD_USDC',
  poolManager: 'MONPAD_POOL_MANAGER',
  stateView: 'MONPAD_STATE_VIEW',
  monshi: 'MONSHI',
};

export function loadConfig() {
  const addresses = {};
  for (const [key, env] of Object.entries(ENV_MAP)) {
    const v = process.env[env]?.trim();
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) addresses[key] = v;
  }
  return {
    chainId: Number(process.env.MONPAD_CHAIN_ID || 143),
    rpcUrl: process.env.RPC_URL || process.env.MONAD_RPC || 'https://rpc.monad.xyz',
    addresses,
  };
}

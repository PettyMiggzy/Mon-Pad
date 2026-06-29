import { http } from 'viem';
import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, MONAD_EXPLORER } from './constants';

// MONAD_RPC_URL is the same-origin /api/rpc proxy in the browser (and the real
// endpoint on the server). All app reads route through it, so the upstream RPC
// URL never reaches the client. WSS / public-fallback endpoints are intentionally
// not used here — they would expose a raw endpoint and the app polls for updates.
const RPC_URLS = [MONAD_RPC_URL];

export const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: 'Monadscan', url: MONAD_EXPLORER } },
});

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
if (!WC_PROJECT_ID) {
  // eslint-disable-next-line no-console
  console.warn('[wagmi] NEXT_PUBLIC_WC_PROJECT_ID not set — WalletConnect will be limited.');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'MonPad',
  projectId: WC_PROJECT_ID || 'monpad-dev-placeholder',
  chains: [monad],
  transports: {
    [monad.id]: http(MONAD_RPC_URL, { timeout: 12_000 }),
  },
  ssr: true,
});

export const monadMainnet = monad;

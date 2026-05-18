import { http, fallback } from 'viem';
import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, MONAD_EXPLORER } from './constants';

const PRIMARY = MONAD_RPC_URL;
const FALLBACK = process.env.NEXT_PUBLIC_RPC_URL_FALLBACK;
const RPC_URLS = FALLBACK ? [PRIMARY, FALLBACK] : [PRIMARY];

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
    [monad.id]: RPC_URLS.length > 1
      ? fallback(RPC_URLS.map((url) => http(url, { timeout: 10_000 })), { rank: false })
      : http(RPC_URLS[0], { timeout: 10_000 }),
  },
  ssr: true,
});

export const monadMainnet = monad;

import { http, fallback, webSocket } from 'viem';
import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { MONAD_CHAIN_ID, MONAD_RPC_URL, MONAD_EXPLORER } from './constants';

const PRIMARY = MONAD_RPC_URL;
const FALLBACK = process.env.NEXT_PUBLIC_RPC_URL_FALLBACK;
const RPC_URLS = FALLBACK ? [PRIMARY, FALLBACK] : [PRIMARY];
// Optional WebSocket endpoint (e.g. QuickNode wss://) — preferred for live subscriptions,
// with HTTP as automatic fallback. Set NEXT_PUBLIC_RPC_WSS in .env.local / Vercel.
const WSS = process.env.NEXT_PUBLIC_RPC_WSS;

export const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS, ...(WSS ? { webSocket: [WSS] } : {}) } },
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
    // WSS first (when configured) for fast live updates, then HTTP endpoints as fallback.
    [monad.id]: (() => {
      const ts = [
        ...(WSS ? [webSocket(WSS, { timeout: 10_000 })] : []),
        ...RPC_URLS.map((url) => http(url, { timeout: 10_000 })),
      ];
      return ts.length > 1 ? fallback(ts, { rank: false }) : ts[0];
    })(),
  },
  ssr: true,
});

export const monadMainnet = monad;

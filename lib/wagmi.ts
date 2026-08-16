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
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
if (!WC_PROJECT_ID) {
  // eslint-disable-next-line no-console
  console.warn('[wagmi] NEXT_PUBLIC_WC_PROJECT_ID not set — WalletConnect will be limited.');
}

/**
 * Robinhood Chain — the research pad at /lab and /pad launches here, nothing else does.
 *
 * It has to be declared HERE and not only inside the page, because wagmi drops any chain change to an
 * unconfigured id on the floor (createConfig: `if (!isChainConfigured) return`). With 4663 missing,
 * switching to it left the top-level chainId stuck on Monad and RainbowKit's header showed "Wrong
 * network" — whose only offered fix was switching straight back to Monad. Declaring it costs one extra
 * entry in the network picker; leaving it out made the pad unusable.
 *
 * Its own public RPC, deliberately: MONAD_RPC_URL is the /api/rpc proxy to Monad and would answer every
 * 4663 call with Monad state.
 */
export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://robinhoodchain.blockscout.com/api/eth-rpc'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export const wagmiConfig = getDefaultConfig({
  appName: 'MonPad',
  projectId: WC_PROJECT_ID || 'monpad-dev-placeholder',
  // Monad stays first — createConfig seeds the initial chainId from chains[0], so ordinary visitors
  // still land on Monad and never see 4663 unless they go looking for it.
  chains: [monad, robinhood],
  transports: {
    [monad.id]: http(MONAD_RPC_URL, { timeout: 12_000 }),
    [robinhood.id]: http(robinhood.rpcUrls.default.http[0], { timeout: 12_000 }),
  },
  ssr: true,
});

export const monadMainnet = monad;

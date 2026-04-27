import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { http, fallback } from 'wagmi'

// Frontend RPC: NEXT_PUBLIC_PRIMARY_RPC if set (paid endpoint), public always present as fallback.
// IMPORTANT: NEXT_PUBLIC_* vars are exposed in client bundle — only put a paid RPC here if it's
// rate-limited per-IP (so abuse can't drain your quota). Otherwise leave PRIMARY unset and use
// the public RPC for the frontend, while the backend uses the paid one for indexing.
const PRIMARY = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PRIMARY_RPC) || 'https://rpc.monad.xyz'
const FALLBACK = 'https://rpc.monad.xyz'

const RPC_URLS = PRIMARY === FALLBACK ? [PRIMARY] : [PRIMARY, FALLBACK]

export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
})

export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'cc1358b5e311a1f844c1d6482633c78d'

export const wagmiConfig = getDefaultConfig({
  appName: 'MonPad',
  projectId: WC_PROJECT_ID,
  chains: [monad],
  transports: {
    [monad.id]: RPC_URLS.length > 1
      ? fallback(RPC_URLS.map(url => http(url, { timeout: 10_000 })), { rank: false })
      : http(RPC_URLS[0], { timeout: 10_000 })
  },
  ssr: true,
})

export const monadMainnet = monad

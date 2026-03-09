import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { walletConnect, injected, metaMask } from 'wagmi/connectors'

export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://attentive-magical-sanctuary.monad-mainnet.quiknode.pro/63002c717b0ee2930197c2d560150d561db9ed7f/']
    }
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://monadscan.io' }
  }
})

export const WC_PROJECT_ID = 'cc1358b5e311a1f844c1d6482633c78d'

export const wagmiConfig = createConfig({
  chains: [monad],
  connectors: [
    injected(),
    metaMask(),
    walletConnect({ projectId: WC_PROJECT_ID }),
  ],
  transports: {
    [monad.id]: http('https://attentive-magical-sanctuary.monad-mainnet.quiknode.pro/63002c717b0ee2930197c2d560150d561db9ed7f/')
  },
  ssr: true,
})

export const monadMainnet = monad
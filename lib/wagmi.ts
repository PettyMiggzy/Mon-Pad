import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { walletConnect, injected, metaMask } from 'wagmi/connectors'

export const monad = defineChain({
    id: 10143,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
      default: {
              http: ['https://testnet-rpc.monad.xyz']
      }
    },
    blockExplorers: {
      default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' }
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
          [monad.id]: http('https://testnet-rpc.monad.xyz')
    },
    ssr: true,
})

export const monadMainnet = monad

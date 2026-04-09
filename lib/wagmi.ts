import { createConfig, http } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { defineChain } from 'viem'

export const monad = defineChain({
        id: 143,
        name: 'Monad',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: {
            default: {
                            http: ['https://rpc.monad.xyz']
            }
        },
        blockExplorers: {
            default: { name: 'Monadscan', url: 'https://monadscan.com' }
        }
})

export const WC_PROJECT_ID = 'cc1358b5e311a1f844c1d6482633c78d'

export const wagmiConfig = createConfig({
        chains: [monad],
        connectors: [
                    injected(),
                    walletConnect({ projectId: WC_PROJECT_ID }),
                ],
        transports: {
                    [monad.id]: http('https://rpc.monad.xyz')
        },
        ssr: true,
})

export const monadMainnet = monad

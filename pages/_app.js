import { useEffect, useState } from 'react'
import Head from 'next/head'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { wagmiConfig } from '../lib/wagmi'
import Splash from '../components/Splash'
import '../styles/globals.css'
import '@rainbow-me/rainbowkit/styles.css'

const queryClient = new QueryClient()

const monPadTheme = darkTheme({
  accentColor: '#A855F7',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  fontStack: 'system',
})

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#A855F7" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MonPad" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/Pad.png" />
        <link rel="icon" type="image/png" href="/Pad.png" />
        <title>MonPad — Fair Launch on Monad</title>
        <meta name="description" content="Launch tokens, trade, stake, and earn on Monad. The fairest launchpad in the trenches." />
        <meta property="og:title" content="MonPad" />
        <meta property="og:description" content="Fair launch token launchpad on Monad. Devs earn 2% forever." />
        <meta property="og:image" content="/monpad-splash.jpg" />
      </Head>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={monPadTheme} modalSize="compact">
            <Splash />
            <Component {...pageProps} />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </>
  )
}

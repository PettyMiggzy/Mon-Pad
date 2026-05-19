import '@/styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi';
import Splash from '@/components/Splash';
import { Layout } from '@/components/Layout';

const monPadTheme = darkTheme({
  accentColor: '#A855F7',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  overlayBlur: 'small',
});

export default function App({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <>
      <Head>
        <title>Mon-Pad — Fair Launch on Monad</title>
        <meta
          name="description"
          content="Fair token launches on Monad. 100 MON to launch, 425k to graduate. Devs earn 1.5% forever."
        />
        <meta property="og:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta
          property="og:description"
          content="Fair token launches on Monad. 100 MON to launch, 425k to graduate. Devs earn 1.5% forever."
        />
        <meta property="og:image" content="https://www.monpad.net/monpad-splash.jpg" />
        <meta property="og:image:width" content="1280" />
        <meta property="og:image:height" content="960" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.monpad.net" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta name="twitter:description" content="Fair token launches on Monad. 100 MON to launch, 425k to graduate. Devs earn 1.5% forever." />
        <meta name="twitter:image" content="https://www.monpad.net/monpad-splash.jpg" />
        <link rel="icon" href="/Pad.png" />
        <link rel="apple-touch-icon" href="/Pad.png" />
        <link rel="manifest" href="/manifest.json" />
      </Head>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={monPadTheme} modalSize="compact">
            <Splash />
            <Layout>
              <Component {...pageProps} />
            </Layout>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </>
  );
}

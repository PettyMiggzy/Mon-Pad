import '@/styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { Russo_One, Outfit, JetBrains_Mono } from 'next/font/google';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi';
import { Layout } from '@/components/Layout';
import { ToastProvider } from '@/components/ui/Toast';

const display = Russo_One({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'optional' });
const sans = Outfit({ subsets: ['latin'], variable: '--font-sans', display: 'optional' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'optional' });
const fontVars = `${display.variable} ${sans.variable} ${mono.variable}`;

const monPadTheme = darkTheme({
  accentColor: '#B57BFF',
  accentColorForeground: 'white',
  borderRadius: 'large',
  overlayBlur: 'small',
});

export default function App({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => {
    document.documentElement.classList.add(...fontVars.split(' '));
  }, []);

  return (
    <>
      <Head>
        <title>Mon-Pad — Fair Launch on Monad</title>
        <meta
          name="description"
          content="Fair token launches on Monad. Uniswap V3 from block one. Every trade burns Monshi."
        />
        <meta property="og:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta
          property="og:description"
          content="Fair token launches on Monad. Uniswap V3 from block one. Every trade burns Monshi."
        />
        <meta property="og:image" content="https://www.monpad.net/api/og" />
        <meta property="og:image:width" content="1280" />
        <meta property="og:image:height" content="960" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.monpad.net" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Mon-Pad — Fair Launch on Monad" />
        <meta name="twitter:description" content="Fair token launches on Monad. Uniswap V3 from block one. Every trade burns Monshi." />
        <meta name="twitter:image" content="https://www.monpad.net/api/og" />
        <link rel="icon" type="image/png" href="/meshy/monshi-face.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </Head>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={monPadTheme} modalSize="compact">
            <ToastProvider>
              <div className={fontVars}>
                <Layout>
                  <Component {...pageProps} />
                </Layout>
              </div>
            </ToastProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </>
  );
}

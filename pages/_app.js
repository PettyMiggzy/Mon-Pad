import { useEffect, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '../lib/wagmi'
import '../styles/globals.css'

const queryClient = new QueryClient()

function SplashScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0b0714',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src="/monpad-splash.jpg" alt="MonPad" style={{ width: 220, height: 220, objectFit: 'contain' }} />
    </div>
  )
}

export default function App({ Component, pageProps }) {
  const [showSplash, setShowSplash] = useState(false)

  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
    if (!isMobile) return

    const seen = sessionStorage.getItem('monpad_splash_seen')
    if (!seen) {
      setShowSplash(true)
      sessionStorage.setItem('monpad_splash_seen', '1')
      const t = setTimeout(() => setShowSplash(false), 1400)
      return () => clearTimeout(t)
    }
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {showSplash && <SplashScreen />}
        <Component {...pageProps} />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
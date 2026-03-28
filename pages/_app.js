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
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column',
    }}>
      <img src="/monpad-logo.png" alt="MonPad" style={{ width: 108, height: 108, borderRadius: 24, objectFit: 'cover', boxShadow: '0 10px 34px rgba(0,0,0,0.24)' }} />
      <img src="/monpad-text-logo.png" alt="MonPad" style={{ width: 200, height: 'auto', objectFit: 'contain', marginTop: 18 }} />
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
      const t = setTimeout(() => setShowSplash(false), 2500)
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
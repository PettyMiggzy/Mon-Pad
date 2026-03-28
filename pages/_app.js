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
      background: 'linear-gradient(180deg, #c9a7ff 0%, #b78cff 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 18,
    }}>
      <img src="/monpad-logo.png" alt="MonPad" style={{ width: 92, height: 92, borderRadius: 22, objectFit: 'cover', boxShadow: '0 8px 30px rgba(0,0,0,0.18)' }} />
      <img src="/monpad-text-logo.png" alt="MonPad" style={{ width: 170, height: 'auto', objectFit: 'contain' }} />
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
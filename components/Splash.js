import { useState, useEffect } from 'react'

// Initial splash screen shown on first page load.
// Replace /MonshiPad.png with /splash.png once the new mascot+Monad-logo image is uploaded.
export default function Splash() {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    // Begin fade after 1.5s, fully unmount 400ms later (after the CSS transition).
    const fadeTimer = setTimeout(() => setFading(true), 1500)
    const unmountTimer = setTimeout(() => setVisible(false), 1900)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(unmountTimer)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fading ? 0 : 1,
        transition: 'opacity 400ms ease-out',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <img
        src="/splash.png"
        alt="MonPad splash"
        style={{ maxWidth: '60vw', maxHeight: '60vh', objectFit: 'contain' }}
      />
    </div>
  )
}

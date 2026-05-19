import { useEffect, useState } from 'react';

/**
 * Boot splash overlay. Shows /splash.png for 1.5s, fades over 400ms,
 * unmounts at 1.9s. Pointer-events disabled during fade so clicks pass through.
 * Ported from the v1 components/Splash.js — same timings, TS types added.
 */
export default function Splash() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1500);
    const unmountTimer = setTimeout(() => setVisible(false), 1900);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fading ? 0 : 1,
        transition: 'opacity 400ms ease-out',
        pointerEvents: fading ? 'none' : 'auto',
        background: 'radial-gradient(circle at 50% 40%, rgba(20,16,42,0.95), rgba(0,0,0,0.98))',
      }}
    >
      {/* Boot splash plays /splash.mp4. Fades out when video ends OR after safety timeout. */}
      <video
        autoPlay
        muted
        playsInline
        onEnded={() => {
          setFading(true);
          setTimeout(() => setVisible(false), 400);
        }}
        style={{ maxWidth: '60vw', maxHeight: '60vh', objectFit: 'contain' }}
      >
        <source src="/splash.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

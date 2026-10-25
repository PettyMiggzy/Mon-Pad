import { useEffect, useRef, useState } from 'react';

const KEY = 'mp-splash';

/** Intro video, once per browser session. Click to skip. Reduced motion skips it. If the video can't play, it never blocks the site. */
export function Splash() {
  const [on, setOn] = useState(false);
  const [fading, setFading] = useState(false);
  const done = useRef(false);

  function dismiss() {
    if (done.current) return;
    done.current = true;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    setFading(true);
    window.setTimeout(() => setOn(false), 450);
  }

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sessionStorage.setItem(KEY, '1'); return; }
    } catch { return; }
    setOn(true);
    const safety = window.setTimeout(dismiss, 7000); // the clip is about 5s; this only covers a stalled load
    return () => window.clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!on) return null;
  return (
    <button type="button" aria-label="Skip intro" onClick={dismiss} className="pad-splash" style={{ background: '#090909', opacity: fading ? 0 : 1, transition: 'opacity 450ms ease-out', padding: 0 }}>
      <video
        autoPlay muted playsInline preload="auto" onEnded={dismiss} onError={dismiss}
        style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', WebkitMaskImage: 'radial-gradient(ellipse at center, #000 62%, transparent 100%)', maskImage: 'radial-gradient(ellipse at center, #000 62%, transparent 100%)' }}
      >
        <source src="/splash.mp4" type="video/mp4" />
      </video>
    </button>
  );
}

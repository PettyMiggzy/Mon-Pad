import { useEffect, useState } from 'react';

const KEY = 'mp-splash';

/** Once per browser session. Reduced-motion skips it. */
export function Splash() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        sessionStorage.setItem(KEY, '1');
        return;
      }
    } catch {
      return;
    }
    setOn(true);
    const t = window.setTimeout(dismiss, 1400);
    return () => window.clearTimeout(t);
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode */
    }
    setOn(false);
  }

  if (!on) return null;
  return (
    <button type="button" className="pad-splash" onClick={dismiss}>
      <img src="/meshy/monshi-mascot.webp" alt="" />
      <span>MONPAD</span>
      <small>Monad</small>
    </button>
  );
}

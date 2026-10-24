export type HeroMood = 'idle' | 'launch' | 'wave' | 'celebrate' | 'facepalm' | 'dance';

/** Shared with the canvas without forcing React re-renders every pointer move. */
export const heroBus = {
  mood: 'idle' as HeroMood,
  until: 0,
  lookLaunch: false,
  x: 0,
  y: 0,
  pointer: false,
  burnUntil: 0,
};

export function setHeroMood(mood: HeroMood, ms = 1800) {
  heroBus.mood = mood;
  heroBus.until = performance.now() + ms;
}

export function noteBurn(ms = 2200) {
  heroBus.burnUntil = performance.now() + ms;
}

export function currentMood(now: number): HeroMood {
  if (heroBus.lookLaunch && (heroBus.mood === 'idle' || now > heroBus.until)) return 'launch';
  if (now > heroBus.until) return 'idle';
  return heroBus.mood;
}

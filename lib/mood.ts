// lib/mood.ts — pure mapping from market data to a living coin's mood. Unit-testable, no React.

export type CoinMood = 'cheer' | 'happy' | 'idle' | 'droop' | 'fire';

export type MoodInput = {
  /** % price change over the shown window (positive = up). */
  change: number;
  /** A burn happened recently (last few minutes). */
  burnedRecently?: boolean;
  /** A large buy landed recently. */
  bigBuy?: boolean;
};

export function coinMood({ change, burnedRecently, bigBuy }: MoodInput): CoinMood {
  if (!Number.isFinite(change)) return 'idle';
  if (burnedRecently) return 'fire';
  if (bigBuy || change >= 25) return 'cheer';
  if (change >= 3) return 'happy';
  if (change <= -8) return 'droop';
  return 'idle';
}

/** Motion knobs per mood, consumed by the renderer. */
export const MOOD_MOTION: Record<CoinMood, { bob: number; speed: number; lean: number; glow: number }> = {
  cheer: { bob: 0.12, speed: 7, lean: 0, glow: 1.2 },
  happy: { bob: 0.06, speed: 3.2, lean: 0, glow: 0.7 },
  idle: { bob: 0.025, speed: 1.6, lean: 0, glow: 0.35 },
  droop: { bob: 0.012, speed: 1.0, lean: 0.28, glow: 0.1 },
  fire: { bob: 0.09, speed: 5, lean: 0, glow: 1.6 },
};

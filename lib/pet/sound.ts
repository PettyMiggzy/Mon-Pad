// Tiny synthesized sound effects (no audio files). Off by default; the choice is saved on the device.
const KEY = 'monshi-pet-sound';
let ctx: AudioContext | null = null;

export const soundOn = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } };

type Note = [freq: number, ms: number, type?: OscillatorType, gain?: number];
const SOUNDS: Record<string, Note[]> = {
  tap: [[520, 40, 'square', 0.05]],
  coin: [[880, 70, 'square', 0.06], [1320, 110, 'square', 0.06]],
  feed: [[300, 70, 'triangle', 0.12], [380, 70, 'triangle', 0.12], [300, 70, 'triangle', 0.12]],
  good: [[523, 90, 'triangle', 0.12], [659, 90, 'triangle', 0.12], [784, 160, 'triangle', 0.12]],
  levelup: [[523, 90, 'square', 0.07], [659, 90, 'square', 0.07], [784, 90, 'square', 0.07], [1047, 220, 'square', 0.07]],
  sad: [[392, 140, 'sine', 0.14], [311, 220, 'sine', 0.14]],
  nap: [[392, 160, 'sine', 0.1], [330, 160, 'sine', 0.1], [262, 260, 'sine', 0.1]],
};

export function play(name: keyof typeof SOUNDS) {
  if (!soundOn() || typeof window === 'undefined') return;
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    let t = ctx.currentTime;
    for (const [freq, ms, type = 'sine', gain = 0.1] of SOUNDS[name]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + ms / 1000);
      t += ms / 1000;
    }
  } catch { /* audio blocked: stay silent */ }
}

// The room and everything alive in it: Monshi roams, breathes, hops, reacts to taps, and shows action poses with effects.
import { useEffect, useRef, useState } from 'react';
import { PET, type Cosmetic, type Mood, type StageId } from '@/lib/pet/config';
import anchors from '@/lib/pet/anchors.json';

type Head = { cx: number; w: number; top: number; h: number; ratio: number };
const HEADS = anchors as Record<string, Head>;
const ITEM: Record<Cosmetic, { aspect: number; width: number }> = { beanie: { aspect: 0.94, width: 0.8 }, crown: { aspect: 0.85, width: 0.62 }, shades: { aspect: 0.36, width: 0.66 }, scarf: { aspect: 0.88, width: 0.66 }, cape: { aspect: 0.94, width: 2.0 } };
function place(item: Cosmetic, head: Head): React.CSSProperties {
  const { aspect, width } = ITEM[item];
  const w = head.w * width, hPct = w * head.ratio * aspect, slot = PET.cosmetics[item].slot;
  const top = slot === 'hat' ? head.top + 0.32 * head.h - hPct : slot === 'face' ? head.top + 0.53 * head.h - hPct / 2 : slot === 'neck' ? head.top + 1.0 * head.h - hPct * 0.15 : head.top + 0.9 * head.h;
  return { left: `${head.cx}%`, top: `${top}%`, width: `${w}%`, transform: 'translateX(-50%)' };
}

export type Pose = 'eat' | 'wash' | 'sleep' | null;
export type Fx = { key: number; emoji: string; n?: number } | null;
const STAND_PX: Record<StageId, number> = { kit: 168, teen: 203, adult: 238, legend: 261 };
const POSE_SCALE = { eat: 1.0, wash: 0.75, sleep: 0.55 } as const;
const POKE_LINES = ['Hey! Watch the suit.', 'Ha! That tickles.', 'Again? Fine. Again.', 'You got a reason for poking me, boss?', 'Careful, I bite. Gently.'];
const DIZZY = 'Okay okay, I’m dizzy!';
const clamp = (n: number) => Math.max(0.16, Math.min(0.84, n));
type Motion = 'idle' | 'walk' | 'hop' | 'wiggle' | 'stretch' | 'poke' | 'dizzy';

export default function PetStageView({ stage, mood, pose, equipped, fx, onPoke }: { stage: StageId; mood: Mood; pose: Pose; equipped: Cosmetic[]; fx: Fx; onPoke: (line: string) => void }) {
  const [x, setX] = useState(0.5);
  const xRef = useRef(0.5);
  const [face, setFace] = useState<1 | -1>(1);
  const [motion, setMotion] = useState<Motion>('idle');
  const [walkMs, setWalkMs] = useState(0);
  const [bits, setBits] = useState<{ id: number; emoji: string; dx: number }[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const pokes = useRef<number[]>([]);
  const idc = useRef(0);

  const spawn = (emoji: string, n = 1) => {
    const made = Array.from({ length: n }, () => ({ id: ++idc.current, emoji, dx: Math.round((Math.random() - 0.5) * 90) }));
    setBits((b) => [...b.slice(-14), ...made]);
    setTimeout(() => setBits((b) => b.filter((i) => !made.some((m) => m.id === i.id))), 1600);
  };
  useEffect(() => { if (fx) spawn(fx.emoji, fx.n ?? 3); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fx?.key]);

  // sleeping: a slow stream of Z's
  useEffect(() => { if (pose !== 'sleep') return; const id = setInterval(() => spawn('💤'), 1800); return () => clearInterval(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pose]);

  // roaming brain: walk somewhere, idle, maybe do a trick. Calm and slow when he feels bad, bouncy when happy.
  useEffect(() => {
    if (pose || mood === 'sulking') { xRef.current = 0.5; setX(0.5); setMotion('idle'); return; }
    let alive = true; let t: ReturnType<typeof setTimeout>;
    const tired = mood === 'sad' || mood === 'sleepy', happy = mood === 'happy';
    const next = () => {
      if (!alive) return;
      const r = Math.random();
      if (r < (tired ? 0.3 : 0.55)) {
        const nx = clamp(0.16 + Math.random() * 0.68), dist = Math.abs(nx - xRef.current);
        const ms = Math.max(1100, dist * (tired ? 14000 : 8000));
        setFace(nx > xRef.current ? 1 : -1); setWalkMs(ms); setMotion('walk'); xRef.current = nx; setX(nx);
        t = setTimeout(() => { if (!alive) return; setMotion('idle'); t = setTimeout(next, 1500 + Math.random() * 3000); }, ms);
      } else {
        const tricks: Motion[] = tired ? ['stretch'] : happy ? ['hop', 'hop', 'wiggle', 'stretch'] : ['hop', 'wiggle', 'stretch'];
        const m = tricks[Math.floor(Math.random() * tricks.length)];
        setMotion(m); if (m === 'hop' && happy) spawn('✨');
        t = setTimeout(() => { if (!alive) return; setMotion('idle'); t = setTimeout(next, 1800 + Math.random() * 3200); }, 1300);
      }
    };
    t = setTimeout(next, 700);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, mood, stage]);

  const poke = () => {
    const now = Date.now(); pokes.current = [...pokes.current.filter((t) => now - t < 4000), now];
    const dizzy = pokes.current.length >= 5;
    setMotion(dizzy ? 'dizzy' : 'poke'); spawn(dizzy ? '💫' : '💜', dizzy ? 3 : 2);
    onPoke(dizzy ? DIZZY : POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]);
    setTimeout(() => setMotion('idle'), dizzy ? 1200 : 600);
  };

  const wanted = pose ? `/pet/${stage}-${pose}.webp` : `/pet/${stage}-${mood}.webp`;
  const useWanted = !failed.includes(wanted);
  const src = useWanted ? wanted : `/pet/${stage}-${mood}.webp`;
  const heightPx = Math.round(STAND_PX[stage] * (pose && useWanted ? POSE_SCALE[pose] : 1));
  const head = !pose || !useWanted ? HEADS[`${stage}-${mood}`] : undefined;
  const breath = pose === 'sleep' ? 'pet-breathe-slow' : mood === 'sad' || mood === 'sleepy' ? 'pet-breathe-slow' : 'pet-breathe';
  const moveClass = pose === 'eat' ? 'pet-munch' : pose === 'wash' ? 'pet-scrub' : mood === 'sad' && motion === 'idle' ? 'pet-droop' : mood === 'hungry' && motion === 'idle' ? 'pet-rumble' : `pet-m-${motion}`;

  return (
    <div className="relative mx-auto my-2 h-[340px] w-full select-none overflow-hidden rounded-2xl" aria-label="Monshi's room">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[70px] bg-gradient-to-t from-[#120a20]/80 to-transparent" />
      <div className="absolute bottom-3 transition-[left] ease-linear" style={{ left: `${x * 100}%`, transitionDuration: `${motion === 'walk' ? walkMs : 0}ms`, transform: 'translateX(-50%)' }}>
        <div className="pet-shadow absolute -bottom-1 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-full bg-black/45 blur-[3px]" />
        <button type="button" onPointerDown={poke} aria-label="Poke Monshi" className="relative block cursor-pointer border-0 bg-transparent p-0 outline-none">
          <div className={moveClass} style={{ transformOrigin: '50% 100%', ['--face' as any]: face }}>
            <div className={breath} style={{ transformOrigin: '50% 100%' }}>
              <div className="relative inline-block" style={{ height: heightPx, transform: `scaleX(${face})` }}>
                <img src={src} alt={`Monshi is ${pose ?? mood}`} draggable={false} onError={() => setFailed((f) => [...f, wanted])} className="relative z-10 block h-full w-auto max-w-none" />
                {head && equipped.map((c) => <img key={c} src={`/pet/items/${c}.webp`} alt="" draggable={false} className={`pointer-events-none absolute ${PET.cosmetics[c].slot === 'back' ? 'z-0' : 'z-20'}`} style={place(c, head)} />)}
              </div>
            </div>
          </div>
          {mood === 'hungry' && !pose && <span className="pet-thought absolute -top-5 left-1/2 text-xl">💭🥛</span>}
          {bits.map((b) => <span key={b.id} className="pet-bit pointer-events-none absolute left-1/2 top-0 text-2xl" style={{ ['--dx' as any]: `${b.dx}px` }}>{b.emoji}</span>)}
        </button>
      </div>
    </div>
  );
}

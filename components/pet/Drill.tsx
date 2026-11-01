// The little mini-games. Each one reports a score from 0 to 100 through onDone.
import { useEffect, useRef, useState } from 'react';

type Props = { kind: 'tap' | 'memory' | 'beat'; seconds: number; target: number; title: string; hint: string; onDone: (score: number) => void; onCancel: () => void };

export default function Drill({ kind, seconds, target, title, hint, onDone, onCancel }: Props) {
  const [left, setLeft] = useState(seconds);
  const [taps, setTaps] = useState(0);
  const tapsRef = useRef(0);
  const done = useRef(false);
  const finish = (score: number) => { if (done.current) return; done.current = true; onDone(Math.max(0, Math.min(100, Math.round(score)))); };

  // countdown for tap + beat games (memory ends when the pattern is answered)
  useEffect(() => {
    if (kind === 'memory') return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - t0) / 1000));
      setLeft(l);
      if (l === 0) { clearInterval(id); finish((tapsRef.current / target) * 100); }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bump = () => { tapsRef.current += 1; setTaps(tapsRef.current); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-purple-300/20 bg-[#241632] p-5 text-center">
        <div className="text-xs font-black uppercase tracking-[.2em] text-purple-200/60">{title}</div>
        <p className="mt-1 text-sm text-purple-100/70">{hint}</p>
        {kind === 'tap' && (
          <>
            <div className="mt-3 text-3xl font-black">{left}s</div>
            <button type="button" onPointerDown={bump} className="mt-3 h-40 w-full select-none rounded-3xl bg-purple-500 text-5xl font-black active:scale-95">TAP!</button>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-purple-300" style={{ width: `${Math.min(100, (taps / target) * 100)}%` }} /></div>
          </>
        )}
        {kind === 'memory' && <Memory onFinish={finish} />}
        {kind === 'beat' && <Beat left={left} taps={taps} bump={bump} target={target} />}
        <button type="button" onClick={onCancel} className="mt-4 text-xs text-purple-100/50 underline">Cancel</button>
      </div>
    </div>
  );
}

const COLORS = ['#e879f9', '#60a5fa', '#34d399', '#fbbf24'];

function Memory({ onFinish }: { onFinish: (score: number) => void }) {
  const [seq] = useState(() => Array.from({ length: 5 }, () => Math.floor(Math.random() * 4)));
  const [lit, setLit] = useState<number | null>(null);
  const [showing, setShowing] = useState(true);
  const [answer, setAnswer] = useState<number[]>([]);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i >= seq.length * 2) { clearInterval(id); setLit(null); setShowing(false); return; }
      setLit(i % 2 === 0 ? seq[i / 2] : null); i++;
    }, 450);
    return () => clearInterval(id);
  }, [seq]);
  const press = (n: number) => {
    if (showing) return;
    const next = [...answer, n]; setAnswer(next);
    if (next.length === seq.length) onFinish((next.filter((v, i) => v === seq[i]).length / seq.length) * 100);
  };
  return (
    <div className="mt-4">
      <div className="mb-2 text-sm font-bold">{showing ? 'Watch the lights…' : `Your turn (${answer.length}/${seq.length})`}</div>
      <div className="grid grid-cols-2 gap-3">
        {COLORS.map((c, n) => <button key={n} type="button" onClick={() => press(n)} className="h-20 rounded-2xl" style={{ background: c, opacity: lit === n ? 1 : 0.4 }} aria-label={`light ${n + 1}`} />)}
      </div>
    </div>
  );
}

function Beat({ left, taps, bump, target }: { left: number; taps: number; bump: () => void; target: number }) {
  const [phase, setPhase] = useState(0);
  const hits = useRef(0);
  useEffect(() => { const id = setInterval(() => setPhase((p) => (p + 1) % 8), 150); return () => clearInterval(id); }, []);
  const inZone = phase >= 3 && phase <= 4;
  return (
    <div className="mt-3">
      <div className="text-3xl font-black">{left}s</div>
      <div className="my-3 flex justify-center gap-1">{Array.from({ length: 8 }, (_, i) => <span key={i} className="h-6 w-6 rounded-full" style={{ background: i >= 3 && i <= 4 ? '#facc15' : '#4c1d95', outline: i === phase ? '3px solid white' : 'none' }} />)}</div>
      <button type="button" onPointerDown={() => { if (inZone) { hits.current++; bump(); } }} className="h-24 w-full select-none rounded-3xl bg-pink-500 text-3xl font-black active:scale-95">TAP ON THE GOLD</button>
      <div className="mt-2 text-xs text-purple-100/60">{taps}/{target} perfect taps</div>
    </div>
  );
}

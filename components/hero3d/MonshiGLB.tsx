import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Quaternion, Euler, Vector3, type Bone, type Group, type Object3D } from 'three';
import { currentMood, heroBus, setHeroMood } from './bus';

export const MONSHI_GLB = '/models/monshi-hq.glb';

/** Monshi does a short "Hit the Quan" every so often while the hero is idle. Set false to switch it off. */
const AUTO_DANCE = true;

const damp = (a: number, b: number, k: number) => a + (b - a) * k;
const BONES = ['Head', 'neck', 'Spine01', 'Spine02', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'] as const;
type BoneName = (typeof BONES)[number];

/** The real Meshy-built Monshi. Head follows the cursor; arms and body react to hero moods. */
export function MonshiGLB({ height = 2.5, onLoaded }: { height?: number; onLoaded?: () => void }) {
  const { scene } = useGLTF(MONSHI_GLB);
  const root = useRef<Group>(null);

  const { model, bones, rest } = useMemo(() => {
    const m = scene;
    m.scale.setScalar(1);
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    const box = new Box3().setFromObject(m);
    const size = box.getSize(new Vector3());
    const s = height / Math.max(size.y, 0.001);
    m.scale.setScalar(s);
    m.updateMatrixWorld(true);
    const b2 = new Box3().setFromObject(m);
    const c = b2.getCenter(new Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z);
    const found: Partial<Record<BoneName, Object3D>> = {};
    const restQ: Partial<Record<BoneName, Quaternion>> = {};
    for (const n of BONES) {
      const o = m.getObjectByName(n);
      if (o) { found[n] = o; restQ[n] = o.quaternion.clone(); }
    }
    return { model: m, bones: found, rest: restQ };
  }, [scene, height]);

  useEffect(() => {
    model.traverse((o: any) => { if (o.isMesh) { o.frustumCulled = false; } });
    onLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Smoothed pose offsets (radians), applied on top of the rest pose every frame.
  const pose = useRef({ headY: 0, headX: 0, armR: 0, armL: 0, foreR: 0, hop: 0, sway: 0, relax: 1, dance: 0, nextDance: 0 });
  const tmp = useMemo(() => new Euler(), []);
  const q = useMemo(() => new Quaternion(), []);

  const apply = (name: BoneName, x: number, y: number, z: number) => {
    const b = bones[name] as Bone | undefined;
    const r = rest[name];
    if (!b || !r) return;
    tmp.set(x, y, z);
    q.setFromEuler(tmp);
    b.quaternion.copy(r).multiply(q);
  };

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const mood = currentMood(performance.now());
    const lookX = Math.max(-1, Math.min(1, heroBus.x));
    const lookY = Math.max(-1, Math.min(1, heroBus.y));
    const p = pose.current;

    const toLaunch = mood === 'launch';
    p.headY = damp(p.headY, toLaunch ? -0.7 : lookX * 0.75, 0.12);
    p.headX = damp(p.headX, mood === 'facepalm' ? 0.5 : -lookY * 0.35, 0.12);
    p.sway = damp(p.sway, Math.sin(t * 1.3) * 0.03, 0.1);

    const wave = mood === 'wave';
    const cheer = mood === 'celebrate';
    p.armR = damp(p.armR, wave ? 2.4 + Math.sin(t * 9) * 0.35 : cheer ? 2.6 : -0.75, 0.14);
    p.armL = damp(p.armL, cheer ? -2.6 : 0.75, 0.14);
    p.foreR = damp(p.foreR, wave ? 0.5 + Math.sin(t * 9) * 0.5 : mood === 'facepalm' ? 1.6 : 0, 0.14);
    p.hop = damp(p.hop, cheer ? Math.abs(Math.sin(t * 8)) * 0.18 : 0, 0.2);

    // Hands: the rest pose splays the fingers out, so twist them in (mirrored) to hang relaxed. Back off when the arms are busy.
    p.relax = damp(p.relax, wave || cheer || mood === 'facepalm' ? 0 : 1, 0.14);

    // "Hit the Quan": low stance, bounce on the beat, rock the upper body, shift weight side to side, swing the arms.
    // The model has no leg bones, so the knee bounce is the whole body dipping.
    const now = performance.now();
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (p.nextDance === 0) p.nextDance = now + 9000;
    if (AUTO_DANCE && !reduceMotion && mood === 'idle' && now > p.nextDance) {
      setHeroMood('dance', 7000);
      p.nextDance = now + 24000;
    }
    p.dance = damp(p.dance, mood === 'dance' ? 1 : 0, 0.08);
    const d = p.dance;
    const rock = Math.sin(t * Math.PI * 2); // rock forward and back once a second (120 bpm: two beats)
    const beat = Math.abs(Math.sin(t * Math.PI * 2)); // knee bounce on every beat
    const tap = Math.abs(Math.sin(t * Math.PI * 4)); // toe taps run double time
    const shift = Math.sin(t * Math.PI); // weight steps side to side every 2s
    const rowR = Math.sin(t * Math.PI * 2 + 0.5); // arms row front-to-back, the left half a beat behind
    const rowL = Math.sin(t * Math.PI * 2 - 0.1);

    apply('Head', p.headX - d * (0.16 + 0.08 * rock), p.headY * 0.6, 0);
    apply('neck', p.headX * 0.4, p.headY * 0.4, 0);
    apply('Spine01', Math.sin(t * 1.7) * 0.015 + d * (0.34 + 0.2 * rock), p.sway, d * 0.14 * shift);
    apply('Spine02', d * (0.12 + 0.1 * rock), p.headY * 0.15, 0);
    // y = twist about the arm so raised hands face each other instead of sideways
    apply('RightArm', d * (0.25 + 0.95 * rowR), -Math.max(0, p.armR) * 0.46, -p.armR - d * 0.1);
    apply('LeftArm', d * (0.25 + 0.95 * rowL), Math.max(0, -p.armL) * 0.46, -p.armL + d * 0.1);
    apply('RightForeArm', 0, 0, -p.foreR);
    apply('RightHand', 0, -0.9 * p.relax, 0);
    apply('LeftHand', 0, 0.9 * p.relax, 0);

    if (root.current) {
      // low stance, bounce on the beat, with a smaller double-time tap on top
      root.current.position.y = p.hop + Math.sin(t * 1.7) * 0.012 - d * (0.11 + 0.05 * beat + 0.015 * tap);
      root.current.position.x = d * 0.12 * shift;
      root.current.rotation.x = d * 0.05 * -rock; // hips push back as the chest rocks forward
      root.current.rotation.z = d * 0.05 * shift; // lean into each side step
    }
  });

  return (
    <group ref={root}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MONSHI_GLB);

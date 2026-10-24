import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Quaternion, Euler, Vector3, type Bone, type Group, type Object3D } from 'three';
import { currentMood, heroBus } from './bus';

export const MONSHI_GLB = '/models/monshi.glb';

const damp = (a: number, b: number, k: number) => a + (b - a) * k;
const BONES = ['Head', 'neck', 'Spine01', 'Spine02', 'RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm'] as const;
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
  const pose = useRef({ headY: 0, headX: 0, armR: 0, armL: 0, foreR: 0, hop: 0, sway: 0 });
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

    apply('Head', p.headX, p.headY * 0.6, 0);
    apply('neck', p.headX * 0.4, p.headY * 0.4, 0);
    apply('Spine01', Math.sin(t * 1.7) * 0.015, p.sway, 0);
    apply('Spine02', 0, p.headY * 0.15, 0);
    // y = twist about the arm so raised hands face each other instead of sideways
    apply('RightArm', 0, -Math.max(0, p.armR) * 0.46, -p.armR);
    apply('LeftArm', 0, Math.max(0, -p.armL) * 0.46, -p.armL);
    apply('RightForeArm', 0, 0, -p.foreR);

    if (root.current) root.current.position.y = p.hop + Math.sin(t * 1.7) * 0.012;
  });

  return (
    <group ref={root}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MONSHI_GLB);

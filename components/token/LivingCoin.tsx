import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3, type Group } from 'three';
import { MOOD_MOTION, type CoinMood } from '@/lib/mood';

type Props = { glb: string; mood?: CoinMood; height?: number };

function Model({ glb, mood }: { glb: string; mood: CoinMood }) {
  const { scene } = useGLTF(glb);
  const root = useRef<Group>(null);
  const cursor = useRef({ x: 0, y: 0 });

  // Fit any model to the same visual height and stand it on y = 0.
  const fitted = useMemo(() => {
    const clone = scene.clone(true);
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const scale = 1.6 / Math.max(size.y, 0.001);
    clone.scale.setScalar(scale);
    const b2 = new Box3().setFromObject(clone);
    const c = b2.getCenter(new Vector3());
    clone.position.set(-c.x, -b2.min.y, -c.z);
    return clone;
  }, [scene]);

  useFrame((state, dt) => {
    if (!root.current) return;
    const m = MOOD_MOTION[mood];
    const t = state.clock.elapsedTime;
    cursor.current.x += (state.pointer.x - cursor.current.x) * Math.min(1, dt * 4);
    cursor.current.y += (state.pointer.y - cursor.current.y) * Math.min(1, dt * 4);
    root.current.position.y = Math.abs(Math.sin(t * m.speed)) * m.bob;
    root.current.rotation.y = cursor.current.x * 0.6;            // looks toward the cursor
    root.current.rotation.x = m.lean + cursor.current.y * -0.12;  // droops when the chart is down
    root.current.rotation.z = mood === 'cheer' ? Math.sin(t * 9) * 0.06 : 0;
  });

  return <group ref={root}><primitive object={fitted} /></group>;
}

/** The token's 3D character. Mount it client-only (dynamic import, ssr: false). */
export default function LivingCoin({ glb, mood = 'idle', height = 260 }: Props) {
  const glow = MOOD_MOTION[mood].glow;
  return (
    <div style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 80%, rgba(181,123,255,0.28), transparent 65%)' }}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1, 3.4], fov: 35 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.7 + glow * 0.3} />
        <directionalLight position={[2, 3, 3]} intensity={1.4} />
        <pointLight position={[-2, 1, 2]} intensity={glow * 2} color="#ff4d9a" />
        <Suspense fallback={null}>
          <Model glb={glb} mood={mood} />
        </Suspense>
      </Canvas>
    </div>
  );
}

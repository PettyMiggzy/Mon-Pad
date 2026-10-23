'use client';

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Center, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

const MODEL = '/meshy/chart-console.glb';

function Rig() {
  const ref = useRef<Group>(null);
  const { scene } = useGLTF(MODEL);
  const model = useMemo(() => scene.clone(true), [scene]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.28;
    ref.current.position.y = Math.sin(performance.now() / 900) * 0.06;
  });
  return (
    <Center>
      <group ref={ref} scale={1.15}>
        <primitive object={model} />
      </group>
    </Center>
  );
}

/** Meshy trading console — the home stage object, not another flat mascot. */
export default function HeroConsole() {
  return (
    <div className="nx-console" aria-hidden>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [1.6, 1.1, 2.8], fov: 36 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={['#00000000']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 2]} intensity={1.3} color="#F6F0FF" />
        <pointLight position={[-2, 1, 1]} intensity={0.8} color="#FF4D9A" distance={8} />
        <Suspense fallback={null}>
          <Rig />
        </Suspense>
      </Canvas>
    </div>
  );
}

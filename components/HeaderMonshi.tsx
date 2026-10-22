'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Group } from 'three';

const MODEL = '/meshy/monchi-idol-preview.glb';

/**
 * Header character — not a spinning favicon.
 * Tracks the pointer, breathes, and leans like it's working the board.
 */
function Performer() {
  const ref = useRef<Group>(null);
  const aim = useRef({ x: 0.35, y: 0 });
  const { scene } = useGLTF(MODEL);
  const model = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      aim.current.x = (e.clientX / window.innerWidth - 0.5) * 1.15;
      aim.current.y = (e.clientY / window.innerHeight - 0.5) * 0.45;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 4.2);
    const yaw = aim.current.x + Math.sin(t * 0.55) * 0.18;
    const pitch = -aim.current.y * 0.35 + Math.sin(t * 1.4) * 0.05;
    g.rotation.y += (yaw - g.rotation.y) * k;
    g.rotation.x += (pitch - g.rotation.x) * k;
    g.rotation.z = Math.sin(t * 0.8) * 0.07;
    g.position.y = Math.sin(t * 1.7) * 0.08;
  });

  return (
    <group ref={ref} position={[0, -0.85, 0]} scale={1.35} rotation={[0.05, 0.4, 0]}>
      <primitive object={model} />
    </group>
  );
}

export default function HeaderMonshi() {
  useEffect(() => {
    try { useGLTF.preload(MODEL); } catch { /* ignore */ }
  }, []);

  return (
    <div className="nx-stage" role="img" aria-label="Monshi">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.15, 2.55], fov: 32 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[2.4, 3.2, 2]} intensity={1.45} color="#F4ECFF" />
        <directionalLight position={[-2, 0.6, -1]} intensity={0.55} color="#FF4D9A" />
        <pointLight position={[0, 1.2, 1.6]} intensity={0.9} color="#B57BFF" distance={6} />
        <Suspense fallback={null}>
          <Performer />
        </Suspense>
      </Canvas>
    </div>
  );
}

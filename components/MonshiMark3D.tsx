'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Center, Environment, Float, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

const MODEL = '/meshy/monchi-idol-preview.glb';
const FALLBACK = '/meshy/monshi-mascot.png';

function Idol({ spin }: { spin: boolean }) {
  const ref = useRef<Group>(null);
  const { scene } = useGLTF(MODEL);
  useFrame((_, dt) => {
    if (!spin || !ref.current) return;
    ref.current.rotation.y += dt * 0.55;
  });
  return (
    <Float speed={1.35} rotationIntensity={0.12} floatIntensity={0.32}>
      <Center>
        <group ref={ref} scale={1.12} rotation={[0.1, -0.4, 0]}>
          <primitive object={scene.clone()} />
        </group>
      </Center>
    </Float>
  );
}

type Props = {
  size?: number;
  spin?: boolean;
  className?: string;
};

/**
 * Meshy Monshi idol in the chrome — same purple street palette as the 2D cutout.
 * Client-only (WebGL). Falls back to the transparent PNG while the GLB boots.
 */
export default function MonshiMark3D({ size = 44, spin = true, className }: Props) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      useGLTF.preload(MODEL);
      if (alive) setReady(true);
    } catch {
      if (alive) setFailed(true);
    }
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className}
        src={FALLBACK}
        alt="Monshi"
        width={size}
        height={size}
        draggable={false}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          filter: 'drop-shadow(0 6px 18px rgba(181,123,255,0.5))',
        }}
      />
    );
  }

  return (
    <div
      className={className}
      role="img"
      aria-label="Monshi"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.28),
        overflow: 'hidden',
        position: 'relative',
        background:
          'radial-gradient(circle at 35% 28%, rgba(181,123,255,0.4), transparent 58%), #0a0612',
        boxShadow:
          '0 0 0 1px rgba(181,123,255,0.28), 0 10px 28px rgba(181,123,255,0.32), inset 0 0 24px rgba(255,77,154,0.12)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={FALLBACK}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          padding: size > 56 ? 8 : 4,
          opacity: ready ? 0.2 : 0.85,
          transition: 'opacity 0.4s ease',
          pointerEvents: 'none',
          filter: 'drop-shadow(0 4px 12px rgba(181,123,255,0.4))',
        }}
      />
      {ready ? (
        <Canvas
          dpr={[1, 1.6]}
          camera={{ position: [0, 0.12, 2.3], fov: 30 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          style={{ position: 'absolute', inset: 0 }}
          onCreated={() => setFailed(false)}
          onError={() => setFailed(true)}
        >
          <ambientLight intensity={0.55} />
          <directionalLight position={[3, 4, 2]} intensity={1.3} color="#F0E6FF" />
          <directionalLight position={[-2.5, 1, -2]} intensity={0.5} color="#FF4D9A" />
          <pointLight position={[0, 1.1, 2]} intensity={0.85} color="#B57BFF" distance={5} />
          <Suspense fallback={null}>
            <Idol spin={spin} />
            <Environment preset="city" />
          </Suspense>
        </Canvas>
      ) : null}
    </div>
  );
}

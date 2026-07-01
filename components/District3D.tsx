// components/District3D.tsx — "Monshi District" (Phase-0 land mock, high detail).
// A bounded neon city: plots on a grid, a central Trending Stage + Monshi idol at
// the hub, prime plots glowing gold nearest the hub, owned plots built up into
// towers with token signage. Click a plot → its panel. All mock/visual (no chain).
// Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sparkles, useTexture, Billboard } from '@react-three/drei';
import { Suspense, useRef, useState } from 'react';
import * as THREE from 'three';

const BRAND = '#8B5CF6', GOLD = '#FFD700', GREEN = '#4ADE80';

export type Plot = {
  id: string; i: number; j: number; x: number; z: number;
  zone: 'prime' | 'standard' | 'outer';
  owned: boolean; pfp: number; height: number; forRent: boolean; price: number; name: string;
};

const ZONE: Record<Plot['zone'], { base: string; em: string; hi: string; neon: string }> = {
  prime: { base: '#3a2d10', em: GOLD, hi: '#fff2a8', neon: GOLD },
  standard: { base: '#241b3a', em: BRAND, hi: '#c4b5fd', neon: BRAND },
  outer: { base: '#161226', em: '#4b3f6e', hi: '#8b7fb0', neon: '#6d5fa0' },
};

const PFP_URLS = Array.from({ length: 16 }, (_, i) => `/mock/pfp${String(i + 1).padStart(2, '0')}.png`);

function PlotTile({ plot, tex, onSelect }: { plot: Plot; tex: THREE.Texture | null; onSelect: (p: Plot) => void }) {
  const [hover, setHover] = useState(false);
  const z = ZONE[plot.zone];
  const roof = plot.forRent ? GREEN : z.neon;
  return (
    <group
      position={[plot.x, 0, plot.z]}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); onSelect(plot); }}
    >
      {/* plot pad */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.92, 1.92]} />
        <meshStandardMaterial
          color={plot.owned ? '#0e0a18' : z.base}
          emissive={hover ? z.hi : z.em}
          emissiveIntensity={hover ? 1.3 : plot.owned ? 0.12 : 0.55}
          metalness={0.3} roughness={0.6}
        />
      </mesh>

      {plot.owned ? (
        <group>
          {/* tower */}
          <mesh position={[0, plot.height / 2, 0]} castShadow>
            <boxGeometry args={[1.5, plot.height, 1.5]} />
            <meshStandardMaterial color="#15102a" metalness={0.65} roughness={0.32} emissive={z.em} emissiveIntensity={0.14} />
          </mesh>
          {/* neon roof line (green if rentable) */}
          <mesh position={[0, plot.height + 0.05, 0]}>
            <boxGeometry args={[1.56, 0.09, 1.56]} />
            <meshBasicMaterial color={roof} toneMapped={false} />
          </mesh>
          {/* token sign */}
          {tex && (
            <Billboard position={[0, plot.height + 1.05, 0]}>
              <mesh position={[0, 0, -0.02]}><planeGeometry args={[1.36, 1.36]} /><meshBasicMaterial color={roof} toneMapped={false} /></mesh>
              <mesh><planeGeometry args={[1.18, 1.18]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
            </Billboard>
          )}
        </group>
      ) : (
        // available marker (small floating pip; gold pulse handled by emissive)
        <mesh position={[0, 0.35, 0]} scale={hover ? 1.4 : 1}>
          <octahedronGeometry args={[0.16, 0]} />
          <meshBasicMaterial color={z.neon} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Hub() {
  const tex = useTexture('/monshi-statue.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const idol = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (idol.current) idol.current.position.y = 4.4 + Math.sin(t * 0.8) * 0.2;
    if (ring.current) ring.current.rotation.z = t * 0.2;
  });
  const img = tex.image as { width: number; height: number } | undefined;
  const aspect = img && img.width ? img.width / img.height : 0.6;
  const H = 6, W = H * aspect;
  return (
    <group>
      {/* platform */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <cylinderGeometry args={[3.2, 3.6, 0.5, 48]} />
        <meshStandardMaterial color="#1a1330" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh ref={ring} position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.1, 0.09, 12, 64]} />
        <meshBasicMaterial color={GOLD} toneMapped={false} />
      </mesh>
      {/* stage beam */}
      <mesh position={[0, 8, 0]}>
        <cylinderGeometry args={[0.6, 2.6, 16, 24, 1, true]} />
        <meshBasicMaterial color={BRAND} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <pointLight position={[0, 6, 0]} intensity={2.6} color={BRAND} distance={40} decay={1.1} />
      <Sparkles count={50} scale={[7, 8, 7]} size={6} speed={0.3} color={BRAND} position={[0, 4, 0]} />
      {/* Monshi idol */}
      <Billboard>
        <group ref={idol} position={[0, 4.4, 0]}>
          <mesh position={[0, 0, -0.3]}><circleGeometry args={[4.2, 40]} /><meshBasicMaterial color={BRAND} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
          <mesh><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} /></mesh>
        </group>
      </Billboard>
    </group>
  );
}

function Scene({ plots, onSelect }: { plots: Plot[]; onSelect: (p: Plot) => void }) {
  const textures = useTexture(PFP_URLS) as THREE.Texture[];
  textures.forEach((t) => (t.colorSpace = THREE.SRGBColorSpace));
  return (
    <>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 34, 90]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[14, 24, 10]} intensity={0.7} color="#b7a6ff" />
      <pointLight position={[-18, 10, -18]} intensity={0.6} color={GOLD} distance={70} />
      <Stars radius={140} depth={60} count={2400} factor={4} fade speed={0.3} />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#080511" metalness={0.4} roughness={0.85} />
      </mesh>
      <gridHelper args={[120, 60, '#2a1f4a', '#120c22']} position={[0, -0.06, 0]} />

      <Hub />
      {plots.map((p) => (
        <PlotTile key={p.id} plot={p} tex={p.owned ? textures[p.pfp - 1] : null} onSelect={onSelect} />
      ))}
    </>
  );
}

export default function District3D({ plots, onSelect }: { plots: Plot[]; onSelect: (p: Plot) => void }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 24, 32], fov: 46 }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}><Scene plots={plots} onSelect={onSelect} /></Suspense>
      <OrbitControls enablePan={false} minDistance={14} maxDistance={70} maxPolarAngle={Math.PI / 2.15} autoRotate autoRotateSpeed={0.25} makeDefault target={[0, 1, 0]} />
    </Canvas>
  );
}

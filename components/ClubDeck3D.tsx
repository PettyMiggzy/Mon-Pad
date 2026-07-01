// components/ClubDeck3D.tsx — "Monshi Club" members deck (3D).
// You've passed the gate; the camera is inside Monshi's inner ring. Perk stations
// orbit the idol as glowing nodes with holographic cards — click one to open its
// panel. Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Html, Sparkles, useTexture, Billboard } from '@react-three/drei';
import { Suspense, useRef, useState } from 'react';
import * as THREE from 'three';

const BRAND = '#8B5CF6', GOLD = '#FFD700';
const TAU = Math.PI * 2;

export type Station = { key: string; icon: string; title: string; sub: string; color: string };

function MonshiIdol() {
  const tex = useTexture('/monshi-statue.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = 2 + Math.sin(clock.elapsedTime * 0.8) * 0.2; });
  const img = tex.image as { width: number; height: number } | undefined;
  const aspect = img && img.width ? img.width / img.height : 0.6;
  const H = 8, W = H * aspect;
  return (
    <group>
      <pointLight position={[0, 3, 5]} intensity={2.4} color={BRAND} distance={90} decay={1.1} />
      <Sparkles count={44} scale={10} size={6} speed={0.3} color={BRAND} />
      <Billboard>
        <mesh position={[0, 2, -0.5]}><circleGeometry args={[6, 48]} /><meshBasicMaterial color={BRAND} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
        <group ref={ref}>
          <mesh><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} /></mesh>
        </group>
      </Billboard>
    </group>
  );
}

// The membership ring — the barrier you just passed, now glowing gold (you're in).
function MembershipRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.z = clock.elapsedTime * 0.15; });
  return (
    <group position={[0, -1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh ref={ref}><torusGeometry args={[5.2, 0.08, 12, 90]} /><meshBasicMaterial color={GOLD} toneMapped={false} /></mesh>
      <mesh><torusGeometry args={[6.6, 0.03, 8, 90]} /><meshBasicMaterial color={BRAND} transparent opacity={0.5} toneMapped={false} /></mesh>
    </group>
  );
}

function StationNode({ station, pos, onOpen }: { station: Station; pos: [number, number, number]; onOpen: (k: string) => void }) {
  const [hover, setHover] = useState(false);
  const node = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (node.current) { node.current.rotation.y += 0.02; node.current.position.y = Math.sin(clock.elapsedTime + pos[0]) * 0.15; }
  });
  return (
    <group position={pos}>
      <mesh ref={node} scale={hover ? 1.25 : 1}>
        <icosahedronGeometry args={[0.55, 0]} />
        <meshStandardMaterial color={station.color} emissive={station.color} emissiveIntensity={hover ? 1.4 : 0.8} metalness={0.4} roughness={0.3} toneMapped={false} />
      </mesh>
      <Html center distanceFactor={13} position={[0, 1.6, 0]} zIndexRange={[20, 0]}>
        <div
          onClick={() => onOpen(station.key)}
          onMouseEnter={() => { setHover(true); document.body.style.cursor = 'pointer'; }}
          onMouseLeave={() => { setHover(false); document.body.style.cursor = 'auto'; }}
          style={{
            width: 150, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', userSelect: 'none',
            background: 'rgba(12,8,22,0.92)', border: `1.5px solid ${station.color}`,
            color: '#fff', fontFamily: 'system-ui, sans-serif', textAlign: 'center',
            boxShadow: `0 0 18px ${station.color}55`, transform: hover ? 'scale(1.06)' : 'scale(1)', transition: 'transform .12s',
          }}
        >
          <div style={{ fontSize: 26, lineHeight: 1 }}>{station.icon}</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 4 }}>{station.title}</div>
          <div style={{ fontSize: 11, color: '#9aa4b2', marginTop: 2 }}>{station.sub}</div>
        </div>
      </Html>
    </group>
  );
}

export default function ClubDeck3D({ stations, onOpen }: { stations: Station[]; onOpen: (k: string) => void }) {
  const R = 9.5;
  const placed = stations.map((s, i) => {
    const a = (i / stations.length) * TAU;
    return { s, pos: [Math.cos(a) * R, 0.5, Math.sin(a) * R] as [number, number, number] };
  });
  return (
    <Canvas camera={{ position: [0, 7, 21], fov: 50 }} dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 30, 80]} />
      <ambientLight intensity={0.5} />
      <Stars radius={130} depth={55} count={2600} factor={4} fade speed={0.4} />
      <gridHelper args={[90, 44, '#2a1f4a', '#160f28']} position={[0, -3.2, 0]} />
      <Suspense fallback={null}><MonshiIdol /></Suspense>
      <MembershipRing />
      {placed.map(({ s, pos }) => <StationNode key={s.key} station={s} pos={pos} onOpen={onOpen} />)}
      <OrbitControls enablePan={false} minDistance={11} maxDistance={44} autoRotate autoRotateSpeed={0.35} maxPolarAngle={Math.PI / 2.05} makeDefault />
    </Canvas>
  );
}

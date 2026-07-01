// components/LaunchBay3D.tsx
// 3D "Launch Bay" preview — each token is a rocket on a pad. Fuel gauge = bonding
// progress; boosted tokens glow gold; graduated tokens have lifted off. Click a
// rocket to open its token page. Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Float, Html, Sparkles } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

export type Rocket = {
  name: string;
  symbol: string;
  address: string;
  progress: number;   // 0..1
  graduated: boolean;
  boosted?: boolean;
  mcMon?: number;
};

const BRAND = '#8B5CF6';
const GOLD = '#FFD700';
const GREEN = '#4ADE80';

function FuelGauge({ progress }: { progress: number }) {
  const h = 1.6;
  const fill = Math.max(0.02, Math.min(1, progress)) * h;
  const col = progress >= 1 ? GREEN : progress >= 0.95 ? GOLD : BRAND;
  return (
    <group position={[0.95, 0.2, 0]}>
      {/* housing */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[0.16, h, 0.16]} />
        <meshStandardMaterial color="#241b3a" transparent opacity={0.6} />
      </mesh>
      {/* fill */}
      <mesh position={[0, fill / 2, 0]}>
        <boxGeometry args={[0.2, fill, 0.2]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.1} />
      </mesh>
    </group>
  );
}

function RocketModel({ color, glow }: { color: string; glow: number }) {
  return (
    <group>
      {/* body */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.4, 1.5, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} metalness={0.4} roughness={0.35} />
      </mesh>
      {/* nose */}
      <mesh position={[0, 1.85, 0]} castShadow>
        <coneGeometry args={[0.34, 0.7, 24]} />
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={glow * 0.6} metalness={0.5} roughness={0.3} />
      </mesh>
      {/* window */}
      <mesh position={[0, 1.15, 0.34]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#8fd8ff" emissive="#66ccff" emissiveIntensity={1.4} />
      </mesh>
      {/* fins */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i / 3) * Math.PI * 2) * 0.36, 0.2, Math.cos((i / 3) * Math.PI * 2) * 0.36]} rotation={[0, (i / 3) * Math.PI * 2, 0.35]}>
          <coneGeometry args={[0.16, 0.5, 4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} />
        </mesh>
      ))}
    </group>
  );
}

function Exhaust() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 0.7 + Math.sin(clock.elapsedTime * 20) * 0.25;
      ref.current.scale.set(1, s, 1);
    }
  });
  return (
    <mesh ref={ref} position={[0, -0.4, 0]}>
      <coneGeometry args={[0.3, 1.2, 16, 1, true]} />
      <meshBasicMaterial color="#ff9a3c" transparent opacity={0.75} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Pad() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <cylinderGeometry args={[1.1, 1.25, 0.16, 6]} />
        <meshStandardMaterial color="#1a1330" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <torusGeometry args={[0.95, 0.03, 8, 6]} />
        <meshStandardMaterial color={BRAND} emissive={BRAND} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function RocketCell({ rocket, position }: { rocket: Rocket; position: [number, number, number] }) {
  const grp = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const color = rocket.boosted ? GOLD : rocket.graduated ? GREEN : BRAND;
  const glow = rocket.boosted ? 1.3 : rocket.graduated ? 0.9 : 0.5 + rocket.progress * 0.6;
  const lift = rocket.graduated ? 1.6 : 0; // graduated = lifted off
  const speed = useMemo(() => 0.6 + Math.random() * 0.6, []);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(({ clock }) => {
    if (!grp.current) return;
    const t = clock.elapsedTime * speed + phase;
    grp.current.position.y = position[1] + lift + Math.sin(t) * (rocket.graduated ? 0.18 : 0.06);
    grp.current.rotation.y += 0.003;
  });

  const scale = hover ? 1.12 : 1;
  return (
    <group position={position}>
      <Pad />
      <group
        ref={grp}
        scale={scale}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); if (rocket.address) window.location.href = `/token/${rocket.address}`; }}
      >
        <RocketModel color={color} glow={glow} />
        {rocket.graduated && <Exhaust />}
        {rocket.boosted && <Sparkles count={24} scale={2.4} size={4} speed={0.5} color={GOLD} />}
        <Html position={[0, 2.7, 0]} center distanceFactor={12} occlude>
          <div style={{
            padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', pointerEvents: 'none',
            background: 'rgba(10,6,20,0.8)', border: `1px solid ${color}`,
            color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
            boxShadow: `0 0 12px ${color}`,
          }}>
            {rocket.boosted ? '🚀 ' : ''}${rocket.symbol}
            <span style={{ color: '#9aa4b2', fontWeight: 500 }}>
              {rocket.graduated ? ' · LAUNCHED' : ` · ${Math.round(rocket.progress * 100)}%`}
            </span>
          </div>
        </Html>
      </group>
      {!rocket.graduated && <FuelGauge progress={rocket.progress} />}
    </group>
  );
}

function Bay({ rockets }: { rockets: Rocket[] }) {
  // arrange on a grid
  const cols = Math.ceil(Math.sqrt(rockets.length)) || 1;
  const gap = 3.4;
  const cells = rockets.map((r, i) => {
    const cx = i % cols, cz = Math.floor(i / cols);
    const x = (cx - (cols - 1) / 2) * gap;
    const z = (cz - (Math.ceil(rockets.length / cols) - 1) / 2) * gap;
    return { r, pos: [x, 0, z] as [number, number, number] };
  });
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#0a0614" metalness={0.2} roughness={0.9} />
      </mesh>
      <gridHelper args={[100, 50, '#2a1f4a', '#160f28']} position={[0, -0.14, 0]} />
      {cells.map(({ r, pos }) => <RocketCell key={r.address || r.symbol} rocket={r} position={pos} />)}
    </group>
  );
}

export default function LaunchBay3D({ rockets }: { rockets: Rocket[] }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 6, 14], fov: 50 }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 18, 46]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} castShadow />
      <pointLight position={[0, 8, 0]} intensity={0.8} color={BRAND} />
      <Stars radius={80} depth={40} count={4000} factor={4} fade speed={1} />
      <Float rotationIntensity={0.15} floatIntensity={0.2} speed={1}>
        <Bay rockets={rockets} />
      </Float>
      <OrbitControls enablePan={false} minDistance={6} maxDistance={30} maxPolarAngle={Math.PI / 2.1} autoRotate autoRotateSpeed={0.4} />
    </Canvas>
  );
}

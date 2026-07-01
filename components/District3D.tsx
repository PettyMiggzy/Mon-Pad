// components/District3D.tsx — "Mon-Pad City, powered by MONSHI" (Phase-0 mock, high detail).
// A large zoned city: dense Downtown skyline around the central Trending Stage,
// then Business, Residential, and Entertainment districts sprawling outward.
// Buildings are GPU-instanced (towers + neon roofs) so the whole city stays smooth;
// a curated set of premium plots gets token signage. Click a plot → its panel.
// All mock/visual. Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sparkles, useTexture, Billboard } from '@react-three/drei';
import { Suspense, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

const BRAND = '#8B5CF6', GOLD = '#FFD700';

export type District = 'downtown' | 'business' | 'residential' | 'entertainment';
export type Plot = {
  id: string; i: number; j: number; x: number; z: number;
  district: District; biz: string; owned: boolean; pfp: number;
  height: number; forRent: boolean; price: number; name: string;
  color: string; neon: string;
};

const PFP_URLS = Array.from({ length: 16 }, (_, i) => `/mock/pfp${String(i + 1).padStart(2, '0')}.png`);
const RING = { downtown: 14, business: 24, residential: 33 };
const RING_COLOR: Record<District, string> = { downtown: GOLD, business: BRAND, residential: '#2dd4bf', entertainment: '#ff4fd8' };

function Towers({ owned, moveHover, onSelect }: { owned: Plot[]; moveHover: (p: Plot | null) => void; onSelect: (p: Plot) => void }) {
  const towers = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const tm = towers.current, rm = roofs.current, d = new THREE.Object3D();
    if (!tm || !rm) return;
    owned.forEach((p, k) => {
      d.position.set(p.x, p.height / 2, p.z); d.scale.set(1.55, p.height, 1.55); d.rotation.set(0, 0, 0); d.updateMatrix();
      tm.setMatrixAt(k, d.matrix); tm.setColorAt(k, new THREE.Color(p.color));
      d.position.set(p.x, p.height + 0.07, p.z); d.scale.set(1.62, 0.14, 1.62); d.updateMatrix();
      rm.setMatrixAt(k, d.matrix); rm.setColorAt(k, new THREE.Color(p.forRent ? '#4ADE80' : p.neon));
    });
    tm.instanceMatrix.needsUpdate = true; rm.instanceMatrix.needsUpdate = true;
    if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
    if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
  }, [owned]);
  if (owned.length === 0) return null;
  return (
    <group>
      <instancedMesh
        ref={towers} args={[undefined as any, undefined as any, owned.length]} castShadow
        onPointerMove={(e) => { e.stopPropagation(); if (e.instanceId != null) moveHover(owned[e.instanceId]); }}
        onPointerOut={() => moveHover(null)}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId != null) onSelect(owned[e.instanceId]); }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial metalness={0.7} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[undefined as any, undefined as any, owned.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Lots({ avail, moveHover, onSelect }: { avail: Plot[]; moveHover: (p: Plot | null) => void; onSelect: (p: Plot) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current, d = new THREE.Object3D();
    if (!m) return;
    avail.forEach((p, k) => {
      d.position.set(p.x, 0.04, p.z); d.scale.set(1.9, 0.08, 1.9); d.updateMatrix();
      m.setMatrixAt(k, d.matrix); m.setColorAt(k, new THREE.Color(p.neon));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [avail]);
  if (avail.length === 0) return null;
  return (
    <instancedMesh
      ref={ref} args={[undefined as any, undefined as any, avail.length]}
      onPointerMove={(e) => { e.stopPropagation(); if (e.instanceId != null) moveHover(avail[e.instanceId]); }}
      onPointerOut={() => moveHover(null)}
      onClick={(e) => { e.stopPropagation(); if (e.instanceId != null) onSelect(avail[e.instanceId]); }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial emissiveIntensity={0.6} metalness={0.3} roughness={0.7} />
    </instancedMesh>
  );
}

function Signs({ signs, textures }: { signs: Plot[]; textures: THREE.Texture[] }) {
  return (
    <>
      {signs.map((p) => (
        <Billboard key={p.id} position={[p.x, p.height + 1.1, p.z]}>
          <mesh position={[0, 0, -0.02]}><planeGeometry args={[1.4, 1.4]} /><meshBasicMaterial color={p.forRent ? '#4ADE80' : p.neon} toneMapped={false} /></mesh>
          <mesh><planeGeometry args={[1.2, 1.2]} /><meshBasicMaterial map={textures[p.pfp - 1]} toneMapped={false} /></mesh>
        </Billboard>
      ))}
    </>
  );
}

function DistrictRings() {
  const bands: [number, number, District][] = [
    [5.5, RING.downtown, 'downtown'],
    [RING.downtown, RING.business, 'business'],
    [RING.business, RING.residential, 'residential'],
    [RING.residential, 46, 'entertainment'],
  ];
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
      {bands.map(([r0, r1, d]) => (
        <mesh key={d}><ringGeometry args={[r0, r1, 72]} /><meshBasicMaterial color={RING_COLOR[d]} transparent opacity={0.06} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      ))}
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
    if (idol.current) idol.current.position.y = 5.6 + Math.sin(t * 0.8) * 0.2;
    if (ring.current) ring.current.rotation.z = t * 0.2;
  });
  const img = tex.image as { width: number; height: number } | undefined;
  const aspect = img && img.width ? img.width / img.height : 0.6;
  const H = 7, W = H * aspect;
  return (
    <group>
      <mesh position={[0, 0.25, 0]} receiveShadow><cylinderGeometry args={[4, 4.5, 0.6, 56]} /><meshStandardMaterial color="#1a1330" metalness={0.7} roughness={0.35} /></mesh>
      <mesh ref={ring} position={[0, 0.6, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.9, 0.1, 12, 72]} /><meshBasicMaterial color={GOLD} toneMapped={false} /></mesh>
      <mesh position={[0, 10, 0]}><cylinderGeometry args={[0.8, 3.2, 20, 24, 1, true]} /><meshBasicMaterial color={BRAND} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      <pointLight position={[0, 7, 0]} intensity={3} color={BRAND} distance={50} decay={1.1} />
      <Sparkles count={60} scale={[9, 10, 9]} size={6} speed={0.3} color={BRAND} position={[0, 5, 0]} />
      <Billboard>
        <group ref={idol} position={[0, 5.6, 0]}>
          <mesh position={[0, 0, -0.3]}><circleGeometry args={[5, 40]} /><meshBasicMaterial color={BRAND} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
          <mesh><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} /></mesh>
        </group>
      </Billboard>
    </group>
  );
}

function Scene({ plots, onSelect }: { plots: Plot[]; onSelect: (p: Plot) => void }) {
  const textures = useTexture(PFP_URLS) as THREE.Texture[];
  textures.forEach((t) => (t.colorSpace = THREE.SRGBColorSpace));
  const owned = plots.filter((p) => p.owned);
  const avail = plots.filter((p) => !p.owned);
  // Sign only the priciest ~28 owned plots (downtown premium) — keeps billboards low.
  const signs = [...owned].sort((a, b) => b.price - a.price).slice(0, 28);
  const hover = useRef<THREE.Mesh>(null);
  const moveHover = (p: Plot | null) => {
    const m = hover.current; if (!m) return;
    if (p) {
      if (p.owned) { m.position.set(p.x, p.height / 2, p.z); m.scale.set(1.7, p.height, 1.7); }
      else { m.position.set(p.x, 0.14, p.z); m.scale.set(2, 0.22, 2); }
      m.visible = true; document.body.style.cursor = 'pointer';
    } else { m.visible = false; document.body.style.cursor = 'auto'; }
  };
  return (
    <>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 46, 130]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[24, 40, 18]} intensity={0.7} color="#b7a6ff" />
      <pointLight position={[-30, 16, -30]} intensity={0.6} color={GOLD} distance={110} />
      <pointLight position={[30, 16, 30]} intensity={0.5} color="#2dd4bf" distance={110} />
      <Stars radius={170} depth={70} count={2800} factor={4} fade speed={0.25} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow><planeGeometry args={[300, 300]} /><meshStandardMaterial color="#070510" metalness={0.4} roughness={0.85} /></mesh>
      <gridHelper args={[180, 90, '#2a1f4a', '#0f0a1e']} position={[0, -0.05, 0]} />

      <DistrictRings />
      <Hub />
      <Towers owned={owned} moveHover={moveHover} onSelect={onSelect} />
      <Lots avail={avail} moveHover={moveHover} onSelect={onSelect} />
      <Signs signs={signs} textures={textures} />

      <mesh ref={hover} visible={false}><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.7} /></mesh>
    </>
  );
}

export default function District3D({ plots, onSelect }: { plots: Plot[]; onSelect: (p: Plot) => void }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 42, 60], fov: 46 }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}><Scene plots={plots} onSelect={onSelect} /></Suspense>
      <OrbitControls enablePan={false} minDistance={18} maxDistance={130} maxPolarAngle={Math.PI / 2.15} autoRotate autoRotateSpeed={0.22} makeDefault target={[0, 2, 0]} />
    </Canvas>
  );
}

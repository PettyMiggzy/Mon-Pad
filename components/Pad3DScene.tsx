// components/Pad3DScene.tsx — the Mon-Pad homepage rebuilt as REAL 3D geometry.
// Everything is an object in the scene: extruded-feel 3D text (hero), 3D buttons
// (Create + filters), and 3D token-card kiosks (box with depth, PFP texture, 3D
// text, a 3D progress bar) standing on a lit floor casting shadows. Orbit around it.
// Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Text, useTexture, Billboard, Sparkles } from '@react-three/drei';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const BRAND = '#8B5CF6', GOLD = '#FFD700', GREEN = '#4ADE80';
const FONT = '/fonts/inter-800.woff';

export type Card = { name: string; symbol: string; address: string; img: string; progress: number; graduated: boolean; boosted?: boolean; mcMon?: number };
export type FilterKey = 'all' | 'trending' | 'near-graduation' | 'graduated';

const fmtMc = (n?: number) => (!n ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

function Btn3D({ label, position, width, color, active, onClick }: { label: string; position: [number, number, number]; width: number; color: string; active?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <group
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      scale={hover ? 1.06 : 1}
    >
      <mesh castShadow>
        <boxGeometry args={[width, 0.7, 0.35]} />
        <meshStandardMaterial color={active ? color : '#1a1330'} emissive={color} emissiveIntensity={active ? 0.7 : hover ? 0.4 : 0.16} metalness={0.4} roughness={0.4} />
      </mesh>
      <Text font={FONT} position={[0, 0, 0.2]} fontSize={0.24} color={active ? '#0b0714' : '#fff'} anchorX="center" anchorY="middle">{label}</Text>
    </group>
  );
}

function Card3D({ c, position, onOpen }: { c: Card; position: [number, number, number]; onOpen: (a: string) => void }) {
  const grp = useRef<THREE.Group>(null);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!c.img) return;
    let alive = true;
    const l = new THREE.TextureLoader(); l.setCrossOrigin('anonymous');
    l.load(c.img, (t) => { if (alive) { t.colorSpace = THREE.SRGBColorSpace; setTex(t); } }, undefined, () => {});
    return () => { alive = false; };
  }, [c.img]);
  useFrame(({ clock }) => { if (grp.current) grp.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.9 + position[0]) * 0.07 + (hover ? 0.3 : 0); });

  const accent = c.boosted ? GOLD : c.graduated ? GREEN : BRAND;
  const pct = Math.min(1, c.graduated ? 1 : c.progress);
  const W = 2.2, H = 2.85;
  const trackW = W * 0.82;
  const fillW = Math.max(0.001, trackW * pct);
  return (
    <group
      ref={grp} position={position} scale={hover ? 1.05 : 1}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); if (c.address) onOpen(c.address); }}
    >
      <mesh castShadow>
        <boxGeometry args={[W, H, 0.2]} />
        <meshStandardMaterial color="#140f28" metalness={0.5} roughness={0.4} emissive={accent} emissiveIntensity={hover ? 0.25 : 0.1} />
      </mesh>
      {/* top accent bar */}
      <mesh position={[0, H / 2 - 0.06, 0.11]}><boxGeometry args={[W, 0.09, 0.08]} /><meshBasicMaterial color={accent} toneMapped={false} /></mesh>
      {/* pfp */}
      <mesh position={[0, H * 0.2, 0.11]}>
        <planeGeometry args={[W * 0.82, W * 0.82]} />
        {tex ? <meshBasicMaterial map={tex} toneMapped={false} /> : <meshBasicMaterial color="#241b3a" />}
      </mesh>
      <Text font={FONT} position={[0, -H * 0.11, 0.12]} fontSize={0.2} color="#fff" anchorX="center" anchorY="middle" maxWidth={W * 0.92}>{c.name}</Text>
      <Text font={FONT} position={[0, -H * 0.27, 0.12]} fontSize={0.145} color="#9aa4b2" anchorX="center" anchorY="middle">${c.symbol} · {fmtMc(c.mcMon)}</Text>
      {/* progress track + fill */}
      <mesh position={[0, -H * 0.4, 0.1]}><boxGeometry args={[trackW, 0.09, 0.04]} /><meshBasicMaterial color="#2a2140" /></mesh>
      <mesh position={[-trackW / 2 + fillW / 2, -H * 0.4, 0.13]}><boxGeometry args={[fillW, 0.11, 0.06]} /><meshBasicMaterial color={accent} toneMapped={false} /></mesh>
      <Text font={FONT} position={[0, -H * 0.485, 0.12]} fontSize={0.13} color={accent} anchorX="center" anchorY="middle">{c.graduated ? 'LAUNCHED · trade' : `${Math.round(pct * 100)}% · trade`}</Text>
    </group>
  );
}

function Monshi() {
  const tex = useTexture('/monshi-statue.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = 5 + Math.sin(clock.elapsedTime * 0.7) * 0.25; });
  const img = tex.image as { width: number; height: number } | undefined;
  const aspect = img && img.width ? img.width / img.height : 0.6;
  const H = 8, W = H * aspect;
  return (
    <Billboard position={[0, 5, -9]}>
      <mesh position={[0, 0, -0.5]}><circleGeometry args={[6, 44]} /><meshBasicMaterial color={BRAND} transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      <group ref={ref}><mesh><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} opacity={0.85} /></mesh></group>
      <Sparkles count={40} scale={[9, 10, 4]} size={6} speed={0.3} color={BRAND} />
    </Billboard>
  );
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'trending', label: 'Trending' },
  { key: 'near-graduation', label: 'Near Grad' }, { key: 'graduated', label: 'Graduated' },
];

function Scene({ cards, filter, onFilter, onOpen, onCreate }: { cards: Card[]; filter: FilterKey; onFilter: (f: FilterKey) => void; onOpen: (a: string) => void; onCreate: () => void }) {
  const COLS = 3;
  const placed = cards.map((c, k) => {
    const col = k % COLS, row = Math.floor(k / COLS);
    return { c, pos: [(col - (COLS - 1) / 2) * 3.1, 1.5, 3.5 - row * 3.6] as [number, number, number] };
  });
  return (
    <>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 24, 70]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} color="#cbb9ff" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-camera-near={1} shadow-camera-far={60} />
      <pointLight position={[0, 8, 8]} intensity={1.1} color={BRAND} distance={60} />
      <pointLight position={[-12, 6, -8]} intensity={0.7} color={GOLD} distance={70} />
      <Stars radius={150} depth={60} count={2600} factor={4} fade speed={0.25} />

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial color="#0a0716" metalness={0.5} roughness={0.75} />
      </mesh>
      <gridHelper args={[120, 60, '#2a1f4a', '#120c22']} position={[0, 0, 0]} />

      <Suspense fallback={null}><Monshi /></Suspense>

      {/* hero (real 3D text) */}
      <Text font={FONT} position={[0, 8.3, -6]} fontSize={1} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={16} textAlign="center" outlineWidth={0.02} outlineColor={BRAND}>Launch a coin. Earn forever.</Text>
      <Text font={FONT} position={[0, 7.2, -6]} fontSize={0.34} color="#a78bfa" anchorX="center" anchorY="middle">Pocket fees on every trade + ~$800 at graduation.</Text>
      <Btn3D label="+ Create coin" position={[0, 6, -6]} width={3.4} color={BRAND} onClick={onCreate} />

      {/* filter toolbar (real 3D buttons) */}
      {FILTERS.map((f, i) => (
        <Btn3D key={f.key} label={f.label} position={[(i - 1.5) * 3, 0.7, 7.5]} width={2.7} color={BRAND} active={filter === f.key} onClick={() => onFilter(f.key)} />
      ))}

      {/* token cards (real 3D kiosks) */}
      {placed.map(({ c, pos }, i) => <Card3D key={c.address || c.symbol + i} c={c} position={pos} onOpen={onOpen} />)}

      <OrbitControls enablePan={false} minDistance={9} maxDistance={34} maxPolarAngle={Math.PI / 2.1} autoRotate autoRotateSpeed={0.15} makeDefault target={[0, 3, -1]} />
    </>
  );
}

export default function Pad3DScene({ cards, filter, onFilter }: { cards: Card[]; filter: FilterKey; onFilter: (f: FilterKey) => void }) {
  const onOpen = (a: string) => { window.location.href = `/token/${a}`; };
  const onCreate = () => { window.location.href = '/create'; };
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 8, 17], fov: 50 }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <Scene cards={cards} filter={filter} onFilter={onFilter} onOpen={onOpen} onCreate={onCreate} />
    </Canvas>
  );
}

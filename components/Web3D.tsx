// components/Web3D.tsx — a 3D version of the Mon-Pad homepage: the token feed as a
// curved wall of REAL UI cards (HTML/CSS rendered in 3D via drei <Html>), floating
// in space with Monshi presiding. Premium look because the cards are actual styled
// UI, not primitive meshes. Click a card → its token page. Client-only.

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sparkles, useTexture, Billboard, Html } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';

const BRAND = '#8B5CF6', GOLD = '#FFD700', GREEN = '#4ADE80';

export type Card = { name: string; symbol: string; address: string; img: string; progress: number; graduated: boolean; boosted?: boolean; mcMon?: number };

const fmtMc = (n?: number) => {
  if (!n) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

function TokenCard({ c, pos }: { c: Card; pos: [number, number, number] }) {
  const color = c.boosted ? GOLD : c.graduated ? GREEN : BRAND;
  const pct = Math.round(Math.min(1, c.progress) * 100);
  return (
    <Html position={pos} center distanceFactor={9} zIndexRange={[0, 40]} style={{ pointerEvents: 'auto' }}>
      <div
        onClick={() => { if (c.address) window.location.href = `/token/${c.address}`; }}
        style={{
          width: 178, padding: 12, borderRadius: 16, cursor: c.address ? 'pointer' : 'default',
          background: 'linear-gradient(160deg, rgba(26,18,46,0.96), rgba(10,6,20,0.96))',
          border: `1.5px solid ${color}`, boxShadow: `0 0 22px ${color}44, inset 0 0 20px rgba(0,0,0,0.4)`,
          color: '#fff', fontFamily: 'system-ui, sans-serif', backdropFilter: 'blur(6px)', userSelect: 'none',
          transition: 'transform .12s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.05)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; }}
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.img} alt={c.symbol} width={44} height={44} style={{ borderRadius: 11, border: `1px solid ${color}66`, objectFit: 'cover' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 108 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: '#9aa4b2' }}>${c.symbol}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12 }}>
          <span style={{ color: '#9aa4b2' }}>MC</span>
          <b>{fmtMc(c.mcMon)}</b>
        </div>
        {/* progress */}
        <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${c.graduated ? 100 : pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
        </div>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#000', background: color, borderRadius: 8, padding: '6px 0' }}>
          {c.graduated ? 'LAUNCHED · Trade' : `${pct}% · Trade →`}
        </div>
      </div>
    </Html>
  );
}

function Monshi() {
  const tex = useTexture('/monshi-statue.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = 1 + Math.sin(clock.elapsedTime * 0.7) * 0.25; });
  const img = tex.image as { width: number; height: number } | undefined;
  const aspect = img && img.width ? img.width / img.height : 0.6;
  const H = 10, W = H * aspect;
  return (
    <Billboard position={[0, 1, -7]}>
      <mesh position={[0, 0, -0.5]}><circleGeometry args={[7, 48]} /><meshBasicMaterial color={BRAND} transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      <group ref={ref}><mesh><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} opacity={0.85} /></mesh></group>
      <Sparkles count={40} scale={[9, 11, 4]} size={6} speed={0.3} color={BRAND} />
    </Billboard>
  );
}

function Scene({ cards }: { cards: Card[] }) {
  // Lay the feed out as a shallow curved wall (columns curve toward the viewer).
  const COLS = 4, GX = 4.2, GY = 3.2;
  const rows = Math.ceil(cards.length / COLS);
  const placed = cards.map((c, k) => {
    const col = k % COLS, row = Math.floor(k / COLS);
    const cx = col - (COLS - 1) / 2;
    const x = cx * GX;
    const y = ((rows - 1) / 2 - row) * GY + 1.5;
    const z = 2 - Math.abs(cx) * 1.1; // gentle curve
    return { c, pos: [x, y, z] as [number, number, number] };
  });
  return (
    <>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 22, 55]} />
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 6, 8]} intensity={1.4} color={BRAND} distance={60} />
      <Stars radius={140} depth={60} count={2600} factor={4} fade speed={0.3} />
      <Suspense fallback={null}><Monshi /></Suspense>
      {placed.map(({ c, pos }, i) => <TokenCard key={c.address || c.symbol + i} c={c} pos={pos} />)}
      <OrbitControls enablePan={false} enableZoom minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 1.8} minDistance={10} maxDistance={26} autoRotate autoRotateSpeed={0.18} makeDefault target={[0, 1.5, 0]} />
    </>
  );
}

export default function Web3D({ cards }: { cards: Card[] }) {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 3, 16], fov: 50 }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <Scene cards={cards} />
    </Canvas>
  );
}

// components/LaunchBay3D.tsx — "Bonding Orrery"
// A living 3D solar system of the whole pad. Every token orbits a central
// Mon-Pad star; bonding progress pulls a body INWARD and speeds it up, so the
// scene reads as "hundreds spiraling toward launch." Graduation flings a token
// out onto a bright green ring. Click any body → its token page opens.
//
// Scales to thousands: the long tail is ONE GPU <points> cloud whose orbit is
// computed in the vertex shader from static per-point attributes + one uTime
// uniform (O(1)/frame). Only a small HERO tier (≤12: boosted / near-grad /
// newest) becomes a detailed rocket; a MID tier (≤120) is one instanced mesh of
// clickable little ships. Search/filter dims the field to your hits.
//
// Client-only (imported via next/dynamic ssr:false).

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Html, Sparkles } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

export type Rocket = {
  name: string;
  symbol: string;
  address: string;
  progress: number;   // 0..1
  graduated: boolean;
  boosted?: boolean;
  mcMon?: number;     // market cap in MON (price * supply)
};

export type OrreryFilter = 'all' | 'trending' | 'boosted' | 'neargrad' | 'graduated';

const BRAND = '#8B5CF6';
const GOLD = '#FFD700';
const GREEN = '#4ADE80';

// Orbit geometry
const R_STAR = 3, R_INNER = 6, R_OUTER = 46, R_GRAD = 60, PLANE_JITTER = 2.2;
const HERO_MAX = 12, MID_MAX = 120, DEGRADE_BELOW = 16;
const TAU = Math.PI * 2;

const cBrand = new THREE.Color(BRAND);
const cGold = new THREE.Color(GOLD);
const cGreen = new THREE.Color(GREEN);

function smoothstep(e0: number, e1: number, x: number) {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
}
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }

// Deterministic 32-bit hash of the address so a token's angle/phase is STABLE
// across refreshes (no popping). FNV-1a.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function colorFor(t: Rocket): THREE.Color {
  if (t.boosted) return cGold;
  if (t.graduated) return cGreen;
  if (t.progress >= 0.95) return cGold;
  return cBrand.clone().lerp(cGold, smoothstep(0.7, 0.95, t.progress));
}

function significance(t: Rocket, index: number): number {
  return (t.boosted ? 3 : 0)
    + (!t.graduated && t.progress >= 0.9 ? 2 : 0)
    + t.progress
    + Math.max(0, 1 - index / 40)      // recency (list is newest-first)
    + (t.graduated ? 0.5 : 0);
}

type Orbit = { radius: number; baseAngle: number; angularSpeed: number; y: number; seed: number; size: number };
function orbitOf(t: Rocket): Orbit {
  const h = hash32(t.address || t.symbol || Math.random().toString());
  const baseAngle = ((h % 100000) / 100000) * TAU;
  const dir = (h & 1) ? 1 : -1;
  const seed = ((h >>> 8) % 100000) / 100000;
  const y = (((h >>> 16) % 1000) / 1000) * PLANE_JITTER - PLANE_JITTER / 2;
  if (t.graduated) {
    return { radius: R_GRAD, baseAngle, angularSpeed: 0.03 * dir, y: 5 + y, seed, size: 16 };
  }
  const radius = R_OUTER - t.progress * (R_OUTER - R_INNER);
  const angularSpeed = (0.04 + t.progress * 0.16) * dir;
  const mc = t.mcMon || 0;
  let size = clamp(7 + Math.log10(1 + mc) * 4, 7, 26);
  if (t.boosted) size *= 1.4;
  return { radius, baseAngle, angularSpeed, y, seed, size };
}

// ── Reusable hero rocket parts (kept from the original bay) ──────────────────
function RocketModel({ color, glow }: { color: string; glow: number }) {
  return (
    <group>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.34, 0.4, 1.5, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.85, 0]}>
        <coneGeometry args={[0.34, 0.7, 20]} />
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={glow * 0.6} metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.15, 0.34]}>
        <sphereGeometry args={[0.12, 14, 14]} />
        <meshStandardMaterial color="#8fd8ff" emissive="#66ccff" emissiveIntensity={1.4} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i / 3) * TAU) * 0.36, 0.2, Math.cos((i / 3) * TAU) * 0.36]} rotation={[0, (i / 3) * TAU, 0.35]}>
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
    if (ref.current) { const s = 0.7 + Math.sin(clock.elapsedTime * 20) * 0.25; ref.current.scale.set(1, s, 1); }
  });
  return (
    <mesh ref={ref} position={[0, -0.4, 0]}>
      <coneGeometry args={[0.3, 1.2, 12, 1, true]} />
      <meshBasicMaterial color="#ff9a3c" transparent opacity={0.75} side={THREE.DoubleSide} />
    </mesh>
  );
}

function HeroRocket({ token, onHover, onOpen }: { token: Rocket; onHover: (t: Rocket | null) => void; onOpen: (a: string) => void }) {
  const grp = useRef<THREE.Group>(null);
  const orbit = useMemo(() => orbitOf(token), [token]);
  const color = token.boosted ? GOLD : token.graduated ? GREEN : token.progress >= 0.95 ? GOLD : BRAND;
  const glow = token.boosted ? 1.3 : token.graduated ? 0.9 : 0.5 + token.progress * 0.6;
  const scale = token.graduated ? 1.15 : 0.8 + token.progress * 0.5;

  useFrame(({ clock }) => {
    if (!grp.current) return;
    const t = clock.elapsedTime;
    const ang = orbit.baseAngle + t * orbit.angularSpeed;
    grp.current.position.set(Math.cos(ang) * orbit.radius, orbit.y + Math.sin(t * 0.8 + orbit.seed) * 0.25, Math.sin(ang) * orbit.radius);
    grp.current.rotation.y += 0.01;
  });

  return (
    <group
      ref={grp}
      scale={scale}
      onPointerOver={(e) => { e.stopPropagation(); onHover(token); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); if (token.address) onOpen(token.address); }}
    >
      <RocketModel color={color} glow={glow} />
      {token.graduated && <Exhaust />}
      {token.boosted && <Sparkles count={18} scale={2.6} size={4} speed={0.5} color={GOLD} />}
      <Html position={[0, 2.7, 0]} center distanceFactor={18} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div style={{
          padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap',
          background: 'rgba(10,6,20,0.82)', border: `1px solid ${color}`, color: '#fff',
          fontSize: 13, fontWeight: 700, fontFamily: 'system-ui, sans-serif', boxShadow: `0 0 12px ${color}`,
        }}>
          {token.boosted ? '🚀 ' : ''}${token.symbol}
          <span style={{ color: '#9aa4b2', fontWeight: 500 }}>
            {token.graduated ? ' · LAUNCHED' : ` · ${Math.round(token.progress * 100)}%`}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Central star + orbit guides ──────────────────────────────────────────────
function CentralStar() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) { const s = 2.4 + Math.sin(clock.elapsedTime * 1.6) * 0.18; ref.current.scale.setScalar(s); ref.current.rotation.y += 0.004; }
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={BRAND} />
      </mesh>
      <pointLight position={[0, 0, 0]} intensity={2.4} color={BRAND} distance={90} decay={1.1} />
      <Sparkles count={30} scale={7} size={6} speed={0.3} color={BRAND} />
    </group>
  );
}

function GhostOrbits() {
  const rings = [R_INNER + 4, (R_INNER + R_OUTER) / 2, R_OUTER, R_GRAD];
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      {rings.map((r, i) => (
        <mesh key={i}>
          <torusGeometry args={[r, 0.03, 6, 96]} />
          <meshBasicMaterial color={i === rings.length - 1 ? GREEN : BRAND} transparent opacity={0.14} />
        </mesh>
      ))}
    </group>
  );
}

// ── GPU points field (the long tail + the graduated ring) ────────────────────
const VERT = `
uniform float uTime;
attribute vec3 aOrbit;   // radius, baseAngle, angularSpeed
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
attribute float aMatch;
varying vec3 vColor;
varying float vAlpha;
varying float vTw;
void main() {
  float ang = aOrbit.y + uTime * aOrbit.z;
  vec3 p = vec3(cos(ang) * aOrbit.x, position.y, sin(ang) * aOrbit.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * (300.0 / max(-mv.z, 0.001)), 42.0);
  vColor = aColor;
  vAlpha = mix(0.07, 1.0, aMatch);
  vTw = 0.7 + 0.3 * sin(uTime * 2.0 + aSeed * 6.2831);
}
`;
const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha * vTw;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a * 0.9);
}
`;

function PointsField({ tokens, matches }: { tokens: Rocket[]; matches: Float32Array }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const geo = useMemo(() => {
    const n = tokens.length;
    const position = new Float32Array(n * 3);
    const aOrbit = new Float32Array(n * 3);
    const aColor = new Float32Array(n * 3);
    const aSize = new Float32Array(n);
    const aSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = orbitOf(tokens[i]);
      position[i * 3] = Math.cos(o.baseAngle) * o.radius;
      position[i * 3 + 1] = o.y;
      position[i * 3 + 2] = Math.sin(o.baseAngle) * o.radius;
      aOrbit[i * 3] = o.radius; aOrbit[i * 3 + 1] = o.baseAngle; aOrbit[i * 3 + 2] = o.angularSpeed;
      const c = colorFor(tokens[i]);
      aColor[i * 3] = c.r; aColor[i * 3 + 1] = c.g; aColor[i * 3 + 2] = c.b;
      aSize[i] = o.size; aSeed[i] = o.seed;
    }
    return { position, aOrbit, aColor, aSize, aSeed, n };
  }, [tokens]);

  useFrame(({ clock }) => { if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime; });

  if (geo.n === 0) return null;
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geo.position, 3]} />
        <bufferAttribute attach="attributes-aOrbit" args={[geo.aOrbit, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[geo.aColor, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[geo.aSize, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[geo.aSeed, 1]} />
        <bufferAttribute attach="attributes-aMatch" args={[matches, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ── MID tier: instanced clickable little ships (CPU-animated so raycast is exact)
function MidShips({ tokens, onHover, onOpen }: { tokens: Rocket[]; onHover: (t: Rocket | null) => void; onOpen: (a: string) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const orbits = useMemo(() => tokens.map(orbitOf), [tokens]);

  useEffect(() => {
    const m = ref.current; if (!m) return;
    tokens.forEach((t, i) => m.setColorAt(i, colorFor(t)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [tokens]);

  useFrame(({ clock }) => {
    const m = ref.current; if (!m) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i];
      const ang = o.baseAngle + t * o.angularSpeed;
      dummy.position.set(Math.cos(ang) * o.radius, o.y + Math.sin(t + o.seed) * 0.15, Math.sin(ang) * o.radius);
      dummy.rotation.set(0, t * 0.4 + o.seed * TAU, 0);
      dummy.scale.setScalar(0.5 + o.size / 40);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (tokens.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined as any, undefined as any, tokens.length]}
      onPointerMove={(e) => { e.stopPropagation(); const i = e.instanceId; if (i != null) { onHover(tokens[i]); document.body.style.cursor = 'pointer'; } }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); const i = e.instanceId; if (i != null && tokens[i]?.address) onOpen(tokens[i].address); }}
    >
      <cylinderGeometry args={[0.18, 0.24, 0.9, 8]} />
      {/* meshBasicMaterial honours per-instance setColorAt and reads full-bright in
          the dark scene (no dependence on scene lighting). */}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────
function matchOf(t: Rocket, q: string, filter: OrreryFilter, trendCut: number, sig: number): boolean {
  if (q) {
    const s = q.toLowerCase();
    if (!(t.symbol?.toLowerCase().includes(s) || t.name?.toLowerCase().includes(s) || t.address?.toLowerCase().includes(s))) return false;
  }
  switch (filter) {
    case 'boosted': return !!t.boosted;
    case 'neargrad': return !t.graduated && t.progress >= 0.9;
    case 'graduated': return t.graduated;
    case 'trending': return sig >= trendCut;
    default: return true;
  }
}

function Scene({ rockets, query, filter, onHover, onOpen }: {
  rockets: Rocket[]; query: string; filter: OrreryFilter;
  onHover: (t: Rocket | null) => void; onOpen: (a: string) => void;
}) {
  // Tiering by significance (dedup by INDEX — demo bodies share an empty address).
  const { heroes, mid, tail } = useMemo(() => {
    if (rockets.length <= DEGRADE_BELOW) {
      // Early state: everything is a detailed rocket (elegant mini solar system).
      return { heroes: rockets, mid: [] as Rocket[], tail: [] as Rocket[] };
    }
    const scored = rockets.map((t, i) => ({ t, i, sig: significance(t, i) }));
    const rest = scored.filter((x) => !x.t.boosted).sort((a, b) => b.sig - a.sig);
    const heroIdx = new Set<number>();
    scored.forEach((x) => { if (x.t.boosted) heroIdx.add(x.i); }); // never drop a boosted token
    for (const x of rest) { if (heroIdx.size >= HERO_MAX) break; heroIdx.add(x.i); }
    const heroes = scored.filter((x) => heroIdx.has(x.i)).map((x) => x.t);
    const remaining = rest.filter((x) => !heroIdx.has(x.i)).map((x) => x.t);
    const mid = remaining.slice(0, MID_MAX);
    const tail = remaining.slice(MID_MAX);
    return { heroes, mid, tail };
  }, [rockets]);

  const trendCut = useMemo(() => {
    const sigs = rockets.map((t, i) => significance(t, i)).sort((a, b) => b - a);
    return sigs[Math.floor(sigs.length * 0.25)] ?? 0;
  }, [rockets]);

  // aMatch arrays (recomputed on query/filter change; one attribute upload).
  const tailMatch = useMemo(() => {
    const arr = new Float32Array(tail.length);
    for (let i = 0; i < tail.length; i++) arr[i] = matchOf(tail[i], query, filter, trendCut, significance(tail[i], i)) ? 1 : 0;
    return arr;
  }, [tail, query, filter, trendCut]);

  return (
    <>
      <color attach="background" args={['#05030c']} />
      <fog attach="fog" args={['#05030c', 55, 150]} />
      <ambientLight intensity={0.45} />
      <Stars radius={150} depth={60} count={2500} factor={4} fade speed={0.5} />

      <CentralStar />
      <GhostOrbits />

      <PointsField tokens={tail} matches={tailMatch} />
      <MidShips tokens={mid} onHover={onHover} onOpen={onOpen} />
      {heroes.map((t) => (
        <HeroRocket key={t.address || t.symbol} token={t} onHover={onHover} onOpen={onOpen} />
      ))}

      <OrbitControls
        enablePan={false} minDistance={9} maxDistance={110}
        autoRotate autoRotateSpeed={0.28} maxPolarAngle={Math.PI / 1.9} makeDefault
      />
    </>
  );
}

export default function LaunchBay3D({ rockets, query = '', filter = 'all', onHover }: {
  rockets: Rocket[]; query?: string; filter?: OrreryFilter; onHover?: (t: Rocket | null) => void;
}) {
  const onOpen = (addr: string) => { window.location.href = `/token/${addr}`; };
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 14, 44], fov: 50 }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ width: '100%', height: '100%' }}>
      <Scene rockets={rockets} query={query} filter={filter} onHover={onHover || (() => {})} onOpen={onOpen} />
    </Canvas>
  );
}

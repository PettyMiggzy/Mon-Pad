'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Group } from 'three';
import * as THREE from 'three';

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

const UP = '#3DFF9A';
const DOWN = '#FF5C7A';
const WICK = '#C4B5FD';

function normalize(data: ChartCandle[]) {
  if (!data.length) return { bars: [] as { x: number; o: number; h: number; l: number; c: number; up: boolean }[] };
  const prices = data.flatMap((d) => [d.high, d.low, d.open, d.close]).filter((n) => Number.isFinite(n) && n > 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, max * 0.02, 1e-12);
  const pad = span * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  const range = hi - lo;
  const n = data.length;
  const bars = data.map((d, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * 8 - 4;
    const y = (v: number) => ((v - lo) / range) * 2.4 - 0.2;
    return {
      x,
      o: y(d.open),
      h: y(d.high),
      l: y(d.low),
      c: y(d.close),
      up: d.close >= d.open,
    };
  });
  return { bars };
}

function CandleMesh({
  x, o, h, l, c, up, index,
}: {
  x: number; o: number; h: number; l: number; c: number; up: boolean; index: number;
}) {
  const bodyH = Math.max(0.04, Math.abs(c - o));
  const bodyY = (o + c) / 2;
  const wickH = Math.max(0.02, h - l);
  const wickY = (h + l) / 2;
  const color = up ? UP : DOWN;
  const ref = useRef<Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = Math.sin(t * 1.4 + index * 0.35) * 0.015;
  });
  return (
    <group ref={ref} position={[x, 0, 0]}>
      <mesh position={[0, wickY, 0]}>
        <boxGeometry args={[0.04, wickH, 0.04]} />
        <meshStandardMaterial color={WICK} emissive={WICK} emissiveIntensity={0.35} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, bodyY, 0]}>
        <boxGeometry args={[0.22, bodyH, 0.22]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.55}
          roughness={0.25}
          metalness={0.55}
          transparent
          opacity={0.95}
        />
      </mesh>
    </group>
  );
}

function ChartFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]} receiveShadow>
        <planeGeometry args={[10.5, 4.2]} />
        <meshStandardMaterial color="#12081f" roughness={0.85} metalness={0.2} transparent opacity={0.85} />
      </mesh>
      {[-1, 0, 1, 2].map((y) => (
        <mesh key={y} position={[0, y * 0.7 - 0.1, -0.8]}>
          <boxGeometry args={[9.2, 0.01, 0.01]} />
          <meshBasicMaterial color="#B57BFF" transparent opacity={0.25} />
        </mesh>
      ))}
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={`v${i}`} position={[-4 + i, 0.7, -0.8]}>
          <boxGeometry args={[0.01, 2.6, 0.01]} />
          <meshBasicMaterial color="#FF4D9A" transparent opacity={0.12} />
        </mesh>
      ))}
    </group>
  );
}

function LiveCandles({ data }: { data: ChartCandle[] }) {
  const { bars } = useMemo(() => normalize(data.slice(-48)), [data]);
  const ribbon = useMemo(() => {
    if (bars.length < 2) return null;
    const pts = bars.map((b) => new THREE.Vector3(b.x, b.c, 0.18));
    return new THREE.CatmullRomCurve3(pts);
  }, [bars]);

  return (
    <group>
      <ChartFloor />
      {bars.map((b, i) => (
        <CandleMesh key={`${b.x}-${i}`} {...b} index={i} />
      ))}
      {ribbon && (
        <mesh>
          <tubeGeometry args={[ribbon, Math.max(32, bars.length * 4), 0.035, 8, false]} />
          <meshStandardMaterial
            color="#B57BFF"
            emissive="#FF4D9A"
            emissiveIntensity={0.7}
            roughness={0.2}
            metalness={0.6}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}
    </group>
  );
}

function Scene({ data }: { data: ChartCandle[] }) {
  return (
    <>
      <color attach="background" args={['#07050e']} />
      <fog attach="fog" args={['#07050e', 8, 18]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} color="#F5EEFF" />
      <directionalLight position={[-3, 2, -2]} intensity={0.55} color="#FF4D9A" />
      <pointLight position={[0, 2.2, 2]} intensity={1.1} color="#B57BFF" distance={10} />
      <LiveCandles data={data} />
      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={12}
        maxPolarAngle={Math.PI * 0.48}
        target={[0, 0.6, 0]}
      />
    </>
  );
}

type Props = {
  data: ChartCandle[];
  height?: number;
};

/** Soft series so the chart still reads before the first on-chain trade. */
function demoCandles(n = 32): ChartCandle[] {
  const now = Math.floor(Date.now() / 1000);
  let px = 0.00042;
  const out: ChartCandle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 3.2) * 0.00004 + (Math.random() - 0.48) * 0.00003;
    const open = px;
    const close = Math.max(1e-8, px + drift);
    const high = Math.max(open, close) * (1 + Math.random() * 0.04);
    const low = Math.min(open, close) * (1 - Math.random() * 0.04);
    out.push({ time: now - (n - i) * 300, open, high, low, close, volume: 1 + Math.random() * 4 });
    px = close;
  }
  return out;
}

export default function TokenChart3D({ data, height = 380 }: Props) {
  const [failed, setFailed] = useState(false);
  const live = data.length > 0;
  const series = live ? data : demoCandles();

  return (
    <div
      style={{
        height,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        border: '1px solid rgba(181,123,255,0.28)',
        background: '#07050e',
        boxShadow: 'inset 0 0 40px rgba(181,123,255,0.12)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 12,
          zIndex: 2,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--pink, #FF4D9A)',
          pointerEvents: 'none',
        }}
      >
        {live ? 'Live candles' : 'Waiting on the first trade'}
      </div>
      {failed ? (
        <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#888', fontSize: 13 }}>
          WebGL unavailable — flip back to 2D.
        </div>
      ) : (
        <Canvas
          dpr={[1, 1.6]}
          camera={{ position: [0.2, 2.4, 7.2], fov: 38 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={() => setFailed(false)}
          style={{ width: '100%', height: '100%' }}
        >
          <Suspense fallback={null}>
            <Scene data={series} />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}

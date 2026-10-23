import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, useFont } from '@react-three/drei';
import { useAccount } from 'wagmi';
import type { Group, PointLight } from 'three';
import { currentMood, heroBus, setHeroMood, type HeroMood } from './bus';
import { Logo3D } from './Logo3D';
import { MonshiGLB } from './MonshiGLB';
import { HERO } from './palette';

useFont.preload('/fonts/RussoOne.json');

type Props = {
  symbols: string[];
  onReady: () => void;
  low: boolean;
  live: boolean;
};

function Burst() {
  const ref = useRef<Group>(null);
  const life = useRef(0);
  const bits = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);
  useFrame((_, dt) => {
    const node = ref.current;
    if (!node) return;
    const hot = currentMood(performance.now()) === 'celebrate';
    life.current = hot ? Math.min(1, life.current + dt * 1.4) : Math.max(0, life.current - dt * 1.6);
    node.visible = life.current > 0.02;
    node.scale.setScalar(0.3 + life.current * 1.6);
    node.rotation.z += dt * (hot ? 1.2 : 0.2);
  });
  return (
    <group ref={ref} position={[0.7, 1.15, 0.5]} visible={false}>
      {bits.map((i) => {
        const a = (i / bits.length) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.7, Math.sin(a) * 0.4, 0]}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <meshBasicMaterial color={i % 2 === 0 ? HERO.pink : HERO.green} />
          </mesh>
        );
      })}
    </group>
  );
}

function Orbits({ symbols }: { symbols: string[] }) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.4;
  });
  const coins = symbols.slice(0, 3);
  if (!coins.length) return null;
  return (
    <group ref={ref} position={[0.4, 0.9, 0]}>
      {coins.map((sym, i) => {
        const a = (i / coins.length) * Math.PI * 2;
        return (
          <group key={sym} position={[Math.cos(a) * 1.7, 0.18 * i, Math.sin(a) * 0.85]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.18, 0.18, 0.04, 20]} />
              <meshStandardMaterial color={i === 1 ? HERO.pink : HERO.purple} metalness={0.8} roughness={0.22} />
            </mesh>
            <Text
              font="/fonts/RussoOne-Regular.ttf"
              fontSize={0.07}
              color={HERO.bg}
              anchorX="center"
              anchorY="middle"
              position={[0, 0.03, 0]}
            >
              {sym.slice(0, 4)}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

function Stage({ symbols, low, onModel }: { symbols: string[]; low: boolean; onModel: () => void }) {
  const logo = useRef<Group>(null);
  const sweep = useRef<PointLight>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (logo.current) logo.current.position.y = Math.sin(t * 0.85) * 0.06;
    if (sweep.current) sweep.current.position.x = Math.sin(t * 0.7) * 2.4;
  });

  return (
    <>
      <color attach="background" args={[HERO.bg]} />
      <fog attach="fog" args={[HERO.bg, 6.5, 14]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[0.5, 1.6, 4.5]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[3.2, 4.5, 4]} intensity={1.45} color={HERO.lilac} />
      <pointLight position={[-2.2, 1.2, 2.2]} intensity={low ? 0.7 : 2.2} color={HERO.pink} distance={8} />
      <pointLight position={[2.4, 0.4, 1.6]} intensity={low ? 0.4 : 1.1} color={HERO.purple} distance={7} />
      {!low && <pointLight ref={sweep} position={[0, 1.4, 2.4]} intensity={1.4} color={HERO.white} distance={6} />}
      <group ref={logo} position={[0.4, 0.12, 0]}>
        <Logo3D />
        <Burst />
        <Orbits symbols={symbols} />
      </group>
      <group position={[1.85, -0.62, 0.5]}>
        <Suspense fallback={null}>
          <MonshiGLB height={1.75} onLoaded={onModel} />
        </Suspense>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[low ? 0 : 0.3, -1.45, -0.6]}>
        <circleGeometry args={[2.4, low ? 24 : 48]} />
        <meshBasicMaterial color={HERO.purpleDeep} transparent opacity={0.2} />
      </mesh>
    </>
  );
}

export default function HeroCanvas({ symbols, onReady, low, live }: Props) {
  const { isConnected } = useAccount();
  const wasConnected = useRef(false);

  useEffect(() => {
    if (isConnected && !wasConnected.current) setHeroMood('wave', 1600);
    wasConnected.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    try { if (localStorage.getItem('debugHero')) (window as any).__setHeroMood = setHeroMood; } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      heroBus.x = (e.clientX / window.innerWidth) * 2 - 1;
      heroBus.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onOri = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      if (Math.abs(heroBus.x) > 0.02) return;
      heroBus.x = Math.max(-1, Math.min(1, e.gamma / 28));
      heroBus.y = Math.max(-1, Math.min(1, (e.beta - 35) / 30));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('deviceorientation', onOri);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onOri);
    };
  }, []);

  const dpr = low ? 1 : Math.min(1.5, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [0.15, 0.32, 4.9], fov: 34 }}
      gl={{ antialias: !low, alpha: false, powerPreference: 'high-performance' }}
      frameloop={live ? 'always' : 'never'}
    >
      <Stage symbols={symbols} low={low} onModel={onReady} />
    </Canvas>
  );
}

export type { HeroMood };

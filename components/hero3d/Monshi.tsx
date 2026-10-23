import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { currentMood, heroBus } from './bus';
import { HERO } from './palette';

type Props = { low: boolean };

function damp(current: number, target: number, rate: number) {
  return current + (target - current) * rate;
}

export function Monshi({ low }: Props) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const arm = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const pupils = useRef<Group>(null);
  const burn = useRef<Group>(null);
  const seg = low ? 10 : 20;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const mood = currentMood(now);
    const lookX = Math.max(-0.65, Math.min(0.65, heroBus.x * 0.55));
    const lookY = Math.max(-0.32, Math.min(0.26, heroBus.y * 0.2));
    const breathe = Math.sin(t * 1.7);

    if (root.current) {
      const hop = mood === 'celebrate' ? Math.abs(Math.sin(t * 8)) * 0.12 : breathe * 0.02;
      root.current.position.y = 0.2 + hop;
      root.current.scale.setScalar(0.64 + breathe * 0.01);
    }
    if (head.current) {
      const yaw = mood === 'launch' ? -0.7 : mood === 'facepalm' ? 0.15 : lookX;
      const pitch = mood === 'facepalm' ? 0.42 : lookY;
      head.current.rotation.y = damp(head.current.rotation.y, yaw, 0.12);
      head.current.rotation.x = damp(head.current.rotation.x, pitch, 0.12);
    }
    if (pupils.current) {
      const px = mood === 'launch' ? -0.05 : lookX * 0.07;
      const py = lookY * 0.045;
      pupils.current.position.x = damp(pupils.current.position.x, px, 0.2);
      pupils.current.position.y = damp(pupils.current.position.y, py, 0.2);
    }
    if (eyes.current) {
      const cycle = t % 3.4;
      const blinking = cycle > 3.22 || mood === 'facepalm';
      const target = blinking ? 0.08 : 0.62;
      eyes.current.scale.y = damp(eyes.current.scale.y, target, 0.45);
    }
    if (arm.current) {
      const flex = mood === 'idle' && t % 7.5 > 6.4 && t % 7.5 < 7.2;
      let rx = 0.55;
      let rz = 0.55;
      if (flex) {
        rx = -1.35;
        rz = 0.15;
      }
      if (mood === 'wave') {
        rx = -1.15;
        rz = Math.sin(t * 10) * 0.5;
      }
      if (mood === 'facepalm') {
        rx = -2.15;
        rz = -0.15;
      }
      if (mood === 'celebrate') {
        rx = -0.9 + Math.sin(t * 9) * 0.55;
        rz = 0.9;
      }
      if (mood === 'launch') {
        rx = -0.85;
        rz = 1.15;
      }
      arm.current.rotation.x = damp(arm.current.rotation.x, rx, 0.14);
      arm.current.rotation.z = damp(arm.current.rotation.z, rz, 0.14);
    }
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * 2.4) * 0.55;
      tail.current.rotation.x = Math.sin(t * 2.4) * 0.12;
    }
    if (burn.current) {
      const hot = now < heroBus.burnUntil || mood === 'celebrate';
      burn.current.visible = hot;
      burn.current.position.y = 1.05 + ((now % 700) / 700) * 0.55;
      burn.current.rotation.y = t * 2;
    }
  });

  return (
    <group ref={root} position={[0.62, 0.2, 0.22]}>
      <mesh position={[0, -0.05, -0.02]} scale={[1.05, 0.95, 0.82]}>
        <sphereGeometry args={[0.4, seg, seg]} />
        <meshStandardMaterial color={HERO.hood} roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.02, 0.28]}>
        <boxGeometry args={[0.55, 0.07, 0.06]} />
        <meshStandardMaterial color={HERO.pink} emissive={HERO.pink} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.18, 0.16]} rotation={[1.15, 0, 0]}>
        <torusGeometry args={[0.18, 0.028, 8, low ? 10 : 18]} />
        <meshStandardMaterial color={HERO.gold} metalness={0.92} roughness={0.18} />
      </mesh>

      <group position={[-0.18, -0.42, 0.22]} rotation={[1.25, 0.2, 0.1]}>
        <mesh>
          <capsuleGeometry args={[0.1, 0.16, 3, low ? 6 : 8]} />
          <meshStandardMaterial color={HERO.hood} roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.28, 0.12]} rotation={[0.9, 0, 0]}>
          <boxGeometry args={[0.2, 0.1, 0.32]} />
          <meshStandardMaterial color={HERO.white} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.28, 0.24]}>
          <boxGeometry args={[0.21, 0.08, 0.1]} />
          <meshStandardMaterial color={HERO.pink} />
        </mesh>
      </group>
      <group position={[0.2, -0.42, 0.22]} rotation={[1.25, -0.15, -0.08]}>
        <mesh>
          <capsuleGeometry args={[0.1, 0.16, 3, low ? 6 : 8]} />
          <meshStandardMaterial color={HERO.hood} roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.28, 0.12]} rotation={[0.9, 0, 0]}>
          <boxGeometry args={[0.2, 0.1, 0.32]} />
          <meshStandardMaterial color={HERO.white} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.28, 0.24]}>
          <boxGeometry args={[0.21, 0.08, 0.1]} />
          <meshStandardMaterial color={HERO.pink} />
        </mesh>
      </group>

      <mesh position={[0.38, -0.02, 0.02]} rotation={[0.15, 0, -0.7]}>
        <capsuleGeometry args={[0.085, 0.22, 3, low ? 6 : 8]} />
        <meshStandardMaterial color={HERO.hood} roughness={0.75} />
      </mesh>

      <group ref={arm} position={[-0.36, 0.12, 0.08]}>
        <mesh position={[0, -0.18, 0]}>
          <capsuleGeometry args={[0.09, 0.24, 3, low ? 6 : 8]} />
          <meshStandardMaterial color={HERO.hood} roughness={0.75} />
        </mesh>
        <mesh position={[0.02, -0.38, 0.04]}>
          <sphereGeometry args={[0.08, low ? 8 : 12, low ? 8 : 12]} />
          <meshStandardMaterial color={HERO.purple} roughness={0.45} />
        </mesh>
        <mesh position={[0.02, -0.5, 0.08]} rotation={[1.2, 0, 0]}>
          <capsuleGeometry args={[0.025, 0.1, 2, 6]} />
          <meshStandardMaterial color={HERO.purple} roughness={0.45} />
        </mesh>
      </group>

      <group ref={tail} position={[0.02, -0.02, -0.34]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[0.04 * i, 0.05 * i, -0.11 * i]}>
            <sphereGeometry args={[0.075 - i * 0.01, low ? 8 : 12, low ? 8 : 10]} />
            <meshStandardMaterial color={i % 2 === 0 ? HERO.purple : HERO.pink} roughness={0.4} />
          </mesh>
        ))}
      </group>

      <group ref={head} position={[0, 0.46, 0.08]}>
        <mesh>
          <sphereGeometry args={[0.36, seg, seg]} />
          <meshStandardMaterial color={HERO.purple} roughness={0.42} />
        </mesh>
        <mesh position={[-0.18, 0.28, -0.02]} rotation={[0, 0, 0.35]}>
          <coneGeometry args={[0.13, 0.28, 8]} />
          <meshStandardMaterial color={HERO.purple} roughness={0.45} />
        </mesh>
        <mesh position={[0.18, 0.28, -0.02]} rotation={[0, 0, -0.35]}>
          <coneGeometry args={[0.13, 0.28, 8]} />
          <meshStandardMaterial color={HERO.purple} roughness={0.45} />
        </mesh>
        <mesh position={[-0.18, 0.26, 0.02]} rotation={[0.1, 0, 0.35]} scale={0.55}>
          <coneGeometry args={[0.13, 0.28, 6]} />
          <meshStandardMaterial color={HERO.pink} />
        </mesh>
        <mesh position={[0.18, 0.26, 0.02]} rotation={[0.1, 0, -0.35]} scale={0.55}>
          <coneGeometry args={[0.13, 0.28, 6]} />
          <meshStandardMaterial color={HERO.pink} />
        </mesh>
        <mesh position={[0, -0.08, 0.24]} scale={[1.1, 0.72, 0.65]}>
          <sphereGeometry args={[0.16, low ? 10 : 16, low ? 8 : 12]} />
          <meshStandardMaterial color={HERO.lilac} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.04, 0.34]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          <meshStandardMaterial color={HERO.pink} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.16, 0.33]} rotation={[0.2, 0, Math.PI]}>
          <torusGeometry args={[0.07, 0.016, 6, 14, Math.PI]} />
          <meshStandardMaterial color={HERO.pupil} />
        </mesh>
        <mesh position={[-0.03, -0.15, 0.36]}>
          <boxGeometry args={[0.02, 0.03, 0.02]} />
          <meshStandardMaterial color={HERO.white} />
        </mesh>
        <mesh position={[0.03, -0.15, 0.36]}>
          <boxGeometry args={[0.02, 0.03, 0.02]} />
          <meshStandardMaterial color={HERO.white} />
        </mesh>
        <group ref={eyes} position={[0, 0.06, 0.28]}>
          <mesh position={[-0.12, 0, 0]}>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial color={HERO.white} roughness={0.2} />
          </mesh>
          <mesh position={[0.12, 0, 0]}>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial color={HERO.white} roughness={0.2} />
          </mesh>
          <group ref={pupils}>
            <mesh position={[-0.12, 0, 0.05]}>
              <sphereGeometry args={[0.038, 10, 8]} />
              <meshStandardMaterial color={HERO.pupil} />
            </mesh>
            <mesh position={[0.12, 0, 0.05]}>
              <sphereGeometry args={[0.038, 10, 8]} />
              <meshStandardMaterial color={HERO.pupil} />
            </mesh>
          </group>
        </group>
      </group>

      <group ref={burn} visible={false}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[(i - 2) * 0.14, (i % 3) * 0.08, 0]}>
            <octahedronGeometry args={[0.055, 0]} />
            <meshStandardMaterial color={i % 2 ? HERO.gold : HERO.ember} emissive={HERO.pink} emissiveIntensity={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

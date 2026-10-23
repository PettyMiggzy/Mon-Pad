import { Center, Text3D } from '@react-three/drei';
import { HERO } from './palette';

export function Logo3D() {
  return (
    <Center position={[0, -0.28, 0]}>
      <Text3D
        font="/fonts/RussoOne.json"
        size={0.4}
        height={0.18}
        bevelEnabled
        bevelThickness={0.02}
        bevelSize={0.014}
        bevelSegments={2}
        curveSegments={4}
      >
        MONPAD
        <meshStandardMaterial
          color={HERO.purple}
          metalness={0.88}
          roughness={0.16}
          emissive={HERO.purpleDeep}
          emissiveIntensity={0.42}
        />
      </Text3D>
    </Center>
  );
}

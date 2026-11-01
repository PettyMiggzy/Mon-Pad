import Head from 'next/head';
import PetGame from '@/components/pet/PetGame';

export default function PetPage() {
  return (
    <>
      <Head>
        <title>Tamagotchi Monshi | Monpad</title>
        <meta key="description" name="description" content="Raise and train your own Monshi. Feed milk, play, train four skills and watch him grow. Free, no wallet needed." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/pet" />
      </Head>
      <PetGame />
    </>
  );
}

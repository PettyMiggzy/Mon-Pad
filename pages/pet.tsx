import Head from 'next/head';
import PetGame from '@/components/pet/PetGame';

export default function PetPage() {
  return (
    <>
      <Head>
        <title>My Monshi | Monpad</title>
        <meta key="description" name="description" content="Raise, train and talk to your own Monshi. Feed him, play, train four skills and watch him grow. Buy supplies with MONSHI." />
        <link key="canonical" rel="canonical" href="https://www.monpad.net/pet" />
      </Head>
      <PetGame />
    </>
  );
}

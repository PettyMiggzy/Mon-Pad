import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount } from 'wagmi';
import Head from 'next/head';

export default function ProfileIndexPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      router.replace(`/profile/${address}`);
    }
  }, [isConnected, address, router]);

  return (
    <>
      <Head>
        <title>Profile | Mon-Pad</title>
        <meta key="description" name="description" content="Connect your wallet to view your Mon-Pad profile, tokens created, and holdings." />
        <meta key="robots" name="robots" content="noindex,follow" />
      </Head>
            <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="text-2xl font-bold text-white">Your Profile</h1>
          <p className="mt-2 text-sm text-white/60">
            Connect your wallet to view your profile.
          </p>
          <p className="mt-4 text-xs text-white/40">
            Use the Connect button in the top right.
          </p>
        </div>
      </div>
    </>
  );
}

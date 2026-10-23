import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useReadContract, useSignMessage } from 'wagmi';
import { type Address } from 'viem';
import { factoryAbi, hubAbi, poolFactoryAbi, graduatorAbi } from '@/lib/abis';
import { CONTRACTS, isAdmin, MONAD_EXPLORER } from '@/lib/constants';
import type { BugReport } from '@/lib/api';
import Head from 'next/head';

export default function AdminPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && !isAdmin(address)) {
      router.replace('/');
    }
  }, [address, isConnected, router]);

  if (!isConnected) {
    return <div style={{ padding: 24, color: '#fff' }}>Connect wallet to access admin.</div>;
  }
  if (!isAdmin(address)) {
    return <div style={{ padding: 24, color: '#fff' }}>Not authorized. Redirecting...</div>;
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: 24, color: '#fff' }}>
      <Head>
        <title>Admin | Mon-Pad</title>
        <meta key="robots" name="robots" content="noindex,nofollow" />
      </Head>
      <h1 style={{ marginBottom: 24 }}>Admin</h1>
      <FactorySection />
      <PoolFactorySection />
      <GraduatorSection />
      <HubSection />
      <BugReportsSection />
      <div style={{ marginTop: 32, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12, color: '#888' }}>
        Admin controls ride the timelock. This view is read-only state and bug reports.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | undefined | null | bigint | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value == null ? '\u2014' : String(value)}</span>
    </div>
  );
}

function AddrLink({ addr }: { addr: string | undefined }) {
  if (!addr || /^0x0+$/i.test(addr)) return <span style={{ color: '#666' }}>not configured</span>;
  return <a href={`${MONAD_EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #A78BFA)', fontFamily: 'monospace', fontSize: 12 }}>{addr.slice(0,8)}...{addr.slice(-6)}</a>;
}

function FactorySection() {
  const factory = CONTRACTS.factoryV2;
  const { data: owner } = useReadContract({ address: factory as Address | undefined, abi: factoryAbi as any, functionName: 'owner', query: { enabled: !!factory } });
  const { data: paused } = useReadContract({ address: factory as Address | undefined, abi: factoryAbi as any, functionName: 'newLaunchesPaused', query: { enabled: !!factory } });

  return (
    <Section title="Factory (V2)">
      <Row label="Address" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={factory} /></div>
      <Row label="Owner" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={owner as string | undefined} /></div>
      <Row label="New launches paused" value={paused == null ? null : String(paused)} />
    </Section>
  );
}

function PoolFactorySection() {
  const pf = CONTRACTS.poolFactory;
  const { data: owner } = useReadContract({ address: pf as Address | undefined, abi: poolFactoryAbi as any, functionName: 'owner', query: { enabled: !!pf } });
  return (
    <Section title="Pool Factory">
      <Row label="Address" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={pf} /></div>
      <Row label="Owner" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={owner as string | undefined} /></div>
    </Section>
  );
}

function GraduatorSection() {
  const grad = CONTRACTS.graduator;
  const { data: owner } = useReadContract({ address: grad as Address | undefined, abi: graduatorAbi as any, functionName: 'owner', query: { enabled: !!grad } });
  return (
    <Section title="Graduator">
      <Row label="Address" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={grad} /></div>
      <Row label="Owner" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={owner as string | undefined} /></div>
    </Section>
  );
}

function HubSection() {
  const hub = CONTRACTS.hub;
  const { data: distributeInterval } = useReadContract({ address: hub as Address | undefined, abi: hubAbi as any, functionName: 'distributeInterval', query: { enabled: !!hub } });
  const { data: minDistribute } = useReadContract({ address: hub as Address | undefined, abi: hubAbi as any, functionName: 'minDistributeBalance', query: { enabled: !!hub } });
  const { data: owner } = useReadContract({ address: hub as Address | undefined, abi: hubAbi as any, functionName: 'owner', query: { enabled: !!hub } });

  return (
    <Section title="Staking Hub">
      <Row label="Address" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={hub} /></div>
      <Row label="Owner" value={undefined} />
      <div style={{ marginTop: -28, display: 'flex', justifyContent: 'flex-end' }}><AddrLink addr={owner as string | undefined} /></div>
      <Row label="Distribute interval" value={distributeInterval == null ? null : `${distributeInterval}s`} />
      <Row label="Min distribute balance" value={minDistribute == null ? null : `${minDistribute}`} />
    </Section>
  );
}

function BugReportsSection() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [reports, setReports] = useState<BugReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchReports() {
    if (!address) return;
    setLoading(true); setErr(null);
    try {
      const message = `ADMIN_AUTH:${Date.now()}`;
      const signature = await signMessageAsync({ message } as any);
      const res = await fetch(`${process.env.NEXT_PUBLIC_INDEXER_URL || ''}/api/admin/bugs`, {
        headers: { 'x-wallet': address, 'x-signature': signature, 'x-message': message },
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setReports(await res.json());
    } catch (e: any) {
      setErr(e?.message || 'failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title="Bug Reports">
      <button onClick={fetchReports} disabled={loading} style={{ padding: '6px 14px', background: 'var(--brand, #A78BFA)', color: '#000', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
        {loading ? 'signing...' : reports ? 'Refresh' : 'Sign & fetch'}
      </button>
      {err && <div style={{ marginTop: 8, color: 'var(--err, #F87171)', fontSize: 12 }}>{err}</div>}
      {reports && (
        <div style={{ marginTop: 12 }}>
          {reports.length === 0 ? <div style={{ color: '#888', fontSize: 13 }}>No bug reports.</div> : reports.map((r) => (
            <div key={r.id} style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#aaa' }}>{r.wallet ? r.wallet.slice(0,8) + '...' : 'anon'} \u00b7 {r.status || 'new'}</span>
                <span style={{ color: '#666', fontSize: 11 }}>{new Date((r.ts || 0) * 1000).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 4 }}>{r.description}</div>
              {r.notes && <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>notes: {r.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

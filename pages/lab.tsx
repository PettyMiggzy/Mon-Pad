import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAccount } from 'wagmi';
import Head from 'next/head';
import { createPublicClient, http, defineChain, parseAbiItem, type Address } from 'viem';
import { isAdmin } from '@/lib/constants';

/**
 * HIDDEN research page — live state of the seed-quote experiment on Robinhood Chain.
 *
 * UNLISTED BY DESIGN: no nav entry anywhere (compare /admin, which IS linked for admin wallets in
 * Layout.tsx), gated to the same ADMIN_WALLETS, and noindex,nofollow.
 *
 * SELF-CONTAINED ON PURPOSE. This reads chain 4663 through its own viem client rather than through
 * lib/wagmi.ts. Adding 4663 to the app's wagmi chains would put a chain switcher in front of every
 * ordinary Monad user for the sake of one hidden page — blast radius far out of proportion to the
 * feature. Nothing here touches the production config.
 *
 * READ-ONLY, ALSO ON PURPOSE. Launching stays in curve-testrig/scripts/run-arm.js, which carries a
 * launch.staticCall preflight, mid-arm resume, and the salt scheme that keeps token names byte-identical
 * across arms. Reimplementing that in a browser would either duplicate all of it or silently ship a
 * weaker version, and the weaker version would corrupt the experiment rather than just fail.
 *
 * THE EXPERIMENT. Over 2,878 quote-paired pools on factory 0x1f7d7550: pools whose FIRST MINT seeded
 * ~1.0 of the quote drew a known sniper fleet 92% of the time; seeding 0 drew 39%; seeding 1.5-10 or
 * 10+ drew 0%. A spike at 1.0, not a dose-response — a template hardcoding 1e18, not economics. The
 * trigger reads the MINT, so a dev buy is not a substitute for a seed.
 */

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://robinhoodchain.blockscout.com/api/eth-rpc'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

const EXPLORER = robinhood.blockExplorers.default.url;
const PAD = (process.env.NEXT_PUBLIC_EXPERIMENT_PAD ?? '') as Address;
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as Address;
const QUOTE = '0x0bd7d308f8e1639fab988df18a8011f41eacad73' as Address;

const LAUNCHED = parseAbiItem(
  'event Launched(uint256 indexed launchId, address indexed token, address indexed creator, (address pool, uint256 seedAmount0, uint256 seedAmount1, uint256 devBuyQuote, uint160 sqrtStart, int24 tickLower, int24 tickUpper, uint24 fee, bytes32 experimentId, bytes32 armId, uint32 replicate) record)',
);
const V3_SWAP = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);
const GET_POOL = parseAbiItem('function getPool(address,address,uint24) view returns (address)');

type Row = {
  launchId: bigint;
  token: Address;
  pool: Address | null;
  block: bigint;
  seedQuote: bigint | null;
  arm: string;
  buyers: number | null;
  firstBuyDelta: number | null;
};

const S = {
  page: { maxWidth: 1040, margin: '0 auto', padding: 24, color: '#fff' } as const,
  card: {
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 16, marginBottom: 16,
    background: 'rgba(255,255,255,0.03)',
  } as const,
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 } as const,
  warn: {
    border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.12)', borderRadius: 8,
    padding: 12, marginBottom: 16, fontSize: 13,
  } as const,
  th: { textAlign: 'left' as const, padding: '6px 10px', opacity: 0.6, fontWeight: 500, fontSize: 12 },
  td: { padding: '6px 10px', fontSize: 13, borderTop: '1px solid rgba(255,255,255,0.08)' },
  btn: {
    border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff',
    borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
  } as const,
};

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const fmt = (v: bigint | null) => (v === null ? '—' : (Number(v) / 1e18).toFixed(4));

export default function LabPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isConnected && !isAdmin(address)) router.replace('/');
  }, [address, isConnected, router]);

  const load = useCallback(async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(PAD)) return;
    setLoading(true);
    setErr('');
    try {
      const client = createPublicClient({ chain: robinhood, transport: http() });
      const logs = await client.getLogs({ address: PAD, event: LAUNCHED, fromBlock: 'earliest', toBlock: 'latest' });

      const out: Row[] = [];
      for (const l of logs) {
        const rec = (l.args as any).record;
        const token = (l.args as any).token as Address;
        const armId = rec?.armId as string | undefined;
        // Arms are identified by keccak of their label; show the short hash rather than guessing a
        // name, so the page never mislabels which arm a launch belongs to.
        const arm = armId ? `${armId.slice(0, 10)}…` : '—';

        let pool: Address | null = (rec?.pool as Address) ?? null;
        if (!pool || pool === '0x0000000000000000000000000000000000000000') {
          try {
            pool = (await client.readContract({
              address: V3_FACTORY, abi: [GET_POOL], functionName: 'getPool',
              args: [token, QUOTE, Number(rec?.fee ?? 10000)],
            })) as Address;
          } catch { pool = null; }
        }

        let buyers: number | null = null;
        let firstBuyDelta: number | null = null;
        if (pool && pool !== '0x0000000000000000000000000000000000000000') {
          try {
            const swaps = await client.getLogs({ address: pool, event: V3_SWAP, fromBlock: l.blockNumber, toBlock: 'latest' });
            // recipient (not sender) is the trader — sender is the router, and counting senders is how
            // an earlier pass mistook 27 routers for 27 people.
            buyers = new Set(swaps.map((s) => (s.args as any).recipient as string)).size;
            const external = swaps.filter((s) => s.transactionHash !== l.transactionHash);
            firstBuyDelta = external.length ? Number(external[0].blockNumber - l.blockNumber) : null;
          } catch { /* range caps — leave null rather than render a 0 that reads as "nobody came" */ }
        }

        out.push({
          launchId: (l.args as any).launchId as bigint,
          token, pool, block: l.blockNumber,
          seedQuote: rec ? (rec.seedAmount0 as bigint) : null,
          arm, buyers, firstBuyDelta,
        });
      }
      out.sort((a, b) => Number(a.launchId - b.launchId));
      setRows(out);
    } catch (e: any) {
      setErr(String(e?.shortMessage || e?.message || e).slice(0, 200));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!isConnected) return <div style={S.page}>Connect wallet.</div>;
  if (!isAdmin(address)) return <div style={S.page}>Not authorized. Redirecting…</div>;

  const deployed = /^0x[a-fA-F0-9]{40}$/.test(PAD);

  return (
    <div style={S.page}>
      <Head>
        <title>Lab | Mon-Pad</title>
        <meta key="robots" name="robots" content="noindex,nofollow" />
      </Head>

      <h1 style={{ fontSize: 22, marginBottom: 4 }}>REKT — seed-quote experiment</h1>
      <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
        Robinhood Chain · chainId 4663 · unlisted
      </div>

      <div style={S.warn}>
        <strong>Research instrument.</strong> The pattern these launches match belongs to a pad whose
        tokens die in about three minutes — 0 of 330 were still trading six hours later. The expected
        result is “snipers arrived, then it was over”: that confirms the trigger, it is not a strategy.
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>PAD</div>
            {deployed ? (
              <a href={`${EXPLORER}/address/${PAD}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc' }}>{PAD}</a>
            ) : (
              <div style={S.mono}>not deployed — set <code>NEXT_PUBLIC_EXPERIMENT_PAD</code></div>
            )}
          </div>
          <button style={S.btn} onClick={() => void load()} disabled={!deployed || loading}>
            {loading ? 'reading…' : 'refresh'}
          </button>
        </div>
        {err && <div style={{ ...S.mono, color: '#fca5a5', marginTop: 10 }}>read failed: {err}</div>}
      </div>

      <div style={S.card}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>
          LAUNCHES {rows.length > 0 && <span style={{ opacity: 0.7 }}>· {rows.length}</span>}
        </div>
        {!deployed ? (
          <div style={{ fontSize: 13, opacity: 0.6 }}>Nothing to show until the pad is deployed.</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.6 }}>{loading ? 'reading chain…' : 'Pad deployed, no launches yet.'}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>#</th><th style={S.th}>arm</th><th style={S.th}>seed quote</th>
                <th style={S.th}>token</th><th style={S.th}>buyers</th><th style={S.th}>first buy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.launchId)}>
                  <td style={{ ...S.td, ...S.mono }}>{String(r.launchId)}</td>
                  <td style={{ ...S.td, ...S.mono }}>{r.arm}</td>
                  <td style={{ ...S.td, ...S.mono }}>{fmt(r.seedQuote)}</td>
                  <td style={S.td}>
                    <a href={`${EXPLORER}/address/${r.token}`} target="_blank" rel="noreferrer" style={{ ...S.mono, color: '#7dd3fc' }}>{short(r.token)}</a>
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{r.buyers ?? '—'}</td>
                  <td style={{ ...S.td, ...S.mono }}>
                    {r.firstBuyDelta === null ? '—' : `+${r.firstBuyDelta} blk`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 10 }}>
          Buyers counts distinct swap <em>recipients</em>, not senders — senders are routers, and counting
          them is how an earlier pass mistook 27 routers for 27 people. A dash means the read was capped,
          not that nobody came.
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.45 }}>
        Launches run from <code style={S.mono}>curve-testrig/scripts/run-arm.js</code> with an operator key
        that never touches a browser. This page only observes.
      </div>
    </div>
  );
}

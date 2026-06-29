import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import Head from 'next/head';
import { api, type TokenSummary, type Profile } from '@/lib/api';
import { listV3Tokens } from '@/lib/chainV3';
import { fmtMon, shortAddr, isAddress } from '@/lib/format';

type Tab = 'created' | 'holdings';

function LetterAvatar({ wallet }: { wallet: string }) {
  const letter = (wallet.replace(/^0x/i, '')[0] || '?').toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-brand-purple text-white font-bold"
      style={{ width: 96, height: 96, fontSize: 40, lineHeight: 1 }}
    >
      {letter}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-white/50 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function TokenCard({ t }: { t: TokenSummary }) {
  return (
    <Link
      href={`/token/${t.address}`}
      className="block rounded-xl border border-border bg-card p-4 transition hover:border-brand-purple"
    >
      <div className="flex items-center gap-3">
        {t.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.imageUrl}
            alt={t.symbol}
            width={48}
            height={48}
            className="rounded-lg object-cover"
            style={{ width: 48, height: 48 }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-lg bg-brand-purple/20 text-brand-purple font-bold"
            style={{ width: 48, height: 48 }}
          >
            {t.symbol.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate font-semibold text-white">{t.name}</div>
            {t.graduated && (
              <span className="shrink-0 rounded-md bg-brand-purple/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-purple">
                GRAD
              </span>
            )}
          </div>
          <div className="truncate text-xs text-white/50">${t.symbol}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <div>
          <div className="text-white/40">Market Cap</div>
          <div className="text-white">{fmtMon(t.marketCapMon)} MON</div>
        </div>
        <div className="text-right">
          <div className="text-white/40">24h Vol</div>
          <div className="text-white">{fmtMon(t.volume24hMon)} MON</div>
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-white/10" style={{ width: 48, height: 48 }} />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-2/3 rounded bg-white/10" />
          <div className="h-3 w-1/3 rounded bg-white/10" />
        </div>
      </div>
      <div className="mt-4 h-3 w-full rounded bg-white/10" />
    </div>
  );
}

function formatJoined(ts?: number): string {
  if (!ts || ts <= 0) return '—';
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export default function ProfilePage() {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();

  const rawWallet = router.query.wallet;
  const walletStr = typeof rawWallet === 'string' ? rawWallet : '';
  const validWallet = isAddress(walletStr);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [createdTokens, setCreatedTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<Tab>('created');

  const isOwn = useMemo(() => {
    if (!connectedAddress || !walletStr) return false;
    return connectedAddress.toLowerCase() === walletStr.toLowerCase();
  }, [connectedAddress, walletStr]);

  useEffect(() => {
    if (!walletStr || !validWallet) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getProfile(walletStr).catch(() => null),
      // Created tokens come straight from chain (no backend dependency).
      listV3Tokens(60).catch(() => []),
    ])
      .then(([p, allTokens]) => {
        if (cancelled) return;
        setProfile(p);
        const mine: TokenSummary[] = (allTokens || [])
          .filter((t) => t.creator && t.creator.toLowerCase() === walletStr.toLowerCase())
          .map((t) => ({
            address: t.token,
            name: t.name,
            symbol: t.symbol,
            imageUrl: undefined,
            creator: t.creator,
            marketCapMon: (BigInt(t.priceWeiPerToken) * 1_000_000_000n).toString(),
            volume24hMon: '0',
            monRaisedNet: t.monRaisedNet,
            graduated: t.graduated,
            createdAt: 0,
            sparkline: [],
          }));
        setCreatedTokens(mine);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletStr, validWallet]);

  if (!router.isReady) {
    return (
      <>
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </>
    );
  }

  if (!validWallet) {
    return (
      <>
        <div className="mx-auto max-w-5xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-white">Invalid wallet</h1>
          <p className="mt-2 text-white/60">
            The address in the URL is not a valid wallet.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg border border-border bg-card px-4 py-2 text-white transition hover:border-brand-purple"
          >
            Back to home
          </Link>
        </div>
      </>
    );
  }

  const displayName = profile?.displayName?.trim() || shortAddr(walletStr);
  // Stats derive from real client-side data. Do NOT use profile.stats.launches
  // as a primary value - it's mock data in MOCK_MODE=1 and would lie to users.
  const launches = createdTokens.length;
  const graduatedCount = createdTokens.filter((t) => t.graduated).length;
  const joined = profile?.stats?.memberSince ? formatJoined(profile.stats.memberSince) : '—';

  return (
    <>
      <Head>
        <title>{`${displayName} | Mon-Pad`}</title>
        <meta key="description" name="description" content={`Profile of ${displayName} on Mon-Pad. Tokens created and holdings on Monad.`} />
        <meta key="robots" name="robots" content="noindex,follow" />
        <meta key="og:title" property="og:title" content={`${displayName} | Mon-Pad`} />
        <meta key="og:url" property="og:url" content={`https://www.monpad.net/profile/${walletStr}`} />
        <link key="canonical" rel="canonical" href={`https://www.monpad.net/profile/${walletStr}`} />
      </Head>
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Hero */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <LetterAvatar wallet={walletStr} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-white sm:text-3xl">
              {displayName}
            </h1>
            <div className="mt-1 font-mono text-sm text-white/50">
              {shortAddr(walletStr)}
            </div>
            {profile?.bio && (
              <p className="mt-2 text-sm text-white/70">{profile.bio}</p>
            )}
            {isOwn && (
              <div className="mt-2 text-xs text-white/40">
                This is your profile. Editing comes in v1.1.
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          <StatCard label="Tokens Created" value={String(launches)} />
          <StatCard label="Graduated" value={String(graduatedCount)} />
          <StatCard label="Joined" value={joined} />
        </div>

        {/* Tabs */}
        <div className="mt-8 flex items-center gap-2 border-b border-border">
          <button
            onClick={() => setTab('created')}
            className={
              'px-4 py-2 text-sm font-medium transition ' +
              (tab === 'created'
                ? 'border-b-2 border-brand-purple text-brand-purple'
                : 'text-white/60 hover:text-white')
            }
          >
            Created{' '}
            <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-xs">
              {createdTokens.length}
            </span>
          </button>
          <button
            onClick={() => setTab('holdings')}
            className={
              'px-4 py-2 text-sm font-medium transition ' +
              (tab === 'holdings'
                ? 'border-b-2 border-brand-purple text-brand-purple'
                : 'text-white/60 hover:text-white')
            }
          >
            Holdings
          </button>
        </div>

        {/* Tab content */}
        <div className="mt-6">
          {tab === 'created' && (
            <>
              {loading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : createdTokens.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center">
                  <div className="text-white/70">No tokens launched yet.</div>
                  {isOwn && (
                    <Link
                      href="/create"
                      className="mt-4 inline-block rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    >
                      Launch your first token
                    </Link>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {createdTokens.map((t) => (
                    <TokenCard key={t.address} t={t} />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'holdings' && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <div className="text-white/70">
                Holdings data coming soon.
              </div>
              <div className="mt-1 text-xs text-white/40">
                We are working on per-wallet holding reads.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

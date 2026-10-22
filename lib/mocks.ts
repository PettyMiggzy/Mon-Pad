import type { TokenSummary, Trade, Candle, Comment, Profile, BugReport, TopEarner, Holder } from './api';

const ROSTER: { name: string; symbol: string; hue: string }[] = [
  { name: 'Monshi', symbol: 'MONSHI', hue: '7c3aed' },
  { name: 'Street Heat', symbol: 'HEAT', hue: 'db2777' },
  { name: 'Pad King', symbol: 'PAD', hue: '8b5cf6' },
  { name: 'Violet Rush', symbol: 'VLT', hue: 'a855f7' },
  { name: 'Lambo Dreams', symbol: 'LAMBO', hue: 'ec4899' },
  { name: 'Moon Dust', symbol: 'DUST', hue: 'c026d3' },
  { name: 'Purple Ape', symbol: 'PAPE', hue: '9333ea' },
  { name: 'Cyan Fang', symbol: 'FANG', hue: '06b6d4' },
  { name: 'Monad Cat', symbol: 'MCAT', hue: '6366f1' },
  { name: 'Pepe King', symbol: 'PEPEK', hue: '22c55e' },
  { name: 'Burn Baby', symbol: 'BURN', hue: 'f43f5e' },
  { name: 'Drive Hard', symbol: 'DRIVE', hue: 'f97316' },
  { name: 'Smart Money', symbol: 'SMART', hue: 'eab308' },
  { name: 'Dead Wallet', symbol: 'DEAD', hue: '64748b' },
  { name: 'Curve Queen', symbol: 'CURVE', hue: 'd946ef' },
  { name: 'Gas Goblin', symbol: 'GOB', hue: '14b8a6' },
  { name: 'Alpha Drop', symbol: 'ALPHA', hue: '3b82f6' },
  { name: 'Night Market', symbol: 'NITE', hue: '4c1d95' },
  { name: 'Toxic Flow', symbol: 'TOX', hue: '84cc16' },
  { name: 'Rogue Ping', symbol: 'PING', hue: 'f472b6' },
  { name: 'Liquid Knife', symbol: 'KNIFE', hue: '0ea5e9' },
  { name: 'Crown Jewel', symbol: 'CROWN', hue: 'fbbf24' },
  { name: 'Wick God', symbol: 'WICK', hue: 'ef4444' },
  { name: 'Youre Smart', symbol: 'YSD', hue: 'ff4d9a' },
];

function hexPad(n: number, len: number): string {
  return n.toString(16).padStart(len, '0');
}

function demoAvatar(seed: string, hue: string): string {
  // Deterministic public avatar — no upload needed for the demo board.
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${hue}`;
}

function genSpark(i: number): number[] {
  const trend = i % 3; // 0=up, 1=down, 2=flat
  const drift = trend === 0 ? 0.012 : trend === 1 ? -0.01 : 0;
  const len = 30;
  let p = 100 + i * 3;
  let seed = (i + 1) * 9301;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out: number[] = [];
  for (let k = 0; k < len; k++) {
    const noise = (rand() - 0.5) * 0.04;
    p = p * (1 + drift + noise);
    out.push(Math.max(0.01, p));
  }
  return out;
}

export const SAMPLE: TokenSummary[] = ROSTER.map((r, i) => {
  const monRaised = Math.min(240_000, 8_000 + i * 9_500);
  const vol = 1_200 + i * 640 + ((i * 97) % 900);
  const mcap = 40_000 + i * 18_500 + ((i * 41) % 12_000);
  return {
    address: ('0x' + hexPad(i + 1, 40)) as string,
    sparkline: genSpark(i),
    name: r.name,
    symbol: r.symbol,
    imageUrl: demoAvatar(r.symbol, r.hue),
    creator: '0x' + hexPad((i + 1) * 17, 40),
    marketCapMon: String(BigInt(mcap) * 10n ** 18n),
    volume24hMon: String(BigInt(vol) * 10n ** 18n),
    monRaisedNet: String(BigInt(monRaised) * 10n ** 18n),
    graduated: i > 20,
    createdAt: Math.floor(Date.now() / 1000) - i * 2700,
  };
});

export function getDemoToken(addr?: string | null): TokenSummary | undefined {
  if (!addr) return undefined;
  const a = addr.toLowerCase();
  return SAMPLE.find((t) => t.address.toLowerCase() === a);
}

export async function mockTokens(filter?: string): Promise<TokenSummary[]> {
  if (filter === 'graduated' || filter === 'hot') return SAMPLE.filter((t) => t.graduated || Number(t.monRaisedNet) > 1e23);
  if (filter === 'near-graduation') {
    return SAMPLE.filter((t) => !t.graduated && BigInt(t.monRaisedNet) > 150_000n * 10n ** 18n);
  }
  if (filter === 'trending' || filter === 'hottest') {
    return [...SAMPLE].sort((a, b) => {
      const av = BigInt(a.volume24hMon);
      const bv = BigInt(b.volume24hMon);
      return bv > av ? 1 : bv < av ? -1 : 0;
    });
  }
  if (filter === 'new') {
    return [...SAMPLE].sort((a, b) => b.createdAt - a.createdAt);
  }
  return SAMPLE;
}

export async function mockTrades(tokenAddr: string): Promise<Trade[]> {
  const tok = getDemoToken(tokenAddr);
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: 48 }).map((_, i) => ({
    txHash: '0x' + hexPad(i + 1, 64),
    ts: now - i * 95,
    side: (i % 3 === 0 ? 'sell' : 'buy') as 'buy' | 'sell',
    wallet: '0x' + hexPad((i + 99) * 31, 40),
    tokenAddress: tokenAddr,
    monAmount: String(BigInt(Math.floor((i * 37) % 200) + 1) * 10n ** 18n),
    tokenAmount: String(BigInt(Math.floor((i * 911) % 100_000) + 100) * 10n ** 18n),
    priceMon: String(0.00008 + (i % 12) * 0.000003),
    tokenSymbol: tok?.symbol,
  }));
}

export async function mockCandles(): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  let c = 0.00012;
  let seed = 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: 120 }).map((_, i) => {
    const o = c;
    c = o * (1 + (rand() - 0.45) * 0.05);
    const h = Math.max(o, c) * 1.01;
    const l = Math.min(o, c) * 0.99;
    return { t: now - (120 - i) * 60, o, h, l, c, v: rand() * 100 };
  });
}

/** V3 chart candles shaped like chainV3.tradesToCandles output. */
export function mockV3Candles(tfSeconds = 300): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  const now = Math.floor(Date.now() / 1000);
  let c = 0.00018;
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: 64 }).map((_, i) => {
    const o = c;
    c = Math.max(1e-9, o * (1 + (rand() - 0.46) * 0.06));
    const high = Math.max(o, c) * (1 + rand() * 0.03);
    const low = Math.min(o, c) * (1 - rand() * 0.03);
    return {
      time: now - (64 - i) * tfSeconds,
      open: o,
      high,
      low,
      close: c,
      volume: 2 + rand() * 40,
    };
  });
}

export function mockV3Trades(_tokenAddr: string): import('./chainV3').V3Trade[] {
  const now = Math.floor(Date.now() / 1000);
  let px = 0.00018;
  return Array.from({ length: 40 }).map((_, i) => {
    const isBuy = i % 3 !== 0;
    const mon = 0.4 + ((i * 17) % 40);
    px = Math.max(1e-9, px * (1 + (isBuy ? 0.012 : -0.01) * (0.5 + (i % 5) * 0.1)));
    return {
      txHash: '0x' + hexPad(i + 77, 64),
      trader: ('0x' + hexPad((i + 55) * 13, 40)) as `0x${string}`,
      isBuy,
      mon,
      tokens: mon / Math.max(px, 1e-12),
      price: px,
      time: now - i * 110,
      block: BigInt(20_000_000 - i * 3),
    };
  });
}

export async function mockComments(addr: string): Promise<Comment[]> {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: '1', tokenAddress: addr, wallet: '0xdeadbeef' + '0'.repeat(32), text: "you're smart. drive.", ts: now - 300 },
    { id: '2', tokenAddress: addr, wallet: '0xcafebabe' + '0'.repeat(32), text: 'just aped 50 MON', ts: now - 1200 },
    { id: '3', tokenAddress: addr, wallet: '0xfeed' + '0'.repeat(36), text: 'burns looking nasty', ts: now - 3600 },
  ];
}

export async function mockProfile(wallet: string): Promise<Profile> {
  return {
    wallet,
    displayName: undefined,
    bio: undefined,
    stats: {
      launches: 3,
      holdings: 12,
      trades: 47,
      claimedMon: String(8200n * 10n ** 18n),
      memberSince: Math.floor(Date.now() / 1000) - 86400 * 30,
    },
  };
}

export async function mockBugs(): Promise<BugReport[]> {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: '1',
      description: 'Buy button greyed out on mobile Safari',
      wallet: '0xfeedface' + '0'.repeat(32),
      ts: now - 3600,
      status: 'new',
    },
  ];
}

export async function mockTopEarners(): Promise<TopEarner[]> {
  return [
    { wallet: '0x' + 'a'.repeat(40), displayName: 'kingpetty', earnedMon: '1000000000000000000000', launchCount: 6 },
    { wallet: '0x' + 'b'.repeat(40), displayName: 'monshi.dev', earnedMon: '850000000000000000000', launchCount: 4 },
    { wallet: '0x' + 'c'.repeat(40), earnedMon: '600000000000000000000', launchCount: 5 },
    { wallet: '0x' + 'd'.repeat(40), displayName: 'apex', earnedMon: '420000000000000000000', launchCount: 3 },
    { wallet: '0x' + 'e'.repeat(40), earnedMon: '310000000000000000000', launchCount: 2 },
    { wallet: '0x' + 'f'.repeat(40), earnedMon: '200000000000000000000', launchCount: 4 },
    { wallet: '0x' + '1'.repeat(40), earnedMon: '150000000000000000000', launchCount: 1 },
    { wallet: '0x' + '2'.repeat(40), earnedMon: '90000000000000000000', launchCount: 2 },
  ];
}

export async function mockHolders(addr: string): Promise<Holder[]> {
  const seed = parseInt(addr.slice(-6) || '1', 16) || 1;
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const holders: Holder[] = [];
  holders.push({
    wallet: '0x' + (seed * 17).toString(16).padStart(40, '0').slice(-40),
    amount: String(BigInt(Math.floor(50_000_000 + rand() * 100_000_000)) * 10n ** 18n),
    pctOfSupply: 0.05 + rand() * 0.1,
    isCreator: true,
  });
  for (let i = 0; i < 5; i++) {
    holders.push({
      wallet: '0x' + ((seed + i + 1) * 31).toString(16).padStart(40, '0').slice(-40),
      amount: String(BigInt(Math.floor(30_000_000 + rand() * 50_000_000)) * 10n ** 18n),
      pctOfSupply: 0.03 + rand() * 0.05,
      isCreator: false,
    });
  }
  for (let i = 0; i < 14; i++) {
    holders.push({
      wallet: '0x' + ((seed + i + 100) * 7).toString(16).padStart(40, '0').slice(-40),
      amount: String(BigInt(Math.floor(100_000 + rand() * 9_000_000)) * 10n ** 18n),
      pctOfSupply: rand() * 0.009,
      isCreator: false,
    });
  }
  return holders.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0));
}

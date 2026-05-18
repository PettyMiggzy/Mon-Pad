import type { TokenSummary, Trade, Candle, Comment, Profile, BugReport, TopEarner, Holder } from './api';

const NAMES = ['DogeTwo', 'MonShiba', 'PadCoin', 'Violet', 'Lambo', 'MoonDust', 'PurpleApe', 'Cyan', 'MonadCat', 'PepeKing'];
const SYMBOLS = ['DOGE2', 'MSHIB', 'PAD', 'VLT', 'LAMBO', 'DUST', 'PAPE', 'CYN', 'MCAT', 'PEPEK'];

function hexPad(n: number, len: number): string {
  return n.toString(16).padStart(len, '0');
}

function genSpark(i: number): number[] {
  const trend = i % 3; // 0=up, 1=down, 2=flat
  const drift = trend === 0 ? 0.012 : trend === 1 ? -0.010 : 0;
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

const SAMPLE: TokenSummary[] = Array.from({ length: 18 }).map((_, i) => {
  const monRaised = Math.min(425_000, 5_000 + i * 28_000);
  return {
    address: '0x' + hexPad(i + 1, 40),
    sparkline: genSpark(i),
    name: NAMES[i % NAMES.length] + (i >= NAMES.length ? ` v${i}` : ''),
    symbol: SYMBOLS[i % SYMBOLS.length],
    imageUrl: undefined,
    creator: '0x' + hexPad((i + 1) * 17, 40),
    marketCapMon: String(BigInt(50_000 + i * 21_000) * 10n ** 18n),
    volume24hMon: String(BigInt(2_000 + i * 800) * 10n ** 18n),
    monRaisedNet: String(BigInt(monRaised) * 10n ** 18n),
    graduated: i > 14,
    createdAt: Math.floor(Date.now() / 1000) - i * 3600,
  };
});

export async function mockTokens(filter?: string): Promise<TokenSummary[]> {
  if (filter === 'graduated') return SAMPLE.filter((t) => t.graduated);
  if (filter === 'near-graduation') {
    return SAMPLE.filter((t) => !t.graduated && BigInt(t.monRaisedNet) > 300_000n * 10n ** 18n);
  }
  if (filter === 'trending') {
    return [...SAMPLE].sort((a, b) => {
      const av = BigInt(a.volume24hMon);
      const bv = BigInt(b.volume24hMon);
      return bv > av ? 1 : bv < av ? -1 : 0;
    });
  }
  return SAMPLE;
}

export async function mockTrades(tokenAddr: string): Promise<Trade[]> {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: 40 }).map((_, i) => ({
    txHash: '0x' + hexPad(i + 1, 64),
    ts: now - i * 120,
    side: (i % 3 === 0 ? 'sell' : 'buy') as 'buy' | 'sell',
    wallet: '0x' + hexPad((i + 99) * 31, 40),
    tokenAddress: tokenAddr,
    monAmount: String(BigInt(Math.floor((i * 37) % 200) + 1) * 10n ** 18n),
    tokenAmount: String(BigInt(Math.floor((i * 911) % 100_000) + 100) * 10n ** 18n),
    priceMon: '0.0001',
  }));
}

export async function mockCandles(): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  let c = 0.0001;
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

export async function mockComments(addr: string): Promise<Comment[]> {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: '1', tokenAddress: addr, wallet: '0xdeadbeef' + '0'.repeat(32), text: 'wen lambo', ts: now - 300 },
    { id: '2', tokenAddress: addr, wallet: '0xcafebabe' + '0'.repeat(32), text: 'just aped 50 MON', ts: now - 1200 },
    { id: '3', tokenAddress: addr, wallet: '0xfeed' + '0'.repeat(36), text: 'curve looking healthy', ts: now - 3600 },
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
  // Deterministic seed from address
  const seed = parseInt(addr.slice(-6) || '1', 16) || 1;
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const holders: Holder[] = [];
  // First holder = creator with 5-15% of supply
  holders.push({
    wallet: '0x' + (seed * 17).toString(16).padStart(40, '0').slice(-40),
    amount: String(BigInt(Math.floor(50_000_000 + rand() * 100_000_000)) * 10n ** 18n),
    pctOfSupply: 0.05 + rand() * 0.10,
    isCreator: true,
  });
  // Top 5 whales: 3-8% each
  for (let i = 0; i < 5; i++) {
    holders.push({
      wallet: '0x' + ((seed + i + 1) * 31).toString(16).padStart(40, '0').slice(-40),
      amount: String(BigInt(Math.floor(30_000_000 + rand() * 50_000_000)) * 10n ** 18n),
      pctOfSupply: 0.03 + rand() * 0.05,
      isCreator: false,
    });
  }
  // 14 small holders: <1% each
  for (let i = 0; i < 14; i++) {
    holders.push({
      wallet: '0x' + ((seed + i + 100) * 7).toString(16).padStart(40, '0').slice(-40),
      amount: String(BigInt(Math.floor(100_000 + rand() * 9_000_000)) * 10n ** 18n),
      pctOfSupply: rand() * 0.009,
      isCreator: false,
    });
  }
  // Sort by amount desc
  return holders.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0));
}

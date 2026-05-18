import { MOCK_MODE, SERVER_URL, INDEXER_URL } from './constants';
import * as mocks from './mocks';

export type TokenSummary = {
  address: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  creator: string;
  marketCapMon: string;
  volume24hMon: string;
  monRaisedNet: string;
  graduated: boolean;
  createdAt: number;
  sparkline?: number[];
};

export type Trade = {
  txHash: string;
  ts: number;
  side: 'buy' | 'sell';
  wallet: string;
  tokenAddress: string;
  monAmount: string;
  tokenAmount: string;
  priceMon: string;
  tokenSymbol?: string;
};

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Comment = {
  id: string;
  tokenAddress: string;
  wallet: string;
  text: string;
  imageUrl?: string;
  parentId?: string;
  ts: number;
};

export type Profile = {
  wallet: string;
  displayName?: string;
  bio?: string;
  stats: {
    launches: number;
    holdings: number;
    trades: number;
    claimedMon: string;
    memberSince: number;
  };
};

export type BugReport = {
  id: string;
  description: string;
  contact?: string;
  wallet?: string;
  ts: number;
  status: 'new' | 'triaged' | 'resolved';
  notes?: string;
};

export type TopEarner = {
  wallet: string;
  displayName?: string;
  earnedMon: string;
  launchCount: number;
};

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  if (!SERVER_URL) throw new Error('SERVER_URL not configured');
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export type Holder = {
  wallet: string;
  amount: string;        // wei
  pctOfSupply: number;   // 0-1
  isCreator: boolean;
};

export const api = {
  listTokens: (filter?: string): Promise<TokenSummary[]> =>
    MOCK_MODE
      ? mocks.mockTokens(filter)
      : http<TokenSummary[]>(`/api/tokens${filter ? `?filter=${filter}` : ''}`),

  getToken: async (addr: string): Promise<TokenSummary | undefined> => {
    if (MOCK_MODE) {
      const all = await mocks.mockTokens();
      return all.find((t) => t.address.toLowerCase() === addr.toLowerCase());
    }
    return http<TokenSummary>(`/api/token/${addr}`);
  },

  getTrades: (addr: string): Promise<Trade[]> =>
    MOCK_MODE ? mocks.mockTrades(addr) : http<Trade[]>(`/api/token/${addr}/trades`),

  getCandles: (addr: string, tf = '5m'): Promise<Candle[]> =>
    MOCK_MODE ? mocks.mockCandles() : http<Candle[]>(`/api/token/${addr}/candles?tf=${tf}`),

  getComments: (addr: string): Promise<Comment[]> =>
    MOCK_MODE ? mocks.mockComments(addr) : http<Comment[]>(`/api/token/${addr}/comments`),

  postComment: (
    addr: string,
    body: { text: string; signature: string; message: string; parentId?: string; imageUrl?: string }
  ): Promise<{ ok: boolean }> =>
    MOCK_MODE
      ? Promise.resolve({ ok: true })
      : http(`/api/token/${addr}/comments`, { method: 'POST', body: JSON.stringify(body) }),

  getProfile: (wallet: string): Promise<Profile> =>
    MOCK_MODE ? mocks.mockProfile(wallet) : http<Profile>(`/api/profile/${wallet}`),

  patchProfile: (
    wallet: string,
    body: { displayName?: string; bio?: string; signature: string; message: string }
  ): Promise<{ ok: boolean }> =>
    MOCK_MODE
      ? Promise.resolve({ ok: true })
      : http(`/api/profile/${wallet}`, { method: 'PATCH', body: JSON.stringify(body) }),

  postBug: (body: {
    description: string;
    contact?: string;
    signature?: string;
    message?: string;
  }): Promise<{ ok: boolean }> =>
    MOCK_MODE
      ? Promise.resolve({ ok: true })
      : http(`/api/bugs`, { method: 'POST', body: JSON.stringify(body) }),

  listBugs: (auth: { wallet: string; signature: string; message: string }): Promise<BugReport[]> =>
    MOCK_MODE
      ? mocks.mockBugs()
      : http<BugReport[]>(`/api/bugs`, {
          headers: { 'x-wallet': auth.wallet, 'x-sig': auth.signature, 'x-msg': auth.message },
        }),

  listTopEarners: (): Promise<TopEarner[]> =>
    MOCK_MODE ? mocks.mockTopEarners() : http<TopEarner[]>(`/api/top-earners`),

  getHolders: (addr: string): Promise<Holder[]> =>
    MOCK_MODE ? mocks.mockHolders(addr) : http<Holder[]>(`/api/token/${addr}/holders`),

  uploadImage: async (file: File): Promise<{ url: string }> => {
    if (MOCK_MODE) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve({ url: reader.result as string });
        reader.readAsDataURL(file);
      });
    }
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${INDEXER_URL}/api/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
};

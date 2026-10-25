// Tools for the hosted Monpad MCP server (pages/api/mcp.ts). Read-only, no keys: anything that moves money
// returns a link that opens monpad.net with the form filled in, so the person confirms in their own wallet.
import { fetchMonshiBurnStats } from '../monshiBurn';
import { getV4Token, listV4Tokens, isV4Token } from '../v4/chain';
import { HOOK_V4, LAUNCHER_V4, ROUTER_V4, STATE_VIEW_V4, v4Configured } from '../v4/config';
import { feePct, LP_FEE_SLICES } from '../fees';
import { MONSHI_TOKEN } from '../constants';

const SITE = 'https://www.monpad.net';
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const mcapUsd = (marketCapMon: string) => Number(BigInt(marketCapMon || '0') / 10n ** 12n) / 1e6;

type Json = Record<string, unknown>;
export type Tool = {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: Record<string, any>) => Promise<unknown>;
};

const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });

function need(ok: boolean, msg: string) { if (!ok) throw new Error(msg); }
function needToken(a: any): string {
  need(typeof a?.token === 'string' && ADDR.test(a.token), 'token must be a 0x address');
  return a.token;
}
function clamp(n: unknown, lo: number, hi: number, d: number) { const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d; }

const summary = (t: Awaited<ReturnType<typeof listV4Tokens>>[number]) => ({
  token: t.address, name: t.name, symbol: t.symbol, creator: t.creator,
  marketCapUsd: Math.round(mcapUsd(t.marketCapMon)), totalFeePct: (t.feeBps ?? 100) / 100,
  page: `${SITE}/token/${t.address}`,
});

export const TOOLS: Tool[] = [
  {
    name: 'monpad_list_launches',
    description: 'Recent coins launched on Monpad, newest first, with market cap in USD and a link to each coin.',
    inputSchema: obj({ limit: num('How many coins, 1-50 (default 10)') }),
    run: async (a) => {
      need(v4Configured(), 'Monpad contracts are not configured on this server');
      const rows = await listV4Tokens(clamp(a.limit, 1, 50, 10));
      return { count: rows.length, launches: rows.map(summary) };
    },
  },
  {
    name: 'monpad_trending',
    description: 'The biggest coins on Monpad ranked by market cap in USD.',
    inputSchema: obj({ limit: num('How many coins, 1-50 (default 10)') }),
    run: async (a) => {
      need(v4Configured(), 'Monpad contracts are not configured on this server');
      const rows = (await listV4Tokens(120)).sort((x, y) => mcapUsd(y.marketCapMon) - mcapUsd(x.marketCapMon));
      return { ranking: 'marketCap', trending: rows.slice(0, clamp(a.limit, 1, 50, 10)).map(summary) };
    },
  },
  {
    name: 'monpad_get_token',
    description: 'Price in USD, market cap, liquidity, creator tax and total fee for one Monpad coin.',
    inputSchema: obj({ token: str('Token contract address (0x...)') }, ['token']),
    run: async (a) => {
      const token = needToken(a);
      need(await isV4Token(token), 'That address is not a Monpad coin');
      const t = await getV4Token(token as `0x${string}`);
      need(!!t, 'Coin not found');
      return {
        token: t!.address, name: t!.name, symbol: t!.symbol, creator: t!.creator,
        priceUsd: t!.priceUsdc, marketCapUsd: Math.round(t!.mcapUsdc), liquidity: t!.liquidity.toString(),
        creatorTaxPct: t!.taxBps / 100, totalFeePct: t!.totalFeeBps / 100, poolId: t!.poolId,
        page: `${SITE}/token/${t!.address}`,
      };
    },
  },
  {
    name: 'monpad_get_spec',
    description: 'How Monpad works: fees, fee split, contract addresses and supported ways to pay.',
    inputSchema: obj({}),
    run: async () => ({
      chainId: 143,
      pools: 'Uniswap V4, quoted in USDC. You can pay and receive MON: the router converts in the same transaction.',
      supply: 1_000_000_000,
      creationFee: 'free',
      fees: { baseFeePct: 1, creatorTaxPct: '0-5 (burns the coin)', split: LP_FEE_SLICES.map((s) => ({ id: s.id, label: s.label, share: feePct(s.bps) })) },
      contracts: { launcher: LAUNCHER_V4, hook: HOOK_V4, router: ROUTER_V4, stateView: STATE_VIEW_V4, monshi: MONSHI_TOKEN },
      docs: `${SITE}/docs`,
    }),
  },
  {
    name: 'monpad_get_monshi_burn',
    description: 'How much MONSHI has been burned so far.',
    inputSchema: obj({}),
    run: async () => {
      const b = await fetchMonshiBurnStats(true);
      return { burned: b.burnedWhole, circulating: b.circulatingWhole, totalSupply: Number(b.totalSupply / 10n ** 18n) };
    },
  },
  {
    name: 'monpad_buy_link',
    description: 'Get a link that opens the coin with a buy ready to confirm in the user\'s own wallet. Nothing is sent from here.',
    inputSchema: obj({ token: str('Token contract address (0x...)'), amountMon: num('How much MON to spend (optional)') }, ['token']),
    run: async (a) => {
      const token = needToken(a);
      const amt = Number(a.amountMon);
      const q = `?side=buy&pay=mon${Number.isFinite(amt) && amt > 0 ? `&amount=${amt}` : ''}`;
      return { link: `${SITE}/token/${token}${q}`, note: 'The user opens the link, connects a wallet and presses Buy.' };
    },
  },
  {
    name: 'monpad_sell_link',
    description: 'Get a link that opens the coin with a sell ready to confirm in the user\'s own wallet. Nothing is sent from here.',
    inputSchema: obj({ token: str('Token contract address (0x...)') }, ['token']),
    run: async (a) => ({ link: `${SITE}/token/${needToken(a)}?side=sell&pay=mon`, note: 'The user opens the link, connects a wallet and presses Sell.' }),
  },
  {
    name: 'monpad_launch_link',
    description: 'Get a link to the launch page with the coin\'s name, ticker and creator tax filled in. The user adds a picture and confirms in their wallet.',
    inputSchema: obj({
      name: str('Coin name, up to 32 characters'),
      symbol: str('Ticker, letters and numbers, up to 10'),
      description: str('One or two sentences (optional)'),
      creatorTaxPct: num('Creator tax 0-5 percent (optional, default 0)'),
      devBuyMon: num('Optional first buy in MON, in the same transaction'),
    }, ['name', 'symbol']),
    run: async (a) => {
      need(typeof a.name === 'string' && a.name.trim().length > 0, 'name is required');
      need(typeof a.symbol === 'string' && a.symbol.trim().length > 0, 'symbol is required');
      const p = new URLSearchParams({ name: String(a.name).slice(0, 32), symbol: String(a.symbol).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) });
      if (a.description) p.set('desc', String(a.description).slice(0, 240));
      const tax = Number(a.creatorTaxPct); if (Number.isFinite(tax) && tax > 0) p.set('tax', String(Math.min(5, tax)));
      const dev = Number(a.devBuyMon); if (Number.isFinite(dev) && dev > 0) p.set('devbuy', String(dev));
      return { link: `${SITE}/create?${p.toString()}`, note: 'The user opens the link, adds a picture if they want, and presses Launch.' };
    },
  },
];

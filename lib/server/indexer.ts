// lib/server/indexer.ts
import {
  ethBlockNumber,
  ethGetLogs,
  keccak256,
  decodeAddress,
  decodeUint256,
  formatEther,
  type RpcLog,
} from "@/lib/eth";

/** =========================
 * CONFIG
 * ========================= */

export const FACTORY_ADDRESS = "0xfEdC5df2F34Ec01Ac9cbc0c557a4BFD3de6C5c45";
export const FACTORY_START_BLOCK = 59737219n;


// If you still get range errors, lower this to 500n
const LOG_CHUNK_SIZE = 100000n;

// Ticker only needs recent blocks
const TICKER_WINDOW_BLOCKS = 500_000n;

// Heat/Leaderboard windows in blocks (rough)
const HEAT_24H_BLOCKS = 500_000n;
const HEAT_6H_BLOCKS = 150_000n;
const HEAT_1H_BLOCKS = 25_000n;

/** =========================
 * EVENT TOPICS
 * ========================= */

// Factory
const TOPIC_LAUNCHED = keccak256("Launched(address,address,address,address,address,uint256)");

// Curve
const TOPIC_BUY = keccak256("Buy(address,uint256,uint256)");
const TOPIC_SELL = keccak256("Sell(address,uint256,uint256)");
const TOPIC_GRADUATED = keccak256("Graduated(address,uint256)");

/** =========================
 * TYPES
 * ========================= */

export type ProjectRow = {
  token: `0x${string}`;
  curve: `0x${string}`;
  graduator: `0x${string}`;
  creator: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
};

export type TradeKind = "BUY" | "SELL";

export type TradeItem = {
  kind: TradeKind;
  curve: `0x${string}`;
  trader: `0x${string}`;
  monAmountWei: bigint; // BUY = monIn, SELL = monOut
  tokenAmountWei: bigint; // BUY = tokensOut, SELL = tokensIn
  blockNumber: bigint;
  txHash: `0x${string}`;
};

export type HeatItem = {
  curve: `0x${string}`;
  token?: `0x${string}`;
  creator?: `0x${string}`;
  score: number;
  volMon: number;
  txCount: number;
  uniqueTraders: number;
};

export type LeaderboardRow = {
  wallet: `0x${string}`;
  buysMon: number;
  sellsMon: number;
  netMon: number;
  tradeCount: number;
};

/** =========================
 * HELPERS
 * ========================= */

function hexBlock(n: bigint) {
  return "0x" + n.toString(16);
}

function parseBlockNumber(hex: string): bigint {
  return BigInt(hex);
}

function clamp(latest: bigint, n: bigint) {
  if (n < 0n) return 0n;
  if (n > latest) return latest;
  return n;
}

function wordAt(dataHex: string, wordIndex: number) {
  // data is 0x + words(32 bytes)
  const h = dataHex.replace(/^0x/, "");
  const start = wordIndex * 64;
  const end = start + 64;
  if (h.length < end) return "0x0";
  return "0x" + h.slice(start, end);
}

async function getLogsChunked(args: {
  address?: string | string[];
  topics?: Array<string | null | Array<string>>;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<RpcLog[]> {
  const latest = await ethBlockNumber();
  const from = clamp(latest, args.fromBlock);
  const to = clamp(latest, args.toBlock);

  const out: RpcLog[] = [];
  let start = from;

  while (start <= to) {
    const end = start + LOG_CHUNK_SIZE - 1n > to ? to : start + LOG_CHUNK_SIZE - 1n;

    const chunk = await ethGetLogs({
      address: args.address,
      fromBlock: hexBlock(start),
      toBlock: hexBlock(end),
      topics: args.topics,
    });

    out.push(...chunk);
    start = end + 1n;
  }

  return out;
}

/** =========================
 * PROJECTS (Factory.Launched)
 * ========================= */

export async function getProjects(): Promise<ProjectRow[]> {
  const latest = await ethBlockNumber();

  const logs = await getLogsChunked({
    address: FACTORY_ADDRESS,
    fromBlock: FACTORY_START_BLOCK,
    toBlock: latest,
    topics: [TOPIC_LAUNCHED],
  });

  const projects = logs.map((l) => {
        // event Launched(address indexed token, address indexed curve, address indexed graduator, address creator, address referrer, uint256 devAmt)
    const token = decodeAddress(l.topics[1]);
    const curve = decodeAddress(l.topics[2]);
    const graduator = decodeAddress(l.topics[3]);
        const creator = decodeAddress(wordAt(l.data, 0)); // word 0 = creator, word 1 = referrer, word 2 = devAmt

    return {
      token: token as `0x${string}`,
      curve: curve as `0x${string}`,
      graduator: graduator as `0x${string}`,
      creator: creator as `0x${string}`,
      blockNumber: parseBlockNumber(l.blockNumber),
      txHash: l.transactionHash as `0x${string}`,
    };
  });

  projects.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return projects;
}

/** =========================
 * TRADES (Curve.Buy / Curve.Sell)
 * ========================= */

async function getTradesInWindow(fromBlock: bigint, toBlock: bigint): Promise<TradeItem[]> {
  const projects = await getProjects();
  const curves = projects.map((p) => p.curve);
  if (curves.length === 0) return [];

  const [buyLogs, sellLogs] = await Promise.all([
    getLogsChunked({
      address: curves,
      fromBlock,
      toBlock,
      topics: [TOPIC_BUY],
    }),
    getLogsChunked({
      address: curves,
      fromBlock,
      toBlock,
      topics: [TOPIC_SELL],
    }),
  ]);

  const buys: TradeItem[] = buyLogs.map((l) => {
    // event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut)
    const buyer = decodeAddress(l.topics[1]);
    const monIn = decodeUint256(wordAt(l.data, 0));
    const tokensOut = decodeUint256(wordAt(l.data, 1));

    return {
      kind: "BUY",
      curve: l.address as `0x${string}`,
      trader: buyer as `0x${string}`,
      monAmountWei: monIn,
      tokenAmountWei: tokensOut,
      blockNumber: parseBlockNumber(l.blockNumber),
      txHash: l.transactionHash as `0x${string}`,
    };
  });

  const sells: TradeItem[] = sellLogs.map((l) => {
    // event Sell(address indexed seller, uint256 tokensIn, uint256 monOut)
    const seller = decodeAddress(l.topics[1]);
    const tokensIn = decodeUint256(wordAt(l.data, 0));
    const monOut = decodeUint256(wordAt(l.data, 1));

    return {
      kind: "SELL",
      curve: l.address as `0x${string}`,
      trader: seller as `0x${string}`,
      monAmountWei: monOut,
      tokenAmountWei: tokensIn,
      blockNumber: parseBlockNumber(l.blockNumber),
      txHash: l.transactionHash as `0x${string}`,
    };
  });

  const all = [...buys, ...sells];
  all.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return all;
}

export async function getTickerItems(limit = 40): Promise<TradeItem[]> {
  const latest = await ethBlockNumber();
  const from = latest > TICKER_WINDOW_BLOCKS ? latest - TICKER_WINDOW_BLOCKS : 0n;
  const trades = await getTradesInWindow(from, latest);
  return trades.slice(0, limit);
}

/** =========================
 * HEATBOARD
 * ========================= */

function windowBlocks(w: "24h" | "6h" | "1h") {
  if (w === "24h") return HEAT_24H_BLOCKS;
  if (w === "6h") return HEAT_6H_BLOCKS;
  return HEAT_1H_BLOCKS;
}

export async function getHeatboard(window: "24h" | "6h" | "1h" = "24h"): Promise<HeatItem[]> {
  const latest = await ethBlockNumber();
  const blocks = windowBlocks(window);
  const from = latest > blocks ? latest - blocks : 0n;

  const [projects, trades] = await Promise.all([getProjects(), getTradesInWindow(from, latest)]);

  const byCurve = new Map<string, { volMon: number; tx: number; traders: Set<string> }>();

  for (const t of trades) {
    const key = t.curve.toLowerCase();
    const rec = byCurve.get(key) ?? { volMon: 0, tx: 0, traders: new Set<string>() };
    rec.volMon += formatEther(t.monAmountWei);
    rec.tx += 1;
    rec.traders.add(t.trader.toLowerCase());
    byCurve.set(key, rec);
  }

  const out: HeatItem[] = projects.map((p) => {
    const rec = byCurve.get(p.curve.toLowerCase()) ?? { volMon: 0, tx: 0, traders: new Set<string>() };
    const unique = rec.traders.size;
    const score = rec.volMon * 3 + rec.tx * 1 + unique * 5;

    return {
      curve: p.curve,
      token: p.token,
      creator: p.creator,
      score,
      volMon: rec.volMon,
      txCount: rec.tx,
      uniqueTraders: unique,
    };
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** =========================
 * LEADERBOARD
 * ========================= */

export async function getLeaderboard(
  window: "24h" | "6h" | "1h" = "24h",
  limit = 25
): Promise<LeaderboardRow[]> {
  const latest = await ethBlockNumber();
  const blocks = windowBlocks(window);
  const from = latest > blocks ? latest - blocks : 0n;

  const trades = await getTradesInWindow(from, latest);

  const map = new Map<string, LeaderboardRow>();

  for (const t of trades) {
    const key = t.trader.toLowerCase();
    const row =
      map.get(key) ?? {
        wallet: t.trader,
        buysMon: 0,
        sellsMon: 0,
        netMon: 0,
        tradeCount: 0,
      };

    const mon = formatEther(t.monAmountWei);

    if (t.kind === "BUY") row.buysMon += mon;
    else row.sellsMon += mon;

    row.netMon = row.buysMon - row.sellsMon;
    row.tradeCount += 1;

    map.set(key, row);
  }

  const rows = Array.from(map.values());
  rows.sort((a, b) => b.buysMon - a.buysMon);
  return rows.slice(0, limit);
}

/** =========================
 * OPTIONAL: Graduations
 * ========================= */

export async function getGraduations(): Promise<
  { curve: `0x${string}`; pool: `0x${string}`; tokenId: bigint; blockNumber: bigint; txHash: `0x${string}` }[]
> {
  const latest = await ethBlockNumber();
  const projects = await getProjects();
  const curves = projects.map((p) => p.curve);
  if (curves.length === 0) return [];

  const logs = await getLogsChunked({
    address: curves,
    fromBlock: FACTORY_START_BLOCK,
    toBlock: latest,
    topics: [TOPIC_GRADUATED],
  });

  // event Graduated(address pool, uint256 tokenId) -> both NON-indexed, so in data
  return logs.map((l) => {
    const pool = decodeAddress(wordAt(l.data, 0));
    const tokenId = decodeUint256(wordAt(l.data, 1));
    return {
      curve: l.address as `0x${string}`,
      pool: pool as `0x${string}`,
      tokenId,
      blockNumber: parseBlockNumber(l.blockNumber),
      txHash: l.transactionHash as `0x${string}`,
    };
  });
}

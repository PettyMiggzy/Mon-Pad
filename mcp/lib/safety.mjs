import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';

const STORE = join(homedir(), '.monpad-mcp', 'daily-spend.json');

/** Two assets move through the tools: USDC (6 decimals, the quote asset) and native MON (18, the router's MON routes). */
const ASSETS = {
  usdc: {
    label: 'USDC',
    decimals: 6,
    txEnv: 'MAX_USDC_PER_TX',
    dayEnv: 'MAX_USDC_PER_DAY',
    txDefault: '25',
    dayDefault: '100',
  },
  mon: {
    label: 'MON',
    decimals: 18,
    txEnv: 'MAX_MON_PER_TX',
    dayEnv: 'MAX_MON_PER_DAY',
    txDefault: '5',
    dayDefault: '20',
  },
};

function cap(asset, kind) {
  const a = ASSETS[asset];
  const v = process.env[kind === 'tx' ? a.txEnv : a.dayEnv];
  const text = v && v.trim() ? v : kind === 'tx' ? a.txDefault : a.dayDefault;
  return a.decimals === 18 ? parseEther(text) : parseUnits(text, a.decimals);
}

function fmt(asset, amount) {
  const a = ASSETS[asset];
  return a.decimals === 18 ? formatEther(amount) : formatUnits(amount, a.decimals);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function emptyStore() {
  return { date: todayUtc(), flow: { usdc: '0', mon: '0' } };
}

function readStore() {
  try {
    const s = JSON.parse(readFileSync(STORE, 'utf8'));
    if (s.date !== todayUtc() || !s.flow) return emptyStore();
    return s;
  } catch {
    return emptyStore();
  }
}

function writeStore(data) {
  mkdirSync(join(homedir(), '.monpad-mcp'), { recursive: true });
  writeFileSync(STORE, JSON.stringify(data), 'utf8');
}

/**
 * Refuse if `amount` (base units of `asset`: 'usdc' or 'mon') exceeds the per-tx or daily cap.
 * Counts what a tool spends (launch, buy) and what a sell pays out.
 * @param {'usdc' | 'mon'} asset
 * @param {bigint} amount
 */
export function assertFlowAllowed(asset, amount) {
  const a = ASSETS[asset];
  const txCap = cap(asset, 'tx');
  const dayCap = cap(asset, 'day');
  if (amount > txCap) {
    throw new Error(`Refused: ${fmt(asset, amount)} ${a.label} exceeds ${a.txEnv} (${fmt(asset, txCap)} ${a.label})`);
  }
  const flow = BigInt(readStore().flow[asset] || '0');
  if (flow + amount > dayCap) {
    throw new Error(
      `Refused: daily ${a.label} flow would exceed ${a.dayEnv} (${fmt(asset, dayCap)} ${a.label}; already ${fmt(asset, flow)} today)`,
    );
  }
}

/** Record flow after a successful receipt. */
export function recordFlow(asset, amount) {
  if (amount <= 0n) return;
  const store = readStore();
  store.flow[asset] = (BigInt(store.flow[asset] || '0') + amount).toString();
  writeStore(store);
}

export function safetyLimitsForSpec() {
  return {
    maxUsdcPerTx: fmt('usdc', cap('usdc', 'tx')),
    maxUsdcPerDay: fmt('usdc', cap('usdc', 'day')),
    maxMonPerTx: fmt('mon', cap('mon', 'tx')),
    maxMonPerDay: fmt('mon', cap('mon', 'day')),
    privateKeyEnv: 'MONPAD_PRIVATE_KEY',
    note: 'Use a burner wallet. Caps are per asset: USDC for launch/buy/sell, MON only for the MON routes. Daily caps count what is spent and what a sell pays out. dryRun does not need a key.',
  };
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { formatEther, parseEther } from 'viem';

const STORE = join(homedir(), '.monpad-mcp', 'daily-spend.json');

function maxPerTx() {
  const v = process.env.MAX_MON_PER_TX;
  return parseEther(v && v.trim() ? v : '5');
}

function maxPerDay() {
  const v = process.env.MAX_MON_PER_DAY;
  return parseEther(v && v.trim() ? v : '20');
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function readStore() {
  try {
    return JSON.parse(readFileSync(STORE, 'utf8'));
  } catch {
    return { date: todayUtc(), monFlowWei: '0' };
  }
}

function writeStore(data) {
  mkdirSync(join(homedir(), '.monpad-mcp'), { recursive: true });
  writeFileSync(STORE, JSON.stringify(data), 'utf8');
}

function dailyMonFlow() {
  let store = readStore();
  if (store.date !== todayUtc()) return 0n;
  return BigInt(store.monFlowWei || store.spentWei || '0');
}

/**
 * Refuse if monAmount exceeds per-tx or daily caps (buys, launch dev buy, sell proceeds).
 * @param {bigint} monAmountWei
 */
export function assertMonFlowAllowed(monAmountWei) {
  const txCap = maxPerTx();
  const dayCap = maxPerDay();
  if (monAmountWei > txCap) {
    throw new Error(
      `Refused: ${formatEther(monAmountWei)} MON exceeds MAX_MON_PER_TX (${formatEther(txCap)} MON)`,
    );
  }
  const flow = dailyMonFlow();
  if (flow + monAmountWei > dayCap) {
    throw new Error(
      `Refused: daily MON flow would exceed MAX_MON_PER_DAY (${formatEther(dayCap)} MON; already ${formatEther(flow)} today)`,
    );
  }
}

/** Record MON flow after a successful receipt (buy spend, launch value, or sell proceeds). */
export function recordMonFlow(monAmountWei) {
  if (monAmountWei <= 0n) return;
  let store = readStore();
  if (store.date !== todayUtc()) store = { date: todayUtc(), monFlowWei: '0' };
  const flow = BigInt(store.monFlowWei || store.spentWei || '0') + monAmountWei;
  writeStore({ date: todayUtc(), monFlowWei: flow.toString() });
}

/** @deprecated alias */
export const assertMonSpendAllowed = assertMonFlowAllowed;
export const recordMonSpend = recordMonFlow;

export function safetyLimitsForSpec() {
  return {
    maxMonPerTx: formatEther(maxPerTx()),
    maxMonPerDay: formatEther(maxPerDay()),
    privateKeyEnv: 'MONPAD_PRIVATE_KEY',
    note: 'Use a burner wallet. Daily cap counts MON spent (launch/buy) and MON received (sell). dryRun does not need a key.',
  };
}

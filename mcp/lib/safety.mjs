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
    return { date: todayUtc(), spentWei: '0' };
  }
}

function writeStore(data) {
  mkdirSync(join(homedir(), '.monpad-mcp'), { recursive: true });
  writeFileSync(STORE, JSON.stringify(data), 'utf8');
}

/**
 * Refuse if monAmount exceeds per-tx or daily caps. Call before sending writes.
 * @param {bigint} monAmountWei
 */
export function assertMonSpendAllowed(monAmountWei) {
  const txCap = maxPerTx();
  const dayCap = maxPerDay();
  if (monAmountWei > txCap) {
    throw new Error(
      `Refused: ${formatEther(monAmountWei)} MON exceeds MAX_MON_PER_TX (${formatEther(txCap)} MON)`,
    );
  }
  let store = readStore();
  if (store.date !== todayUtc()) store = { date: todayUtc(), spentWei: '0' };
  const spent = BigInt(store.spentWei || '0');
  if (spent + monAmountWei > dayCap) {
    throw new Error(
      `Refused: daily MON spend would exceed MAX_MON_PER_DAY (${formatEther(dayCap)} MON; already ${formatEther(spent)} today)`,
    );
  }
}

/** Record MON spent after a successful write (creation fee + dev buy, or buy). */
export function recordMonSpend(monAmountWei) {
  let store = readStore();
  if (store.date !== todayUtc()) store = { date: todayUtc(), spentWei: '0' };
  const spent = BigInt(store.spentWei || '0') + monAmountWei;
  writeStore({ date: todayUtc(), spentWei: spent.toString() });
}

export function safetyLimitsForSpec() {
  return {
    maxMonPerTx: formatEther(maxPerTx()),
    maxMonPerDay: formatEther(maxPerDay()),
    privateKeyEnv: 'MONPAD_PRIVATE_KEY',
    note: 'Use a burner wallet. Limits apply to launch dev buy and buy MON amounts.',
  };
}

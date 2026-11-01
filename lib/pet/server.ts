// SERVER-ONLY helpers for the pet: MONSHI payment checks and push scheduling.
import { decodeEventLog, parseAbi, type Address } from 'viem';
import { MONSHI_TOKEN } from '@/lib/constants';
import { chainClient, TREASURY } from '@/lib/studioServer';
import { PREMIUM, type PremiumItem } from './shop';

const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
export const treasury = () => TREASURY;
export const priceWei = (item: PremiumItem) => BigInt(PREMIUM[item].priceMonshi) * 10n ** 18n;

/** Pure: does this receipt contain a MONSHI Transfer from `wallet` to `to` of at least `minWei`? Returns the amount sent, or null. */
export function findTransfer(logs: { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[], wallet: string, to: string, minWei: bigint): bigint | null {
  for (const l of logs) {
    if (l.address.toLowerCase() !== MONSHI_TOKEN.toLowerCase()) continue;
    try {
      const ev: any = decodeEventLog({ abi: transferAbi, data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      const a = ev.args as { from: Address; to: Address; value: bigint };
      if (a.from.toLowerCase() === wallet.toLowerCase() && a.to.toLowerCase() === to.toLowerCase() && a.value >= minWei) return a.value;
    } catch { /* some other event */ }
  }
  return null;
}

export async function verifyMonshiPayment(txHash: string, wallet: string, item: PremiumItem): Promise<bigint | null> {
  if (!TREASURY || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  try {
    const receipt = await chainClient().getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== 'success') return null;
    return findTransfer(receipt.logs as any, wallet, TREASURY, priceWei(item));
  } catch { return null; }
}

// ── push scheduling ─────────────────────────────────────────────────────────
export const REASONS = { hungry: { title: 'Monshi is hungry 🥛', body: 'His tummy is rumbling. Come feed him!' }, miss: { title: 'Monshi misses you', body: 'It has been a while. A little visit goes a long way.' } } as const;
export type Reason = keyof typeof REASONS;
export const isReason = (x: unknown): x is Reason => x === 'hungry' || x === 'miss';
export const MIN_GAP_MS = 12 * 3_600_000; // never ping one device more than twice a day

export type SubRow = { endpoint: string; remind_at: string | null; reason: string | null; last_sent_at: string | null };
/** Pure: which subscriptions should get a notification right now? */
export function dueSubs<T extends SubRow>(rows: T[], now = Date.now()): T[] {
  return rows.filter((r) => {
    if (!r.remind_at || !isReason(r.reason)) return false;
    const due = Date.parse(r.remind_at), last = r.last_sent_at ? Date.parse(r.last_sent_at) : 0;
    return due <= now && last < due && now - last >= MIN_GAP_MS;
  });
}

import { formatUnits } from 'viem';

export function shortAddr(addr?: string | null, head = 6, tail = 4): string {
  if (!addr) return '';
  if (addr.length < head + tail + 2) return addr;
  return `${addr.slice(0, head)}\u2026${addr.slice(-tail)}`;
}

export function isAddress(s?: string | null): boolean {
  return !!s && /^0x[a-fA-F0-9]{40}$/.test(s);
}

function toNum(wei: bigint | string | undefined | null, decimals = 18): number {
  if (wei === undefined || wei === null) return NaN;
  const w = typeof wei === 'string' ? BigInt(wei) : wei;
  return Number(formatUnits(w, decimals));
}

export function fmtMon(wei: bigint | string | undefined | null, maxFraction = 4): string {
  const n = toNum(wei);
  if (!Number.isFinite(n)) return '\u2014';
  if (n === 0) return '0';
  if (n > 0 && n < 0.0001) return '<0.0001';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFraction });
}

export function fmtToken(wei: bigint | string | undefined | null, maxFraction = 2): string {
  const n = toNum(wei);
  if (!Number.isFinite(n)) return '\u2014';
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFraction });
}

export function fmtPct(num: bigint | string | number, den: bigint | string | number, decimals = 1): string {
  const n = typeof num === 'number' ? num : Number(typeof num === 'string' ? BigInt(num) : num);
  const d = typeof den === 'number' ? den : Number(typeof den === 'string' ? BigInt(den) : den);
  if (!d) return '0%';
  return ((n / d) * 100).toFixed(decimals) + '%';
}

export function fmtAgo(tsSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - tsSeconds);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

/**
 * Demo board — seeded fake tokens. ONLY on when NEXT_PUBLIC_MOCK_MODE=1.
 * Never auto-on: a missing/empty factory must show an honest empty board, not fake tokens.
 */
import type { TokenSummary } from './api';

const ZERO = '0x0000000000000000000000000000000000000000';
const mockFlag = process.env.NEXT_PUBLIC_MOCK_MODE === '1' || process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

/** True when we should paint the board with seeded demo tokens. */
export const DEMO_BOARD = mockFlag;

/**
 * Labelled preview: while the board has NO real launches, show 3 sample tokens so people can see
 * the living-coin flow. They vanish as soon as a real token exists. Turn off with NEXT_PUBLIC_DEMO_PREVIEW=0.
 */
export const DEMO_PREVIEW = process.env.NEXT_PUBLIC_DEMO_PREVIEW !== '0';

export function isDemoAddress(addr?: string | null): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase();
  // Our seeded CAs are 0x000…00N style
  return /^0x0{30,}[0-9a-f]{1,10}$/.test(a) || a.startsWith('0x00000000000000000000000000000000000000');
}

export function demoBannerCopy(): string {
  return 'DEMO BOARD — factory not live yet. Click any token to open the detail page.';
}

/** Pick crown from demo tokens by volume. */
export function pickCrown(tokens: TokenSummary[]): TokenSummary | null {
  if (!tokens.length) return null;
  return [...tokens].sort((a, b) => {
    try {
      const A = BigInt(a.volume24hMon || a.monRaisedNet || '0');
      const B = BigInt(b.volume24hMon || b.monRaisedNet || '0');
      return A > B ? -1 : A < B ? 1 : 0;
    } catch {
      return 0;
    }
  })[0];
}

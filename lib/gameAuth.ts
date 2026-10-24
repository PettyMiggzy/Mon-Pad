import { timingSafeEqual } from 'crypto';

/** True when `got` equals the server's GAME_API_KEY (constant-time). */
export function gameKeyOk(got: string | undefined): boolean {
  const want = process.env.GAME_API_KEY;
  if (!want || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

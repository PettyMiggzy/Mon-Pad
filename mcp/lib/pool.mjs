import { encodeAbiParameters, keccak256, zeroAddress } from 'viem';

/** Uniswap V4 dynamic fee flag */
export const DYNAMIC_FEE = 0x800000;
export const TICK_SPACING = 200;
export const DEAD = '0x000000000000000000000000000000000000dEaD';

export function poolKeyForToken(token, hook) {
  return {
    currency0: zeroAddress,
    currency1: token,
    fee: DYNAMIC_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hook,
  };
}

export function poolIdFromKey(key) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Approximate token1 per 1 token0 (MON) from sqrtPriceX96 (both 18 decimals). */
export function priceTokensPerMon(sqrtPriceX96) {
  const q96 = 2n ** 96n;
  const num = BigInt(sqrtPriceX96) * BigInt(sqrtPriceX96);
  const den = q96 * q96;
  if (den === 0n) return 0;
  return Number(num) / Number(den);
}

export function monPerToken(sqrtPriceX96) {
  const tpm = priceTokensPerMon(sqrtPriceX96);
  if (tpm <= 0) return null;
  return 1 / tpm;
}

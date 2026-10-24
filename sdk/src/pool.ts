import {
  encodeAbiParameters,
  keccak256,
  maxUint256,
  toHex,
  type Address,
  type Hex,
  type StateOverride,
} from 'viem';

export const DYNAMIC_FEE = 0x800000;
export const TICK_SPACING = 200;
export const QUOTE_DECIMALS = 6; // USDC
export const TOKEN_DECIMALS = 18; // every Monpad launch token

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

/** True when the quote asset sorts first, i.e. USDC is currency0 and the launch token is currency1. */
export function quoteIsCurrency0(quote: Address, token: Address): boolean {
  return BigInt(quote) < BigInt(token);
}

/** Pool key for a (USDC, token) launch pool. Currencies are sorted by address, as Uniswap V4 requires. */
export function poolKeyForToken(token: Address, hook: Address, quote: Address): PoolKey {
  const quoteFirst = quoteIsCurrency0(quote, token);
  return {
    currency0: quoteFirst ? quote : token,
    currency1: quoteFirst ? token : quote,
    fee: DYNAMIC_FEE,
    tickSpacing: TICK_SPACING,
    hooks: hook,
  };
}

export function poolIdFromKey(key: PoolKey): `0x${string}` {
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

/**
 * Whole USDC per whole token from a pool's sqrtPriceX96. Handles both currency orderings and the
 * 6 vs 18 decimal difference (the raw pool price is currency1 / currency0 in base units).
 */
export function usdcPerTokenFromSqrt(sqrtPriceX96: bigint, quoteIs0: boolean): number | null {
  const q96 = 2n ** 96n;
  const raw = Number(sqrtPriceX96 * sqrtPriceX96) / Number(q96 * q96); // currency1 per currency0, base units
  if (!(raw > 0) || !Number.isFinite(raw)) return null;
  const decimalShift = 10 ** (TOKEN_DECIMALS - QUOTE_DECIMALS);
  // quote is currency0: raw = token/usdc  -> usdc per token = 1 / (raw / shift)
  // token is currency0: raw = usdc/token -> usdc per token = raw * shift
  return quoteIs0 ? decimalShift / raw : raw * decimalShift;
}

/** The USDC leg of a PoolManager Swap event (amounts are signed from the pool's side). */
export function quoteAmountOfSwap(amount0: bigint, amount1: bigint, quoteIs0: boolean): bigint {
  const a = quoteIs0 ? amount0 : amount1;
  return a < 0n ? -a : a;
}

// Storage layouts used only to let eth_call simulate trades without an on-chain approve or balance.
/** OpenZeppelin ERC20 `_allowances` mapping slot (slot 1) — the launch tokens. */
const OZ_ALLOWANCES_SLOT = 1n;
/** Circle FiatToken v2 (USDC on Monad): `balances` is slot 9, `allowed` is slot 10 (checked against the live token). */
export const USDC_BALANCES_SLOT = 9n;
export const USDC_ALLOWANCES_SLOT = 10n;

function mappingSlot(key: Address, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key, slot]));
}

export function erc20AllowanceStorageSlot(owner: Address, spender: Address, slot = OZ_ALLOWANCES_SLOT): Hex {
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender, mappingSlot(owner, slot)]),
  );
}

export function erc20BalanceStorageSlot(owner: Address, slot = USDC_BALANCES_SLOT): Hex {
  return mappingSlot(owner, slot);
}

/** Lets eth_call simulate router sells without an on-chain approve (quotes / dry-run). */
export function erc20AllowanceStateOverride(
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint = maxUint256,
  slot = OZ_ALLOWANCES_SLOT,
): StateOverride[number] {
  return {
    address: token,
    stateDiff: [{ slot: erc20AllowanceStorageSlot(owner, spender, slot), value: toHex(amount, { size: 32 }) }],
  };
}

/** Gives `owner` a USDC balance and allowance to `spender` inside an eth_call (never on-chain). */
export function usdcStateOverride(
  usdc: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): StateOverride[number] {
  return {
    address: usdc,
    stateDiff: [
      { slot: erc20BalanceStorageSlot(owner), value: toHex(amount, { size: 32 }) },
      { slot: erc20AllowanceStorageSlot(owner, spender, USDC_ALLOWANCES_SLOT), value: toHex(amount, { size: 32 }) },
    ],
  };
}

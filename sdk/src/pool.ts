import {
  encodeAbiParameters,
  keccak256,
  maxUint256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type StateOverride,
} from 'viem';

export const DYNAMIC_FEE = 0x800000;
export const TICK_SPACING = 200;

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export function poolKeyForToken(token: Address, hook: Address): PoolKey {
  return {
    currency0: zeroAddress,
    currency1: token,
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

export function monPerTokenFromSqrt(sqrtPriceX96: bigint): number | null {
  const q96 = 2n ** 96n;
  const num = sqrtPriceX96 * sqrtPriceX96;
  const den = q96 * q96;
  if (den === 0n) return null;
  const tpm = Number(num) / Number(den);
  if (tpm <= 0) return null;
  return 1 / tpm;
}

/** OpenZeppelin ERC20 `_allowances` mapping slot (slot 1). */
const ERC20_ALLOWANCES_SLOT = 1n;

export function erc20AllowanceStorageSlot(
  owner: Address,
  spender: Address,
  mappingSlot = ERC20_ALLOWANCES_SLOT,
): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [owner, mappingSlot],
    ),
  );
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender, inner]),
  );
}

/** Lets eth_call simulate router sells without an on-chain approve (quotes / dry-run). */
export function erc20AllowanceStateOverride(
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint = maxUint256,
): StateOverride[number] {
  return {
    address: token,
    stateDiff: [
      {
        slot: erc20AllowanceStorageSlot(owner, spender),
        value: toHex(amount, { size: 32 }),
      },
    ],
  };
}

/** Monpad on Monad mainnet (chain 143). Every address is public and verified; override any of them with createMonpad({ addresses }). */
export const MAINNET = {
  chainId: 143,
  launcher: '0x2d55391d4170C7cAF9eE53Cf8BAD00748452ec84',
  hook: '0xaff86Dd6e66df26b971767959e854e12b5f7a080',
  router: '0xC20A50750a75d2d8FFF47E63003636C3CF0bb18c',
  usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  poolManager: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
  stateView: '0x77395f3b2e73ae90843717371294fa97cc419d64',
  monshi: '0xB744F5CDb792d8187640214C4A1c9aCE29af7777',
  dead: '0x000000000000000000000000000000000000dEaD',
} as const;

/** The hookless native-MON/USDC pool the router uses to convert MON. */
export const MON_USDC_POOL = { fee: 500, tickSpacing: 10 } as const;
export const MONPAD_POOL = { fee: 0x800000, tickSpacing: 200 } as const; // dynamic fee, set by the hook
export const TOKEN_SUPPLY = 1_000_000_000;
export const RPC_URL = 'https://rpc.monad.xyz';

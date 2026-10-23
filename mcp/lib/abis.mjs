import { parseAbi } from 'viem';

export const launcherAbi = parseAbi([
  'function launch(string name, string symbol, bytes32 salt, uint16 creatorTaxBps) payable returns (address token)',
  'function predictToken(address creator, bytes32 salt, string name, string symbol) view returns (address)',
  'function creationFee() view returns (uint256)',
  'function platform() view returns (address)',
  'function hook() view returns (address)',
  'function poolManager() view returns (address)',
  'function monshi() view returns (address)',
  'function tokenCount() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function launches(address token) view returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId)',
  'function harvest(address token)',
  'event Launched(address indexed token, address indexed creator, bytes32 indexed poolId, uint16 creatorTaxBps, string name, string symbol, uint256 devBuyTokens)',
]);

export const hookAbi = parseAbi([
  'function feeUnits(bytes32 id) view returns (uint24)',
]);

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128)',
]);

export const v4RouterAbi = parseAbi([
  'function buyExactIn((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint256 minTokensOut) payable returns (uint256 tokensOut)',
  'function sellExactIn((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint256 tokensIn, uint256 minMonOut) returns (uint256 monOut)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

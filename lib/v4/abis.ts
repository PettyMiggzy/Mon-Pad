import { parseAbi } from 'viem';

const KEY = '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';

export const launcherV4Abi = parseAbi([
  'function launch(string name, string symbol, bytes32 salt, uint16 creatorTaxBps, uint256 quoteDevBuy) returns (address token)',
  'function quoteAsset() view returns (address)',
  'function creationFee() view returns (uint256)',
  'function launchPaused() view returns (bool)',
  'function tokenCount() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function launches(address token) view returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId)',
  'function claimable(address account, address asset) view returns (uint256)',
  'function claim(address asset) returns (uint256)',
  'function harvest(address token)',
  'function tokenReserve(address token) view returns (uint256)',
  'event Launched(address indexed token, address indexed creator, bytes32 indexed poolId, uint16 creatorTaxBps, string name, string symbol, uint256 devBuyTokens)',
]);

export const routerV4Abi = parseAbi([
  `function buyWithUsdc(${KEY} key, uint256 usdcIn, uint256 minTokensOut, uint256 deadline, uint160 limit) returns (uint256 tokensOut)`,
  `function sellToUsdc(${KEY} key, uint256 tokensIn, uint256 minUsdcOut, uint256 deadline, uint160 limit) returns (uint256 usdcOut)`,
]);

export const stateViewV4Abi = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128)',
]);

export const erc20V4Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

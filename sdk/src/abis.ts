import { parseAbi } from 'viem';

const KEY = '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)';

export const launcherAbi = parseAbi([
  'function launch(string name, string symbol, bytes32 salt, uint16 creatorTaxBps, uint256 quoteDevBuy) returns (address token)',
  'function launchWithMon(string name, string symbol, bytes32 salt, uint16 creatorTaxBps, uint256 minUsdc) payable returns (address token)',
  'function creationFee() view returns (uint256)',
  'function launchPaused() view returns (bool)',
  'function tokenCount() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function launches(address token) view returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId)',
  'function claimable(address account, address asset) view returns (uint256)',
  'function claim(address asset) returns (uint256)',
  'function harvest(address token)',
  'event Launched(address indexed token, address indexed creator, bytes32 indexed poolId, uint16 creatorTaxBps, string name, string symbol, uint256 devBuyTokens)',
]);

export const routerAbi = parseAbi([
  `function buyWithMon(${KEY} key, uint256 minTokensOut, uint256 minUsdcOut, uint256 deadline, uint160 monUsdcLimit, uint160 tokenPoolLimit) payable returns (uint256 tokensOut)`,
  `function sellToMon(${KEY} key, uint256 tokensIn, uint256 minMonOut, uint256 minUsdcOut, uint256 deadline, uint160 tokenLimit, uint160 monLimit) returns (uint256 monOut)`,
  `function buyWithUsdc(${KEY} key, uint256 usdcIn, uint256 minTokensOut, uint256 deadline, uint160 limit) returns (uint256 tokensOut)`,
  `function sellToUsdc(${KEY} key, uint256 tokensIn, uint256 minUsdcOut, uint256 deadline, uint160 limit) returns (uint256 usdcOut)`,
]);

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

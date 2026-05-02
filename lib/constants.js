// MonPad V2 — addresses get filled in after deploy
// Until V2 contracts are deployed, pages can fall back to V1 if needed via FACTORY_VERSION

export const FACTORY_VERSION = process.env.NEXT_PUBLIC_FACTORY_VERSION || 'v1' // 'v1' or 'v2' - controllable via Vercel env (NEXT_PUBLIC_FACTORY_VERSION)

// V1 (currently live)
export const FACTORY_V1 = '0xc1dF3c842C2e1Fb76656A8415D66B72A101366Bc'

// V2 (set after deploy from deploy/v2/deployed.json)
export const FACTORY_V2 = process.env.NEXT_PUBLIC_FACTORY_V2 || ''
export const STAKING_HUB_V2 = process.env.NEXT_PUBLIC_STAKING_HUB || ''
export const POOL_FACTORY_V2 = process.env.NEXT_PUBLIC_POOL_FACTORY || ''
export const VESTING_V2 = process.env.NEXT_PUBLIC_VESTING || ''
export const SWAP_V2 = process.env.NEXT_PUBLIC_SWAP || ''

if (FACTORY_VERSION === 'v2') {
  const missing = []
  if (!FACTORY_V2) missing.push('NEXT_PUBLIC_FACTORY_V2')
  if (!STAKING_HUB_V2) missing.push('NEXT_PUBLIC_STAKING_HUB')
  if (!POOL_FACTORY_V2) missing.push('NEXT_PUBLIC_POOL_FACTORY')
  if (!VESTING_V2) missing.push('NEXT_PUBLIC_VESTING')
  if (missing.length) {
    throw new Error(`V2 mode requires these env vars: ${missing.join(', ')}. Set them in Vercel env or .env.local. Refusing to fall back to V1.`)
  }
}
export const FACTORY_ADDRESS = FACTORY_VERSION === 'v2' ? FACTORY_V2 : FACTORY_V1

export const PLATFORM_WALLET = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16'
export const TREASURY_WALLET = '0xB9d4B73bE18914c6d64Bee65a806648370be467f'
export const BUYBACK_WALLET = process.env.NEXT_PUBLIC_BUYBACK_WALLET || '0xB9d4B73bE18914c6d64Bee65a806648370be467f'
export const MONSHI_TOKEN = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777'
export const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'
export const NPM_ADDRESS = '0xa9f6B6656e32F223d778b01642F32D00F5310526'

export const START_BLOCK = 66664884n
export const CREATION_FEE = 100n * 10n ** 18n
export const MIN_DEV_BUY = 100n * 10n ** 18n
export const MAX_DEV_BUY_BPS = 200 // 2%
export const GRADUATION_TARGET = 425000n * 10n ** 18n
export const GRADUATION_LP = 400000n * 10n ** 18n
export const GRADUATION_REWARD = 25000n * 10n ** 18n
export const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n

export const MONADSCAN = 'https://monadscan.com'

// V2 Factory ABI (when deployed) — includes new admin functions
export const FACTORY_ABI = [
  { name: 'createLaunch', type: 'function', stateMutability: 'payable', inputs: [{ name: 'name', type: 'string' }, { name: 'symbol', type: 'string' }, { name: 'referrer', type: 'address' }], outputs: [{ name: 'token', type: 'address' }, { name: 'curve', type: 'address' }] },
  { name: 'allCounts', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 't', type: 'uint256' }, { name: 'c', type: 'uint256' }] },
  { name: 'allTokens', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { name: 'tokToCurve', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'address' }] },
  { name: 'creationFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'graduationTarget', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'maxDevBuyBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'rewardRouter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'getRewardRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'pauseNewLaunches', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pauseAllBuys', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pauseAllSells', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'blocked', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  // Admin
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'setCreationFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'v', type: 'uint256' }], outputs: [] },
  { name: 'setGraduationTarget', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'v', type: 'uint256' }], outputs: [] },
  { name: 'setGraduationCreatorReward', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'v', type: 'uint256' }], outputs: [] },
  { name: 'setMaxDevBuyBps', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'v', type: 'uint256' }], outputs: [] },
  { name: 'setRewardRouter', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_router', type: 'address' }], outputs: [] },
  { name: 'setPauseNewLaunches', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'v', type: 'bool' }], outputs: [] },
  { name: 'setBlocked', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tok', type: 'address' }, { name: 'b', type: 'bool' }], outputs: [] },
  { name: 'Launched', type: 'event', inputs: [{ name: 'token', type: 'address', indexed: true }, { name: 'curve', type: 'address', indexed: true }, { name: 'creator', type: 'address', indexed: true }, { name: 'referrer', type: 'address', indexed: false }, { name: 'devAmt', type: 'uint256', indexed: false }, { name: 'name', type: 'string', indexed: false }, { name: 'symbol', type: 'string', indexed: false }] }
]

export const CURVE_ABI = [
  { name: 'buy', type: 'function', stateMutability: 'payable', inputs: [{ name: 'minTokensOut', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'sell', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokensIn', type: 'uint256' }, { name: 'minMonOut', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'priceWeiPerToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'monRaisedNet', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'monRaised', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'buyBuffer', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalCreatorFees', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalPlatformFees', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalStakingFees', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'devTokenAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'bondedBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'graduated', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'creator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'capMon', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ath', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'launchedAt', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'pauseBuys', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pauseSells', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'vm', type: 'uint256' }, { name: 'vt', type: 'uint256' }, { name: 'rm', type: 'uint256' }, { name: 'rt', type: 'uint256' }] },
  { name: 'Buy', type: 'event', inputs: [{ name: 'buyer', type: 'address', indexed: true }, { name: 'monIn', type: 'uint256', indexed: false }, { name: 'tokensOut', type: 'uint256', indexed: false }, { name: 'newPrice', type: 'uint256', indexed: false }] },
  { name: 'Sell', type: 'event', inputs: [{ name: 'seller', type: 'address', indexed: true }, { name: 'tokensIn', type: 'uint256', indexed: false }, { name: 'monOut', type: 'uint256', indexed: false }, { name: 'newPrice', type: 'uint256', indexed: false }] },
  { name: 'DevBuy', type: 'event', inputs: [{ name: 'dev', type: 'address', indexed: true }, { name: 'monIn', type: 'uint256', indexed: false }, { name: 'tokensOut', type: 'uint256', indexed: false }] },
  { name: 'Graduated', type: 'event', inputs: [{ name: 'lpMon', type: 'uint256', indexed: false }, { name: 'creatorReward', type: 'uint256', indexed: false }, { name: 'platformReward', type: 'uint256', indexed: false }] },
  { name: 'FeeCollected', type: 'event', inputs: [{ name: 'kind', type: 'string', indexed: false }, { name: 'to', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] }
]

export const TOKEN_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amt', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }
]

export const STAKING_POOL_ABI = [
  { name: 'stake', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'tier', type: 'uint8' }], outputs: [] },
  { name: 'unstake', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'stakeIdx', type: 'uint256' }], outputs: [] },
  { name: 'claim', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'stakeIdx', type: 'uint256' }], outputs: [] },
  { name: 'claimAll', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'pendingReward', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'stakeIdx', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'pendingTotal', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'userStakeCount', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getStake', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'idx', type: 'uint256' }], outputs: [{ components: [{ name: 'amount', type: 'uint128' }, { name: 'weighted', type: 'uint128' }, { name: 'startedAt', type: 'uint64' }, { name: 'unlockAt', type: 'uint64' }, { name: 'tier', type: 'uint8' }, { name: 'rewardDebt', type: 'uint256' }], type: 'tuple' }] },
  { name: 'token', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'totalWeightedStaked', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'tierMultBps', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'tierDurations', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint32' }] },
  // Burn vault
  { name: 'burnVault', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalBurned', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'burnsToCreator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'creator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'burn', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'BurnVaultDeposit', type: 'event', inputs: [{ name: 'unstaker', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'newVault', type: 'uint256', indexed: false }] },
  { name: 'Burned', type: 'event', inputs: [{ name: 'by', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'totalBurned', type: 'uint256', indexed: false }] },
  { name: 'MonshiVaultRouted', type: 'event', inputs: [{ name: 'by', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] }
]

// ── Formatters ──
export function fmtMON(wei) {
  if (!wei && wei !== 0n) return '0'
  const n = Number(BigInt(wei)) / 1e18
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K'
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.001) return n.toFixed(4)
  return n.toFixed(8)
}

export function fmtUSD(wei, monPrice) {
  if (!wei && wei !== 0n) return '$0'
  const mon = Number(BigInt(wei)) / 1e18
  const usd = mon * (monPrice || 0)
  if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(2) + 'M'
  if (usd >= 1_000) return '$' + (usd / 1_000).toFixed(1) + 'K'
  if (usd >= 1) return '$' + usd.toFixed(2)
  if (usd >= 0.01) return '$' + usd.toFixed(3)
  return '$' + usd.toFixed(6)
}

export function fmtAddr(addr) {
  if (!addr) return '???'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

export function fmtTokens(wei) {
  if (!wei && wei !== 0n) return '0'
  const n = Number(BigInt(wei)) / 1e18
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(0)
}

export function fmtDuration(seconds) {
  const s = Number(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m`
  if (s < 86400) return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
  return `${Math.floor(s/86400)}d ${Math.floor((s%86400)/3600)}h`
}

export function timeAgo(ts) {
  const now = Date.now() / 1000
  const t = Number(ts)
  const diff = now - t
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

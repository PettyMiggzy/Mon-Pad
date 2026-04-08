// ── Addresses ──────────────────────────────────────────
export const FACTORY_ADDRESS   = '0xc1dF3c842C2e1Fb76656A8415D66B72A101366Bc'
export const PLATFORM_WALLET   = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16'
export const TREASURY_WALLET   = '0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd'
export const WMON_ADDRESS      = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'
export const NPM_ADDRESS       = '0xa9f6B6656e32F223d778b01642F32D00F5310526'
export const START_BLOCK       = 66664884n
export const CREATION_FEE      = 100n * 10n ** 18n
export const MIN_DEV_BUY       = 100n * 10n ** 18n
export const GRADUATION_TARGET = 425000n * 10n ** 18n

// ── Factory ABI ─────────────────────────────────────────
export const FACTORY_ABI = [
  {
        name: 'createLaunch',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
          { name: 'name',      type: 'string'  },
          { name: 'symbol',    type: 'string'  },
          { name: 'maxSupply', type: 'uint256' },
          { name: 'referrer',  type: 'address' },
              ],
        outputs: [
          { name: 'token',    type: 'address' },
          { name: 'curve',    type: 'address' },
{ name: 'grad',     type: 'address' },
              ],
  },
  {
        name: 'allCounts',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [
          { name: 't', type: 'uint256' },
          { name: 'c', type: 'uint256' },
          { name: 'g', type: 'uint256' },
              ],
  },
  {
        name: 'allTokens',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'uint256' }],
        outputs: [{ name: '', type: 'address' }],
  },
  {
        name: 'allCurves',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'uint256' }],
        outputs: [{ name: '', type: 'address' }],
  },
  {
        name: 'tokToCurve',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [{ name: '', type: 'address' }],
  },
  {
        name: 'minDevBuy',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
  },
  {
        name: 'Launched',
        type: 'event',
        inputs: [
          { name: 'token',    type: 'address', indexed: true  },
          { name: 'curve',    type: 'address', indexed: true  },
          { name: 'grad',     type: 'address', indexed: true  },
          { name: 'creator',  type: 'address', indexed: false },
          { name: 'referrer', type: 'address', indexed: false },
          { name: 'devAmt',   type: 'uint256', indexed: false },
              ],
  },
  ]

// ── Curve ABI ────────────────────────────────────────────
export const CURVE_ABI = [
  { name: 'buy',               type: 'function', stateMutability: 'payable',  inputs: [{ name: 'minOut', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'sell',              type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amt', type: 'uint256' }, { name: 'minMon', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'priceWeiPerToken',  type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'price',             type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'treasury',          type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'devTokenAmount',    type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'bondedBps',         type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'canGrad',           type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'graduated',         type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'creator',           type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'monRaisedNet',      type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'capMon',            type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ath',               type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'launchedAt',        type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'pauseBuys',         type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'pauseSells',        type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'delisted',          type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'devFrozen',         type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'devFreezeUntil',    type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'referrer',          type: 'function', stateMutability: 'view',     inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'Buy',  type: 'event', inputs: [{ name: 'buyer',  type: 'address', indexed: true }, { name: 'monIn',    type: 'uint256', indexed: false }, { name: 'tokensOut', type: 'uint256', indexed: false }] },
  { name: 'Sell', type: 'event', inputs: [{ name: 'seller', type: 'address', indexed: true }, { name: 'tokensIn', type: 'uint256', indexed: false }, { name: 'monOut',    type: 'uint256', indexed: false }] },
  { name: 'DevBuy', type: 'event', inputs: [{ name: 'dev', type: 'address', indexed: true }, { name: 'monIn', type: 'uint256', indexed: false }, { name: 'tokensOut', type: 'uint256', indexed: false }] },
  { name: 'DevFrozen', type: 'event', inputs: [{ name: 'dev', type: 'address', indexed: true }, { name: 'until', type: 'uint256', indexed: false }, { name: 'bps', type: 'uint256', indexed: false }] },
  { name: 'Graduated', type: 'event', inputs: [{ name: 'pool', type: 'address', indexed: false }, { name: 'id', type: 'uint256', indexed: false }] },
  ]

// ── Token ABI ────────────────────────────────────────────
export const TOKEN_ABI = [
  { name: 'name',        type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ name: '', type: 'string'  }] },
  { name: 'symbol',      type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ name: '', type: 'string'  }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf',   type: 'function', stateMutability: 'view',       inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance',   type: 'function', stateMutability: 'view',       inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve',     type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'curve',       type: 'function', stateMutability: 'view',       inputs: [], outputs: [{ name: '', type: 'address' }] },
  ]

// ── Helpers ──────────────────────────────────────────────
export const MONADSCAN = 'https://monadscan.com'

export function fmtMON(wei) {
    if (!wei && wei !== 0n) return '0'
    const n = Number(BigInt(wei)) / 1e18
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
    if (n >= 1_000)     return (n / 1_000).toFixed(2) + 'K'
    return n.toFixed(4)
}

export function fmtUSD(wei, monPrice) {
    if (!wei && wei !== 0n) return '$0'
    const mon = Number(BigInt(wei)) / 1e18
    const usd = mon * (monPrice || 0)
    if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(2) + 'M'
    if (usd >= 1_000)     return '$' + (usd / 1_000).toFixed(1) + 'K'
    return '$' + usd.toFixed(2)
}

export function fmtAddr(addr) {
    if (!addr) return '???'
    return addr.slice(0, 6) + '...' + addr.slice(-4)
}

export function fmtTokens(wei) {
    if (!wei && wei !== 0n) return '0'
    const n = Number(BigInt(wei)) / 1e18
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M'
    if (n >= 1_000)         return (n / 1_000).toFixed(2) + 'K'
    return n.toFixed(0)
}

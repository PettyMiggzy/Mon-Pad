// ── Addresses ──────────────────────────────────────────
export const FACTORY_ADDRESS   = '0xfEdC5df2F34Ec01Ac9cbc0c557a4BFD3de6C5c45'
export const PLATFORM_WALLET   = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16'
export const BUYBACK_WALLET    = '0xC77A81C4Cf1Dce5006141996D1c6B84E16621aD6'
export const TREASURY_WALLET   = '0xA270Ef94A8b6641D5470BCB1DA0836a89CEc2A03'
export const WMON_ADDRESS      = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'
export const NPM_ADDRESS       = '0x7197e214c0b767cfb76fb734ab638e2c192f4e53'
export const START_BLOCK       = 59737219n
export const CREATION_FEE      = 10n * 10n ** 18n   // 10 MON
export const GRADUATION_TARGET = 400_000n * 10n ** 18n

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
    ],
    outputs: [
      { name: 'token',    type: 'address' },
      { name: 'curve',    type: 'address' },
      { name: 'graduator',type: 'address' },
    ],
  },
  {
    name: 'allCounts',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'tokens', type: 'uint256' },
      { name: 'curves', type: 'uint256' },
      { name: 'grads',  type: 'uint256' },
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
    name: 'creationFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'Launched',
    type: 'event',
    inputs: [
      { name: 'token',    type: 'address', indexed: true },
      { name: 'curve',    type: 'address', indexed: true },
      { name: 'graduator',type: 'address', indexed: true },
      { name: 'creator',  type: 'address', indexed: false },
    ],
  },
]

// ── Curve ABI ────────────────────────────────────────────
export const CURVE_ABI = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'minTokensOut', type: 'uint256' }],
    outputs: [{ name: 'tokensOut', type: 'uint256' }],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'minMonOut',   type: 'uint256' },
    ],
    outputs: [{ name: 'monOut', type: 'uint256' }],
  },
  { name: 'priceWeiPerToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'bondedBps',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'canGraduate',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'graduated',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'monRaisedNet',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'tokensSold',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'creator',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'token',            type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'capMon',           type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'pauseBuys',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'pauseSells',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { name: 'delisted',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  {
    name: 'Buy',
    type: 'event',
    inputs: [
      { name: 'buyer',     type: 'address', indexed: true  },
      { name: 'monIn',     type: 'uint256', indexed: false },
      { name: 'tokensOut', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Sell',
    type: 'event',
    inputs: [
      { name: 'seller',   type: 'address', indexed: true  },
      { name: 'tokensIn', type: 'uint256', indexed: false },
      { name: 'monOut',   type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Graduated',
    type: 'event',
    inputs: [
      { name: 'pool',    type: 'address', indexed: false },
      { name: 'tokenId', type: 'uint256', indexed: false },
    ],
  },
]

// ── Token ABI ────────────────────────────────────────────
export const TOKEN_ABI = [
  { name: 'name',        type: 'function', stateMutability: 'view',        inputs: [],                                                      outputs: [{ name: '', type: 'string'  }] },
  { name: 'symbol',      type: 'function', stateMutability: 'view',        inputs: [],                                                      outputs: [{ name: '', type: 'string'  }] },
  { name: 'decimals',    type: 'function', stateMutability: 'view',        inputs: [],                                                      outputs: [{ name: '', type: 'uint8'   }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view',        inputs: [],                                                      outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf',   type: 'function', stateMutability: 'view',        inputs: [{ name: 'a',       type: 'address' }],                  outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance',   type: 'function', stateMutability: 'view',        inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve',     type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'curve',       type: 'function', stateMutability: 'view',        inputs: [],                                                      outputs: [{ name: '', type: 'address' }] },
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from',  type: 'address', indexed: true  },
      { name: 'to',    type: 'address', indexed: true  },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
]

// ── Helpers ──────────────────────────────────────────────
export const MONADSCAN = 'https://monadscan.io'

export function fmtMON(wei) {
  if (!wei) return '0'
  const n = Number(wei) / 1e18
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

export function fmtUSD(wei, monPrice) {
  if (!wei || !monPrice) return '$0'
  const mon = Number(wei) / 1e18
  const usd = mon * monPrice
  if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(2) + 'M'
  if (usd >= 1_000)     return '$' + (usd / 1_000).toFixed(1) + 'K'
  return '$' + usd.toFixed(2)
}

export function fmtAddr(addr) {
  if (!addr) return ''
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export function fmtTokens(wei) {
  if (!wei) return '0'
  const n = Number(wei) / 1e18
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}
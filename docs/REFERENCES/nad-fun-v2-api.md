# nad.fun V2 API & Contracts Reference

Saved 2026-05-16 for Mon-Pad future reference. Source: github.com/Naddotfun/api-intergration and nad-fun.gitbook.io/nad.fun/for-developers/contracts-and-abi

**IMPORTANT:** nad.fun's API only returns data for tokens launched through their platform. Mon-Pad tokens will NOT appear in these endpoints. This doc is for reference patterns (response shapes, salt mining, multi-quote architecture), NOT for live integration.

## Contract Addresses (Monad Mainnet)

| Component | Address |
|---|---|
| DEX_FACTORY | 0x6B5F564339DbAD6b780249827f2198a841FEB7F3 |
| WMON (mainnet) | 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A |
| BONDING_CURVE_ROUTER | 0x6F6B8F1a20703309951a5127c45B49b1CD981A22 |
| BONDING_CURVE (V3) | 0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE |
| DEX_ROUTER | 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137 |
| LENS | 0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea |

**V2 contract addresses (per nad.fun V2 release):**
- V2_NAD_FUN_ROUTER: 0x75588668999cA0557b78046b8a5E86b47b9234ec
- V2_BONDING_CURVE: 0x27063a38eC0D3281D354090EB92e669Ed1eB956C
- V2_PROTOCOL_MANAGER: 0x2F98030aBD7c59e3E5Dc6b4b66b6008821d0fB41
- V2_TOKEN_REGISTRY: 0x2Bc127be900aD290E703Cd2C71eB0EDCa162C898
- V2_CREATOR_FEE_VAULT: 0xfEB12B7698e296C57BBF9f0c9b38B3e908285A99
- V2_BURN_VAULT: 0xFA707fe7d2c2894bf0436c7B73947cBA9E888017
- V2_LP_VAULT: 0x2acD9C75fe16c909237D9e6f080210D26c8c956D
- V2_GIFT_VAULT: 0xC112EB5C40FC9A22425300D232A31d00FF840ad0
- LV_MON: 0xBe3fa50514D9617ce645a02B34F595541AF02b6b

ABI repo: https://github.com/Naddotfun/contract-v3-abi

## API Base URLs

- Mainnet: https://api.nad.fun
- Testnet: https://dev-api.nadapp.net

## Rate Limits

| Origin | API Key | Limit |
|---|---|---|
| External, no key | — | 10 req/min |
| External, with key | nadfun_xxx | 100 req/min |

## Response Shape Patterns (USEFUL FOR MON-PAD'S OWN INDEXER)

### Chart / OHLCV (`GET /v2/trade/chart/:token_id`)

```json
{
  "k": "price",
  "t": [1751460000, 1751460060],
  "c": ["0.00124", "0.00125"],
  "o": ["0.00123", "0.00124"],
  "h": ["0.00125", "0.00126"],
  "l": ["0.00122", "0.00123"],
  "v": ["1000.0", "1200.0"],
  "s": "ok"
}
```

No-data case: same shape with empty arrays and `"s": "no_data"`. Mon-Pad's lib/server.js should adopt this shape for the chart endpoint.

### Swap History (`GET /v2/trade/swap-history/:token_id`)

```json
{
  "swaps": [{
    "account_info": {
      "account_id": "0x...",
      "nickname": "Trader",
      "bio": "",
      "image_uri": "..."
    },
    "swap_info": {
      "event_type": "BUY",
      "native_amount": "...",
      "quote_amount": "...",
      "token_amount": "...",
      "native_price": "1.25",
      "quote_price": "1.25",
      "value": "1.25",
      "transaction_hash": "0x...",
      "created_at": 1754927984
    }
  }],
  "total_count": 100
}
```

Query params: page, limit (1-100), direction (ASC/DESC), volume_ranges (small/medium/large), account_id, trade_type (BUY/SELL/ALL)

### Holders (`GET /v2/trade/holder/:token_id`)

```json
{
  "holders": [{
    "account_info": {...},
    "balance_info": {
      "balance": "1000000000000000000000",
      "token_price": "0.00000028",
      "native_price": "1.25",
      "created_at": 1754927984
    }
  }],
  "total_count": 150
}
```

### Trading Metrics (`GET /v2/trade/metrics/:token_id`)

Multi-timeframe rollups. Timeframes: 1, 5, 15, 30, 60, 240, 1D (minutes)

```json
{
  "metrics": [{
    "timeframe": "1",
    "percent": 5.25,
    "transactions": {"buy": 150, "sell": 85, "total": 235},
    "volume": {"buy": "750000.50", "sell": "484567.39", "total": "1234567.89"},
    "makers": {"buy": 45, "sell": 32, "total": 77}
  }]
}
```

## Vanity Salt Mining (V2.2 candidate)

`POST /v2/token/salt` pre-computes CREATE2 salt server-side so resulting token address ends with a chosen suffix (their default: `7777`).

Implementation notes:
- CREATE2 deployer address + EIP-1167 clone implementation address
- Max iterations: 10,000,000
- Parallel mining chunk size: 10,000
- Returned `address` is the predicted address; verify on receipt

Useful for Mon-Pad if you ever want themed token addresses (e.g., ending in MONP).

## Multi-Quote-Asset Pattern (V2.3+ candidate)

nad.fun V2 supports any registered quote asset, not just native MON. Mon-Pad is MON-only today.

```solidity
struct CreateParams {
    string name;
    string symbol;
    string tokenURI;
    address quoteToken;        // <- WMON, LVMON, or any registered quote
    uint16 creatorFeeRate;     // BPS, allowlist: 100/300/500 (1%/3%/5%)
    IBondingCurve.VaultAllocation[] vaults;
    bytes32 salt;
    ITokenRegistry.DexType dexType;  // UniswapV2/V3/V4
    uint256 buyQuoteAmount;
    uint256 deadline;
}
```

Vault allocation: total bps across vaults must equal 10000, max 5 vaults.

## Token Creation Flow (REFERENCE)

1. `POST /metadata/image` (upload binary, returns image_uri)
2. `POST /metadata/metadata` (returns metadata_uri)
3. `POST /v2/token/salt` (mine vanity salt, returns predicted address)
4. Call `NadFunRouter.create()` or `createWithNative()` on-chain
5. Query `/v2/token/:token` after indexer catches up

## What NOT to Copy

- Their bonding curve contracts — different math, no creator revenue, no MONSHI staking
- Their router contracts — tied to NadFunPair post-graduation, Mon-Pad uses Uniswap V3
- Their token contracts — Mon-Pad has MonPadTokenV2 with clone pattern already
- Their Lens contract — wait for Mon-Pad's own spec (auditor flagged this earlier)

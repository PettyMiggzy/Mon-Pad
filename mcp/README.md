# @monpad/mcp

MCP server for [Monpad](https://www.monpad.net) that runs on your machine with **your own burner wallet**. For agents that should trade on their own.

**Most people don't need this.** Add the hosted connector `https://www.monpad.net/api/mcp` to Claude, ChatGPT, Cursor or VS Code (one click on [monpad.net/ai](https://www.monpad.net/ai)): no install, no key. The AI looks things up and hands you a link; you confirm in your own wallet.

## Install

```json
{
  "mcpServers": {
    "monpad": {
      "command": "npx",
      "args": ["-y", "@monpad/mcp"],
      "env": { "MONPAD_PRIVATE_KEY": "<a small burner wallet>" }
    }
  }
}
```

Monad mainnet addresses are built in. Reads need no key.

## Tools

| Tool | |
|---|---|
| `monpad_get_spec`, `monpad_get_monshi_burn` | Fees, addresses, your limits; MONSHI burned |
| `monpad_list_launches`, `monpad_get_token`, `monpad_trending` | Find coins (price and market cap in USD) |
| `monpad_wallet` | Your burner: address, MON, a coin's balance, claimable fees |
| `monpad_buy` | Buy with MON. Minimum out is set from a live quote (`slippagePct`, default 1) |
| `monpad_sell` | Sell `tokens` or a `percent` of your balance for MON |
| `monpad_launch_token` | Launch a coin (free), optional first buy in MON, creator tax 0 to 5% |
| `monpad_claim_fees` | Claim creator fees |

## Safety

- Every write is a **dry run** (a live quote) unless you pass `dryRun: false`.
- Sending needs `MONPAD_PRIVATE_KEY`. Use a burner wallet with only what you can lose.
- Caps: `MAX_MON_PER_TX` (default 5) and `MAX_MON_PER_DAY` (default 20). Sell proceeds count too.
- `RPC_URL` overrides the RPC. Contract addresses can be overridden with `MONPAD_LAUNCHER`, `MONPAD_HOOK`, `MONPAD_V4_ROUTER`.

## Test

`FORK_URL=http://127.0.0.1:8545 npm test` drives every tool against a local fork of Monad mainnet (19 checks).

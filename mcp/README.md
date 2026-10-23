# @monpad/mcp

MCP server for **Monpad Uniswap V4** launches on Monad. Agents can list launches, read pool stats, check MONSHI burns, and (with a **burner wallet**) simulate or send launch / buy / sell transactions.

> **Use a burner wallet.** Set `MONPAD_PRIVATE_KEY` to a dedicated low-balance key. Never use your main wallet. Write tools enforce `MAX_MON_PER_TX` (default 5 MON) and `MAX_MON_PER_DAY` (default 20 MON).

## Tools

| Tool | Access | Purpose |
|---|---|---|
| `monpad_get_spec` | read | V4 fee policy, addresses, safety limits |
| `monpad_get_monshi_burn` | read | MONSHI burned (dead balance) |
| `monpad_list_launches` | read | Recent V4 launches |
| `monpad_get_token` | read | Price, liquidity, volume, creator tax |
| `monpad_trending` | read | Rank by recent swap volume |
| `monpad_launch_token` | write | `launch()` on MonpadHookLauncher |
| `monpad_buy` | write | Payable `buyExactIn` on **MonpadV4Router** (`minTokensOut` required) |
| `monpad_sell` | write | `sellExactIn` on **MonpadV4Router** (`minMonOut` required) |

**Write tools default to `dryRun: true`** (simulate only; **no private key needed**). Pass `"dryRun": false` and set `MONPAD_PRIVATE_KEY` to broadcast. Buys always simulate before send.

There is **no bonding curve** — tokens launch straight into a V4 pool with `MonpadHook`.

## Install & run

```bash
cd mcp && npm install
export RPC_URL=https://rpc.monad.xyz
export MONPAD_LAUNCHER=0x…   # required when deployed
export MONPAD_HOOK=0x…
export MONPAD_V4_ROUTER=0x…  # MonpadV4Router (not TestV4Trader)
export MONPAD_PRIVATE_KEY=0x…  # burner only; required when dryRun=false
npm start
```

Or from npm (after publish):

```bash
npx -y @monpad/mcp
```

### Config file

`config.json` ships with **empty** `launcher` / `hook` / `v4Router`. Env vars override. If launcher/hook are unset, read tools that need them return: **contracts not deployed yet**.

## Claude Desktop

```json
{
  "mcpServers": {
    "monpad": {
      "command": "npx",
      "args": ["-y", "@monpad/mcp"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_LAUNCHER": "",
        "MONPAD_HOOK": "",
        "MONPAD_V4_ROUTER": ""
      }
    }
  }
}
```

## Cursor

```json
{
  "mcpServers": {
    "monpad": {
      "command": "node",
      "args": ["/absolute/path/to/Mon-Pad/mcp/server.mjs"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_LAUNCHER": "0x…",
        "MONPAD_HOOK": "0x…",
        "MONPAD_V4_ROUTER": "0x…",
        "MAX_MON_PER_TX": "5",
        "MAX_MON_PER_DAY": "20"
      }
    }
  }
}
```

## Test (Hardhat fork)

Requires the repo’s `hardhat-test` project (sibling directory) and a Monad RPC:

```bash
cd mcp && npm install
FORK_RPC=https://rpc.monad.xyz npm test
```

## Env reference

| Variable | Purpose |
|---|---|
| `MONPAD_LAUNCHER` | MonpadHookLauncher |
| `MONPAD_HOOK` | MonpadHook |
| `MONPAD_V4_ROUTER` | `MonpadV4Router` (payable buy + slippage) |
| `MONPAD_POOL_MANAGER` | Default: Monad V4 PoolManager |
| `MONPAD_STATE_VIEW` | Default: Monad StateView |
| `MONSHI` | MONSHI token |
| `MONPAD_PRIVATE_KEY` | Burner wallet (`dryRun=false` only) |
| `MONPAD_SIMULATE_ADDRESS` | Optional `from` for dry-run |
| `MAX_MON_PER_TX` | Default `5` (buys + sell proceeds) |
| `MAX_MON_PER_DAY` | Default `20` (MON spent + sell proceeds) |

See `CONTRACT-UV4.md` in the repo root for protocol details.

# Monpad MCP server

AI agents can discover launches, read the live Monchi burn counter, and
**deploy / buy / sell** on Monpad through the Model Context Protocol.

## Tools

| Tool | Access | Purpose |
|---|---|---|
| `monpad_get_spec` | read | Fees, platform wallet, bot policy |
| `monpad_get_monshi_burn` | read | Live MONSHI burned (dead balance) |
| `monpad_list_launches` | read | Recent tokens + curves |
| `monpad_get_curve` | read | Price / raised / graduated |
| `monpad_launch_token` | write | Create token + optional **dev bot** (`devBuyMon`) |
| `monpad_buy` | write | Buy with MON |
| `monpad_sell` | write | Sell for MON (platform fee in quote only) |

**No anti-sniper protection** — bots, snipers, and AI agents are first-class.

## Run

```bash
cd mcp && npm install
export RPC_URL=https://rpc.monad.xyz
export MONPAD_FACTORY=0x…          # live factory
export MONPAD_PRIVATE_KEY=0x…      # only for write tools
npm start
```

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "monpad": {
      "command": "node",
      "args": ["/absolute/path/to/Mon-Pad/mcp/server.mjs"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_FACTORY": "0x…",
        "MONPAD_PRIVATE_KEY": "0x…"
      }
    }
  }
}
```

Companion surfaces: HTTP `/api/v1/spec` + `/api/v1/burn`, TypeScript `@monpad/sdk`.

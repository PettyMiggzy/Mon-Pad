# Mon-Pad — Testing

Two layers, both runnable without spending real MON.

## 1. Unit tests (logic, mocks) — `hardhat-test/`

```bash
cd hardhat-test
npm test          # 33 passing — full create→buy→sell→graduate on mocked WMON/DEX
```

Covers the V3 native-MON pad (`test/v3-flow.js`), the earlier V2.1 flow, and the
MONSHI variant. Fast, deterministic, no network.

## 2. Mainnet-fork end-to-end (the REAL deployed contracts) — zero real MON

This forks Monad **mainnet** state and drives the *actual deployed* factory +
curve-clone bytecode through the whole lifecycle using a synthetic balance. It is
the closest thing to a live dry-run without spending anything or touching the real
chain. Requires [foundry](https://book.getfoundry.sh/) (`anvil`):

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # one-time

cd hardhat-test
npm run fork:e2e -- "<monad-mainnet-rpc-url>"
# or: MAINNET_RPC=<rpc> npm run fork:e2e
```

What it asserts (`scripts/fork-e2e-anvil.js`), all against the live addresses in
`MONPAD-V3-DEPLOYED.md`:

| Step | Check |
|------|-------|
| read config | factory bootstrapped, launches not paused, creationFee=500 MON, gradTarget=260k MON |
| create + dev buy | `createLaunch` emits `Launch`; dev buy delivers tokens (≤2% cap) |
| sell | seller is paid native MON (curve balance drops by the payout) |
| buys | curve reaches the 260k MON graduation target |
| graduate | `graduate()` succeeds and creates the WMON/token DEX pool |
| events | `Trade` events emitted (the source the chart + trades feed read) |

Last run: **9/9 passed** — e.g. sell paid the seller `+98.218 MON` (curve
`−98.218`), graduation succeeded (~5.4M gas), 11 `Trade` events emitted.

### Verifying balances on a fork

`anvil` mines instantly; **ethers v6 dedupes `getBalance("latest")`** calls made
right after a mined tx and can return stale values. The harness reads balances at
explicit block tags to avoid this. For one-off checks prefer `cast` (separate
process) — `cast balance <addr> --rpc-url http://127.0.0.1:8545` — or trace a tx
with `cast run <txhash>` to see the actual internal value transfers.

## 3. Real on-chain dry-run (optional, costs a little MON)

To exercise the **frontend + DexScreener events for real**, deploy a second
"staging" factory with small economics (e.g. 1 MON creation, ~50 MON graduation)
via `scripts/deployV3.js` with tuned params, run a create→buy→graduate from a
funded wallet, confirm the live site renders it (home list, token page, chart,
trades feed, graduation), then point the app back at the production factory.

# V2.1 audit-fix smoke tests

Six focused tests that verify each of the post-audit invariants on a fresh hardhat node.

## Setup

```bash
cd hardhat-test
npm install
```

## Run

```bash
npx hardhat compile
npx hardhat test
```

Expected: 6 passing.

## What's covered

| Audit ID | What it asserts |
|---|---|
| V2.1-1  | `Factory.createLaunch` calls `Hub.setCurveAuthorized(curve, true)`, so sells succeed |
| V2.1-2  | `MonPadGraduator.onGraduate` reverts `NotCurve` when called by a non-curve EOA |
| V2.1-3  | Dev buy with sub-100-MON value succeeds (was reverting in V2 due to `minDevBuyMon=100 ether`) |
| V2.1-5  | Buy/sell creator fees accumulate in `creatorPending`; `claimCreatorRewards()` drains |
| V2.1-6  | `_graduate` sends `address(this).balance - creatorPending` (variable LP, not hardcoded 400k) |
| V2.1-10 | Pool reads `treasuryWallet` live from factory; rotation propagates to existing pools |
| V2.1-14 | `_graduate` reverts `"insufficient for grad"` upfront if `creatorReward` exceeds budget |
| V2.1-16 | Hub pins `curveToken[curve]` at authorize time |

## What's NOT covered

- **Real Uniswap V3 LP minting** — `MonPadGraduator`'s V3 path is exercised by deploying
  on a Monad fork with real WMON + NPM addresses, not by these tests. The tests wire the
  factory to a `MockGraduator` that records inputs but skips V3.
- **The real Graduator's full LP flow** — only its auth check (V2.1-2) is tested, since
  the rest needs a live Uniswap V3 stack.
- **Server / frontend** — separate concerns; tested manually.
- **Holders endpoint scanner** — TODO on the server.

## Running on a Monad fork

If you want to exercise the full Graduator flow including V3 LP creation, edit
`hardhat.config.js` to add a forking block:

```js
networks: {
  hardhat: {
    forking: {
      url: process.env.MONAD_RPC || "https://rpc.monad.xyz",
    },
  },
}
```

Then in the tests, deploy `MonPadGraduator` with the **real** Monad WMON + NPM
addresses (`0x3bd359...` and `0xa9f6B6...`) and let the V2.1-6 graduation test run end-to-end.
The test suite does not currently include this scenario — add it when you're ready to
verify against the actual Monad V3 stack.

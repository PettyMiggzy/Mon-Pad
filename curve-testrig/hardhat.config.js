require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// MonPad V4 — curve-on-Uniswap-V4 pad for Monad (chain 143).
//
// Compiler is pinned to the settings the suite was audited under: solc 0.8.26, viaIR,
// optimizer runs 1, evmVersion cancun. Monad supports every Ethereum opcode including
// EIP-1153 transient storage (the live V4 PoolManager at 0x188d58... depends on it), so
// cancun is correct here.
//
// The same holds for Robinhood Chain (4663), the venue AtomicExperimentPad targets, whose
// _devBuy latch uses TSTORE/TLOAD. MEASURED against https://api.robinlab.io/rpc on 2026-08-15,
// not inferred: eth_call of raw initcode 0x604260005d60005c60005260206000f3 (TSTORE(0,0x42);
// TLOAD(0); return it) returned 0x..42, while the negative control 0x0c60005260206000f3
// returned "invalid opcode: opcode 0xc not defined" — so the probe discriminates rather than
// swallowing everything. MCOPY (0x5e) and PUSH0 (0x5f) execute too: the full Cancun set is live.
//
// Never change these without re-mining hook salts: the mined salt depends on the exact
// init-code hash, which depends on the compiler and its settings.
//
// NOTE on optimizer runs: Monad's contract size limit is 128 KB (vs Ethereum's 24 KB), so
// `runs: 1` is no longer forced on us by size pressure and could be raised to cut per-swap
// gas. Left at 1 for now so the deployed bytecode matches what was audited; revisit as a
// deliberate, separately-measured change.
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    // FORK_RPC set → in-process fork of Monad so tests run against the REAL v4 PoolManager
    // 0x188d586ddcf52439676ca21a244753fa19f9ea8e. Never commit the key:
    //   FORK_RPC=<url> npx hardhat test test/fork/*.js
    hardhat: process.env.FORK_RPC
      ? {
          forking: { url: process.env.FORK_RPC },
          chainId: Number(process.env.FORK_CHAINID || 143),
          hardfork: "cancun",
          chains: {
            143: { hardforkHistory: { cancun: 0 } },
            10143: { hardforkHistory: { cancun: 0 } },
            // Robinhood Chain — the venue AtomicExperimentPad targets. Needed only by
            // test/fork/atomic-pad-robinhood.fork.test.js, which is skipped unless FORK_RPC is set.
            //
            // cancun:0 is a claim about the VENUE, and pinning it means a fork rehearsal can never
            // falsify it — so it was measured directly instead (probe + negative control recorded in
            // the header comment above, 2026-08-15). Corroborating: the cached 4663 fork headers carry
            // a mixHash encoding an L1 block number and a type-0x6a ArbitrumInternalTx, i.e. an
            // Arbitrum Nitro chain at ArbOS 20+ (Dencun). Re-probe before trusting this against a
            // different endpoint or chain.
            4663: { hardforkHistory: { cancun: 0 } },
          },
        }
      : {},
    // Monad mainnet. Monad supports EIP-1559 (type-2) txs, so deploy scripts must NOT force
    // legacy type-0 with an explicit gasPrice. Base fee is live (observed ~100 gwei, not the
    // 50 gwei hardcode the docs still describe).
    //
    // CORRECTION (2026-08-15): this comment used to say "unlike Robinhood Chain". That was wrong.
    // Live 4663 headers carry baseFeePerGas (0x24b6ed0, ~0.038 gwei), so Robinhood Chain is
    // EIP-1559 too — let ethers negotiate fees there as well. See the `robinhood` entry below.
    monad: {
      url: process.env.MONAD_RPC || "https://rpc.monad.xyz",
      chainId: 143,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    monadTestnet: {
      url: process.env.TESTNET_RPC || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // Robinhood Chain — where AtomicExperimentPad actually deploys and where the arms run.
    // Without this entry the documented `--network robinhood` commands in
    // scripts/deploy-experiment-pad.js and scripts/run-arm.js are unrunnable, and a deploy
    // blocked at the last step is the moment people improvise with the wrong key or the wrong RPC.
    //
    // This is a LIVE MONEY chain and this entry wires PRIVATE_KEY straight into it. Keep
    // PRIVATE_KEY an OPERATOR key, never the owner. The real guards are the constructor's
    // chainid assert and the deploy script's CONFIRM_LIVE_DEPLOY acknowledgement.
    // No hardcoded gasPrice / type-0: 4663 has a live base fee (see the note on `monad`).
    robinhood: {
      url: process.env.ROBINHOOD_RPC || "https://api.robinlab.io/rpc",
      chainId: 4663,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: { monad: process.env.EXPLORER_API_KEY || "none" },
    customChains: [
      {
        network: "monad",
        chainId: 143,
        urls: {
          apiURL: process.env.EXPLORER_API_URL || "https://api.monadscan.com/api",
          browserURL: "https://monadscan.com",
        },
      },
    ],
  },
};

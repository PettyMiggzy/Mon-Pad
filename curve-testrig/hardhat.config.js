require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// MonPad V4 — curve-on-Uniswap-V4 pad for Monad (chain 143).
//
// Compiler is pinned to the settings the suite was audited under: solc 0.8.26, viaIR,
// optimizer runs 1, evmVersion cancun. Monad supports every Ethereum opcode including
// EIP-1153 transient storage (the live V4 PoolManager at 0x188d58... depends on it), so
// cancun is correct here.
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
            4663: { hardforkHistory: { cancun: 0 } },
          },
        }
      : {},
    // Monad mainnet. Unlike Robinhood Chain, Monad DOES support EIP-1559 (type-2) txs, so
    // deploy scripts must NOT force legacy type-0 with an explicit gasPrice. Base fee is
    // live (observed ~100 gwei, not the 50 gwei hardcode the docs still describe).
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

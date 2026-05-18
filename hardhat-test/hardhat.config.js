require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Hardhat is now the canonical compiler for both test AND mainnet builds.
      // Network config below. revertStrings:"default" preserves require messages
      // for both test assertions and on-chain debugging.
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      evmVersion: "paris",
      debug: { revertStrings: "default" },
      metadata: { bytecodeHash: "none", appendCBOR: false },
    },
  },
  networks: {
    hardhat: process.env.FORK_RPC ? {
      forking: { url: process.env.FORK_RPC },
    } : {},
    // Live networks are only registered when their RPC env is set.
    // Missing env -> network simply doesn't exist -> deploy fails fast
    // with "network not found" rather than silently using a default.
    ...(process.env.TESTNET_RPC ? {
      monadTestnet: {
        url: process.env.TESTNET_RPC,
        chainId: 10143,
        accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      },
    } : {}),
    ...(process.env.MAINNET_RPC ? {
      monadMainnet: {
        url: process.env.MAINNET_RPC,
        chainId: 143,
        accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
      },
    } : {}),
  },
};

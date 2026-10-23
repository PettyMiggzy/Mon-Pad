require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    // 0.8.24 for the original contracts; 0.8.26 for files that need it (the Uniswap V4 libraries). Same settings.
    // Hardhat picks the compiler per file from its pragma.
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 1 },
          viaIR: true,
          evmVersion: "paris",
          debug: { revertStrings: "default" },
          metadata: { bytecodeHash: "none", appendCBOR: false },
        },
      },
      {
        version: "0.8.26",
        settings: {
          optimizer: { enabled: true, runs: 1 },
          viaIR: true,
          evmVersion: "paris",
          debug: { revertStrings: "default" },
          metadata: { bytecodeHash: "none", appendCBOR: false },
        },
      },
    ],
  },
  sourcify: { enabled: true },
  etherscan: {
    apiKey: { monadMainnet: process.env.EXPLORER_API_KEY || "noned" },
    customChains: [{
      network: "monadMainnet",
      chainId: 143,
      urls: {
        apiURL: process.env.EXPLORER_API_URL || "https://api.monadscan.com/api",
        browserURL: "https://monadscan.com",
      },
    }],
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

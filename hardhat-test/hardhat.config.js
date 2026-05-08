require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // runs=1 optimizes for deployed bytecode size (the factories embed the
      // bytecode of the contracts they `new`-deploy, so they bloat past EIP-170's
      // 24576-byte limit at runs=200). Trade-off: ~5-15% higher per-call gas,
      // acceptable for the factory pattern used here.
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      // EVM version pinned to paris (matches Remix deploy + production target).
      evmVersion: "paris",
    },
  },
  // Local hardhat node by default. To run against a Monad fork:
  //   forking: { url: process.env.MONAD_RPC || 'https://rpc.monad.xyz' }
  // (forking is NOT enabled here — the audit tests don't need real V3 contracts;
  //  they use Mocks.sol for WMON / NPM / Uni V3 factory.)
};

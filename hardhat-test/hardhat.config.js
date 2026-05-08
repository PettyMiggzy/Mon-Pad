require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
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

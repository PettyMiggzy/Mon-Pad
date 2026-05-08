require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // EIP-170 cap is 24576 bytes for deployed code. The factories embed the
      // creation code of the contracts they `new`-deploy (Curve+Token in
      // MonPadFactoryV2, Pool in MonPadPoolFactory), so they bloat past the
      // limit. Stack of size optimizations:
      //   - runs:1                    — optimize for deploy size, not call gas
      //   - revertStrings:"strip"     — drop human-readable require messages
      //   - metadata.bytecodeHash:    — drop IPFS metadata appended to bytecode
      //   - metadata.appendCBOR:false — drop the trailing CBOR metadata blob
      // Combined this saves ~3-5KB across the factories. If it's still not
      // enough, the next step is a Clones/EIP-1167 minimal-proxy refactor of
      // the Curve so the factory only embeds a tiny proxy stub instead of the
      // full Curve creation code.
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      evmVersion: "paris",
      debug: { revertStrings: "strip" },
      metadata: { bytecodeHash: "none", appendCBOR: false },
    },
  },
  // Local hardhat node by default. To run against a Monad fork:
  //   forking: { url: process.env.MONAD_RPC || 'https://rpc.monad.xyz' }
  // (forking is NOT enabled here — the audit tests don't need real V3 contracts;
  //  they use Mocks.sol for WMON / NPM / Uni V3 factory.)
};

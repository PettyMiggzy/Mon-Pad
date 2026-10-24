const routes = require("../../config/uv4-fork.routes.json");

function monUsdcPoolKey(ethers) {
  const p = routes.monUsdcPool;
  return {
    currency0: p.currency0,
    currency1: p.currency1,
    fee: p.fee,
    tickSpacing: p.tickSpacing,
    hooks: p.hooks,
  };
}

/** Best-effort USDC balance for fork tests (Circle USDC balance mapping slot 9). */
async function fundUsdc(hre, account, amount) {
  const usdc = routes.quoteToken;
  const slot = 9;
  const index = hre.ethers.keccak256(
    hre.ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, slot]),
  );
  await hre.network.provider.send("hardhat_setStorageAt", [
    usdc,
    index,
    hre.ethers.zeroPadValue(hre.ethers.toBeHex(amount), 32),
  ]);
}

module.exports = { routes, monUsdcPoolKey, fundUsdc };

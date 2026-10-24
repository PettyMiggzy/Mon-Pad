const routes = require("../../config/uv4-fork.routes.json");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const STATE_VIEW = "0x77395f3b2e73ae90843717371294fa97cc419d64";
const ZERO = "0x0000000000000000000000000000000000000000";

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

function poolId(ethers, key) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

async function assertMonUsdcConfigMatchesChain(ethers, sv) {
  const cfg = routes.monUsdcPool;
  const key = monUsdcPoolKey(ethers);
  const id = poolId(ethers, key);
  const [sqrtP, , , lpFee] = await sv.getSlot0(id);
  if (sqrtP === 0n) throw new Error("configured MON/USDC pool is not initialized on fork");
  const liq = await sv.getLiquidity(id);
  if (liq === 0n) throw new Error("configured MON/USDC pool has zero liquidity on fork");
  if (Number(key.fee) !== Number(cfg.fee)) throw new Error("config static fee mismatch");
  if (Number(lpFee) !== Number(cfg.fee)) throw new Error(`live lpFee ${lpFee} != config ${cfg.fee}`);
  if (Number(key.tickSpacing) !== Number(cfg.tickSpacing)) throw new Error("config tickSpacing mismatch");
  if (key.hooks.toLowerCase() !== cfg.hooks.toLowerCase()) throw new Error("config hooks mismatch");
  return { sqrtP, liq, lpFee: Number(lpFee) };
}

/** Fund an EOA with USDC using real MON→USDC swap on the live MON/USDC pool (no storage hacks). */
async function fundUsdcViaMonSwap(hre, { trader, recipient, monAmount }) {
  await setBalanceIfNeeded(hre, trader.target, monAmount);
  const key = monUsdcPoolKey(hre.ethers);
  await trader.swapMonForUsdc(key, monAmount);
  const usdc = await hre.ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"],
    routes.quoteToken,
  );
  const bal = await usdc.balanceOf(trader.target);
  if (recipient.toLowerCase() === trader.target.toLowerCase()) return bal;
  const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [trader.target] });
  await setBalance(trader.target, hre.ethers.parseEther("10"));
  const signer = await hre.ethers.getSigner(trader.target);
  await usdc.connect(signer).transfer(recipient, bal);
  return bal;
}

async function setBalanceIfNeeded(hre, account, monAmount) {
  const bal = await hre.ethers.provider.getBalance(account);
  if (bal >= monAmount) return;
  const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");
  await setBalance(account, monAmount * 2n);
}

async function seedUsdcMonshiPool(trader, monshi, fee = 10000, tickSpacing = 200) {
  const usdc = routes.quoteToken;
  const c0 = usdc.toLowerCase() < monshi.toLowerCase() ? usdc : monshi;
  const c1 = usdc.toLowerCase() < monshi.toLowerCase() ? monshi : usdc;
  const key = { currency0: c0, currency1: c1, fee, tickSpacing, hooks: ZERO };
  await trader.seed(key, 0, -600, 600, 1_000_000_000_000n);
  return key;
}

/** Keep USDC on the TestV4Trader contract (MON→USDC swaps on the live pool). */
async function ensureTraderUsdc(hre, trader, minUsdc) {
  const usdc = await hre.ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    routes.quoteToken,
  );
  let monChunk = hre.ethers.parseEther("30000");
  for (let i = 0; i < 10; i++) {
    if ((await usdc.balanceOf(trader.target)) >= minUsdc) return;
    await setBalanceIfNeeded(hre, trader.target, monChunk * 2n);
    await trader.swapMonForUsdc(monUsdcPoolKey(hre.ethers), monChunk);
    monChunk *= 2n;
  }
  if ((await usdc.balanceOf(trader.target)) < minUsdc) {
    throw new Error("ensureTraderUsdc: fork MON/USDC depth insufficient");
  }
}

module.exports = {
  routes,
  POOL_MANAGER,
  STATE_VIEW,
  monUsdcPoolKey,
  poolId,
  assertMonUsdcConfigMatchesChain,
  fundUsdcViaMonSwap,
  seedUsdcMonshiPool,
  ensureTraderUsdc,
};

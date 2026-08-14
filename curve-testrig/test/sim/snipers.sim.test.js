const { ethers } = require("hardhat");
const { expect } = require("chai");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// SIM — WHAT DO SNIPERS ACTUALLY EXTRACT?
//
// Before building anti-snipe (or pro-snipe) machinery, measure whether sniping is even profitable on THIS
// curve. The answer is not obvious: the curve is a real concentrated-liquidity V4 position, so a sniper eats
// slippage going in AND coming out, plus 1% buy tax, 1% sell tax and 1% LP fee on each leg. That is a lot of
// friction to overcome, and it may already price them out without any new mechanism.
//
// Scenario, all against the real MonPadCurveV4 + MonPadFeeHook on a live-local PoolManager at production
// geometry:
//   1. N snipers buy in the opening block
//   2. M retail buyers follow
//   3. the snipers dump everything
//   4. measure each cohort's cost basis, the snipers' realised P&L, and what retail is left holding
//
// This is the baseline the sell-decay theory has to beat. If snipers already lose money, the theory is
// solving a problem that does not exist and we should attract them instead of taxing them.

const ZERO = ethers.ZeroAddress;
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const ONE = 10n ** 18n;
const MIN_SQRT_LIMIT = 4295128739n + 1n;
const MAX_SQRT_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;

const START = 87300, WIDTH = 23000, GRAD = START - WIDTH, TS = 100, FEE = 10000, MINGRAD = 22800;
const SUPPLY = 1_000_000_000n * ONE;
const CURVE = 730_000_000n * ONE;
const RESERVE = 270_000_000n * ONE;
const MON_USD = 0.021;

const N_SNIPERS = 3;
const SNIPE_EACH = 5_000;   // MON per sniper in the opening block
const N_RETAIL = 10;
const RETAIL_EACH = 8_000;  // MON per retail buyer

function poolIdOf(k) {
  return ethers.keccak256(
    abi.encode(["tuple(address,address,uint24,int24,address)"], [[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]])
  );
}

describe("SIM — sniper economics on the live curve (baseline, no anti-snipe)", () => {
  it("measures what snipers extract from retail at production geometry", async () => {
    const signers = await ethers.getSigners();
    const [deployer, platform, creator] = signers;
    const snipers = signers.slice(3, 3 + N_SNIPERS);
    const retail = signers.slice(3 + N_SNIPERS, 3 + N_SNIPERS + N_RETAIL);
    for (const s of [...snipers, ...retail]) {
      await ethers.provider.send("hardhat_setBalance", [s.address, "0x" + (10n ** 24n).toString(16)]);
    }

    // ── stack ──
    const pm = await (await ethers.getContractFactory("PoolManager")).deploy(deployer.address);
    const stateView = await (await ethers.getContractFactory("MonPadStateView")).deploy(await pm.getAddress());
    const dep = await (await ethers.getContractFactory("DeterministicDeployer")).deploy();
    const reg = await (await ethers.getContractFactory("FeeWalletRegistry")).deploy(platform.address, deployer.address);
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const posm = await (await ethers.getContractFactory("MockPositionManagerV4")).deploy(await pm.getAddress(), await permit2.getAddress());
    const lockVault = await (await ethers.getContractFactory("LockVault")).deploy(await posm.getAddress(), await reg.getAddress());
    const curveDep = await (await ethers.getContractFactory("CurveV4Deployer")).deploy(await dep.getAddress());
    const stakeDep = await (await ethers.getContractFactory("StakingDeployer")).deploy(await dep.getAddress());
    const feeCfg = await (await ethers.getContractFactory("MonPadV4FeeConfig")).deploy(deployer.address, {
      buyTaxBps: 100, sellTaxBps: 100, sellFloorShareBps: 0, buyLpFloorShareBps: 0, buyBufferShareBps: 2000, referralShareBps: 0,
      platformGradBps: 2000, creatorGradBps: 1500, ambushGradBps: 0,
      lpFee: FEE, startTickMag: START, curveWidth: WIDTH, minGradWidth: MINGRAD,
    });
    const factory = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
      await pm.getAddress(), await posm.getAddress(), await permit2.getAddress(), await stateView.getAddress(),
      await dep.getAddress(), await curveDep.getAddress(), await stakeDep.getAddress(), await feeCfg.getAddress(),
      await reg.getAddress(), await lockVault.getAddress()
    );
    await lockVault.setFactory(await factory.getAddress());

    const cfg = { name: "Snipe", symbol: "SNP", decimals: 18, supply: SUPPLY, curveSupply: CURVE, reserveSupply: RESERVE, tickSpacing: TS, creator: creator.address };
    const tokenSalt = ethers.id("snp-tok"), curveSalt = ethers.id("snp-curve");
    const TokenF = await ethers.getContractFactory("PadToken");
    const tokenInit = ethers.concat([TokenF.bytecode, abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await factory.getAddress()])]);
    const predictedToken = ethers.getCreate2Address(await dep.getAddress(), tokenSalt, ethers.keccak256(tokenInit));
    const HookF = await ethers.getContractFactory("MonPadFeeHook");
    const { salt: hookSalt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, await pm.getAddress(), await factory.getAddress(), await reg.getAddress(), predictedToken));
    const [token, hook] = await factory.launch.staticCall(cfg, tokenSalt, hookSalt, curveSalt);
    await (await factory.launch(cfg, tokenSalt, hookSalt, curveSalt)).wait();

    const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: TS, hooks: hook };
    const poolId = poolIdOf(key);
    const tok = await ethers.getContractAt("PadToken", token);
    const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(await pm.getAddress());
    const swAddr = await sw.getAddress();

    const tickNow = async () => Number((await stateView.getSlot0(poolId))[1]);
    const priceUsd = (tick) => MON_USD / Math.pow(1.0001, tick); // MON per token * MON/USD
    const buy = async (who, mon) => {
      const before = await ethers.provider.getBalance(who.address);
      const tb = await tok.balanceOf(who.address);
      const rc = await (await sw.connect(who).swap(
        key, { zeroForOne: true, amountSpecified: -E(mon), sqrtPriceLimitX96: MIN_SQRT_LIMIT },
        { takeClaims: false, settleUsingBurn: false }, "0x", { value: E(mon) }
      )).wait();
      const spent = before - (await ethers.provider.getBalance(who.address)) - rc.gasUsed * rc.gasPrice;
      return { spent, got: (await tok.balanceOf(who.address)) - tb };
    };
    const sell = async (who, amt) => {
      await (await tok.connect(who).approve(swAddr, amt)).wait();
      const before = await ethers.provider.getBalance(who.address);
      const rc = await (await sw.connect(who).swap(
        key, { zeroForOne: false, amountSpecified: -amt, sqrtPriceLimitX96: MAX_SQRT_LIMIT },
        { takeClaims: false, settleUsingBurn: false }, "0x"
      )).wait();
      return (await ethers.provider.getBalance(who.address)) - before + rc.gasUsed * rc.gasPrice;
    };

    // ── 1. snipers buy in the opening block ──
    const snipeIn = [], snipeTok = [];
    for (const s of snipers) {
      const r = await buy(s, SNIPE_EACH);
      snipeIn.push(r.spent); snipeTok.push(r.got);
    }
    const tickAfterSnipe = await tickNow();

    // ── 2. retail follows ──
    const retailIn = [], retailTok = [];
    for (const r of retail) {
      const x = await buy(r, RETAIL_EACH);
      retailIn.push(x.spent); retailTok.push(x.got);
    }
    const tickAfterRetail = await tickNow();

    // ── 3. snipers dump everything ──
    let snipeOut = 0n;
    for (let i = 0; i < snipers.length; i++) {
      snipeOut += await sell(snipers[i], snipeTok[i]);
    }
    const tickAfterDump = await tickNow();

    // ── measure ──
    const sum = (a) => a.reduce((x, y) => x + y, 0n);
    const f = (w) => Number(w) / 1e18;
    const snipeInTotal = sum(snipeIn), retailInTotal = sum(retailIn);
    const snipeTokTotal = sum(snipeTok), retailTokTotal = sum(retailTok);
    const sniperPnl = snipeOut - snipeInTotal;
    const sniperRoi = (Number(sniperPnl) / Number(snipeInTotal)) * 100;

    // cost basis, MON per whole token
    const snipeBasis = f(snipeInTotal) / f(snipeTokTotal);
    const retailBasis = f(retailInTotal) / f(retailTokTotal);
    // what retail's bag is worth at the post-dump price
    const pxAfterDump = 1 / Math.pow(1.0001, tickAfterDump);
    const retailValue = f(retailTokTotal) * pxAfterDump;
    const retailPnl = retailValue - f(retailInTotal);

    console.log(`
      ── entry ─────────────────────────────────────────────
      snipers   ${N_SNIPERS} x ${SNIPE_EACH.toLocaleString()} MON  ->  ${(f(snipeTokTotal) / 1e6).toFixed(1)}M token  (${(f(snipeTokTotal) / 1e9 * 100).toFixed(1)}% of supply)
      retail    ${N_RETAIL} x ${RETAIL_EACH.toLocaleString()} MON  ->  ${(f(retailTokTotal) / 1e6).toFixed(1)}M token
      sniper cost basis  ${snipeBasis.toExponential(3)} MON/token  ($${(snipeBasis * MON_USD).toExponential(2)})
      retail cost basis  ${retailBasis.toExponential(3)} MON/token  ($${(retailBasis * MON_USD).toExponential(2)})
      retail paid ${(retailBasis / snipeBasis).toFixed(2)}x the sniper price
      ── ticks ─────────────────────────────────────────────
      launch ${START}  ->  after snipe ${tickAfterSnipe}  ->  after retail ${tickAfterRetail}  ->  after dump ${tickAfterDump}
      price move on the dump: ${((Math.pow(1.0001, tickAfterRetail - tickAfterDump) - 1) * 100).toFixed(1)}%
      ── outcome ───────────────────────────────────────────
      sniper in   ${f(snipeInTotal).toFixed(0)} MON
      sniper out  ${f(snipeOut).toFixed(0)} MON
      sniper P&L  ${f(sniperPnl) > 0 ? "+" : ""}${f(sniperPnl).toFixed(0)} MON  ($${(f(sniperPnl) * MON_USD).toFixed(0)})   ROI ${sniperRoi.toFixed(1)}%
      retail bag  ${retailValue.toFixed(0)} MON vs ${f(retailInTotal).toFixed(0)} paid  ->  ${retailPnl > 0 ? "+" : ""}${retailPnl.toFixed(0)} MON (${(retailPnl / f(retailInTotal) * 100).toFixed(1)}%)
      ──────────────────────────────────────────────────────`);

    // ── 4. what sell tax would make this unprofitable? ──
    // The realised exit was net of the CURRENT 1% sell tax, so gross out = snipeOut / 0.99. Re-price that
    // gross against other tax levels to find where a first-minute flip stops paying. This is the number the
    // decaying-sell-tax design actually has to hit — guessing 30% is not good enough if 30% still pays.
    const grossOut = Number(snipeOut) / 0.99;
    const inWei = Number(snipeInTotal);
    const breakEvenBps = Math.round((1 - inWei / grossOut) * 10000);
    let table = "";
    for (const bps of [100, 1000, 2000, 3000, 4000, 5000, 6000]) {
      const net = grossOut * (1 - bps / 10000);
      const pnl = (net - inWei) / 1e18;
      const roi = ((net - inWei) / inWei) * 100;
      table += `      sell tax ${String(bps / 100).padStart(2)}%  ->  P&L ${pnl > 0 ? "+" : ""}${pnl.toFixed(0).padStart(6)} MON   ROI ${roi > 0 ? "+" : ""}${roi.toFixed(1)}%${roi <= 0 ? "   <-- unprofitable" : ""}\n`;
    }
    console.log(`      ── what sell tax kills the flip? ─────────────────────
${table}      BREAK-EVEN SELL TAX = ${(breakEvenBps / 100).toFixed(1)}%
      ──────────────────────────────────────────────────────`);

    // sanity: the mechanics worked
    expect(f(snipeTokTotal)).to.be.gt(0);
    expect(f(retailTokTotal)).to.be.gt(0);
    expect(tickAfterRetail).to.be.lt(tickAfterSnipe); // buys walk the tick DOWN
    expect(tickAfterDump).to.be.gt(tickAfterRetail);  // the dump walks it back UP
    // retail always pays more than the snipers — that is the definition of the problem
    expect(retailBasis).to.be.gt(snipeBasis);
  });
});

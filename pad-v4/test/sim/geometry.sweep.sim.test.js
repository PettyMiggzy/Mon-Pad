const { ethers } = require("hardhat");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// SIM — GEOMETRY SWEEP. Pure research: what chart does each curve shape actually produce?
//
// The curve has two independent knobs:
//   • the MIDPOINT of [gradTick, startTick] sets the RAISE     (raise = curveSupply / 1.0001^mid)
//   • the WIDTH sets the MULTIPLE from launch to graduation    (multiple = 1.0001^width)
// They do not interact, so we can hold the raise fixed and sweep the width to isolate chart shape from
// economics. Every row below raises the same ~373k MON; only the shape changes.
//
// Measured per geometry, against the real MonPadCurveV4 + MonPadFeeHook:
//   - opening and graduation FDV
//   - how far a fixed 5,000 MON opening buy moves the price (the "snipe multiple")
//   - what a sniper who buys first and dumps after retail actually realises
//
// This is the map behind "steeper openings make bigger charts" — with numbers instead of intuition.

const ZERO = ethers.ZeroAddress;
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const ONE = 10n ** 18n;
const MIN_SQRT_LIMIT = 4295128739n + 1n;
const MAX_SQRT_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;

const TS = 100, FEE = 10000;
const SUPPLY = 1_000_000_000n * ONE;
const CURVE_FRAC = 730n, RESERVE_FRAC = 270n; // /1000
const CURVE = (SUPPLY * CURVE_FRAC) / 1000n;
const RESERVE = SUPPLY - CURVE;
const MON_USD = 0.021;
const TARGET_RAISE = 373_000;

const SNIPE = 5_000;   // one sniper's opening buy, MON
const RETAIL = 60_000; // retail that follows, MON

// widths to sweep. MUST be multiples of tickSpacing (100) — gradTick = startTick - width has to stay
// aligned or the factory reverts BadGeometry(). 86250 failed the first sweep for exactly this reason.
const WIDTHS = [23000, 46000, 57500, 86000, 115000, 172500];

const L = Math.log(1.0001);
function geometryFor(width) {
  const curveWhole = Number(CURVE / ONE);
  const mid = Math.log(curveWhole / TARGET_RAISE) / L;
  let start = Math.round((mid + width / 2) / TS) * TS;
  return { start, grad: start - width, width };
}

function poolIdOf(k) {
  return ethers.keccak256(
    abi.encode(["tuple(address,address,uint24,int24,address)"], [[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]])
  );
}

describe("SIM — curve geometry sweep (chart shape vs the same raise)", () => {
  it("maps width -> opening FDV, graduation FDV, snipe impact and sniper P&L", async function () {
    this.timeout(600000);
    const signers = await ethers.getSigners();
    const [deployer, platform, creator, sniper, whale] = signers;
    for (const s of [sniper, whale]) {
      await ethers.provider.send("hardhat_setBalance", [s.address, "0x" + (10n ** 25n).toString(16)]);
    }

    const rows = [];
    for (let i = 0; i < WIDTHS.length; i++) {
      const width = WIDTHS[i];
      const g = geometryFor(width);

      // ── fresh stack per geometry (fee config is immutable per pad) ──
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
        lpFee: FEE, startTickMag: g.start, curveWidth: width, minGradWidth: width - 200,
      });
      const factory = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
        await pm.getAddress(), await posm.getAddress(), await permit2.getAddress(), await stateView.getAddress(),
        await dep.getAddress(), await curveDep.getAddress(), await stakeDep.getAddress(), await feeCfg.getAddress(),
        await reg.getAddress(), await lockVault.getAddress()
      );
      await lockVault.setFactory(await factory.getAddress());

      const cfg = { name: `G${width}`, symbol: `G${i}`, decimals: 18, supply: SUPPLY, curveSupply: CURVE, reserveSupply: RESERVE, tickSpacing: TS, creator: creator.address };
      const tokenSalt = ethers.id(`geo-tok-${width}`), curveSalt = ethers.id(`geo-curve-${width}`);
      const TokenF = await ethers.getContractFactory("PadToken");
      const tokenInit = ethers.concat([TokenF.bytecode, abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await factory.getAddress()])]);
      const predictedToken = ethers.getCreate2Address(await dep.getAddress(), tokenSalt, ethers.keccak256(tokenInit));
      const HookF = await ethers.getContractFactory("MonPadFeeHook");
      const { salt: hookSalt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, await pm.getAddress(), await factory.getAddress(), await reg.getAddress(), predictedToken));

      let token, hook;
      try {
        [token, hook] = await factory.launch.staticCall(cfg, tokenSalt, hookSalt, curveSalt);
        await (await factory.launch(cfg, tokenSalt, hookSalt, curveSalt)).wait();
      } catch (e) {
        rows.push({ width, err: (e.shortMessage || e.message || "").slice(0, 40) });
        continue;
      }

      const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: TS, hooks: hook };
      const poolId = poolIdOf(key);
      const tok = await ethers.getContractAt("PadToken", token);
      const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(await pm.getAddress());
      const swAddr = await sw.getAddress();
      const tickNow = async () => Number((await stateView.getSlot0(poolId))[1]);

      const buy = async (who, mon) => {
        const b0 = await ethers.provider.getBalance(who.address);
        const t0 = await tok.balanceOf(who.address);
        const rc = await (await sw.connect(who).swap(
          key, { zeroForOne: true, amountSpecified: -E(mon), sqrtPriceLimitX96: MIN_SQRT_LIMIT },
          { takeClaims: false, settleUsingBurn: false }, "0x", { value: E(mon) }
        )).wait();
        return { spent: b0 - (await ethers.provider.getBalance(who.address)) - rc.gasUsed * rc.gasPrice,
                 got: (await tok.balanceOf(who.address)) - t0 };
      };

      // sniper opens, whale follows, sniper dumps
      const s1 = await buy(sniper, SNIPE);
      const tickAfterSnipe = await tickNow();
      await buy(whale, RETAIL);
      const tickAfterRetail = await tickNow();
      await (await tok.connect(sniper).approve(swAddr, s1.got)).wait();
      const b0 = await ethers.provider.getBalance(sniper.address);
      const rc = await (await sw.connect(sniper).swap(
        key, { zeroForOne: false, amountSpecified: -s1.got, sqrtPriceLimitX96: MAX_SQRT_LIMIT },
        { takeClaims: false, settleUsingBurn: false }, "0x"
      )).wait();
      const out = (await ethers.provider.getBalance(sniper.address)) - b0 + rc.gasUsed * rc.gasPrice;

      const fdv = (tick) => (1e9 / Math.pow(1.0001, tick)) * MON_USD;
      rows.push({
        width,
        mult: Math.pow(1.0001, width),
        openFdv: fdv(g.start),
        gradFdv: fdv(g.grad),
        snipeMult: Math.pow(1.0001, g.start - tickAfterSnipe),
        retailMult: Math.pow(1.0001, g.start - tickAfterRetail),
        sniperRoi: (Number(out - s1.spent) / Number(s1.spent)) * 100,
        supplyPct: (Number(s1.got) / Number(SUPPLY)) * 100,
      });
    }

    console.log(`
  Same ~${TARGET_RAISE.toLocaleString()} MON raise in every row. Only the SHAPE changes.
  sniper = one ${SNIPE.toLocaleString()} MON opening buy; retail = ${RETAIL.toLocaleString()} MON follows; then the sniper dumps.

  ${"width".padStart(6)}${"curve".padStart(9)}${"open FDV".padStart(12)}${"grad FDV".padStart(12)}${"snipe→".padStart(9)}${"+retail→".padStart(10)}${"sniper".padStart(9)}${"supply".padStart(8)}
  ${"".padStart(6)}${"max x".padStart(9)}${"".padStart(12)}${"".padStart(12)}${"x".padStart(9)}${"x".padStart(10)}${"ROI".padStart(9)}${"%".padStart(8)}`);
    for (const r of rows) {
      if (r.err) { console.log(`  ${String(r.width).padStart(6)}   FAILED: ${r.err}`); continue; }
      console.log(
        `  ${String(r.width).padStart(6)}${(r.mult.toFixed(1) + "x").padStart(9)}` +
        `${("$" + Math.round(r.openFdv).toLocaleString()).padStart(12)}` +
        `${("$" + Math.round(r.gradFdv).toLocaleString()).padStart(12)}` +
        `${(r.snipeMult.toFixed(2) + "x").padStart(9)}` +
        `${(r.retailMult.toFixed(2) + "x").padStart(10)}` +
        `${(r.sniperRoi > 0 ? "+" : "") + r.sniperRoi.toFixed(0) + "%"}`.padStart(9) +
        `${r.supplyPct.toFixed(1) + "%"}`.padStart(8)
      );
    }
    console.log(`
  BRACKETS for comparison: opened $10,367 FDV, hit $231,419 (22.3x) in 3 minutes on ~$22.5k of buying,
  then round-tripped to $58k inside a minute. Unbounded upside, no graduation ceiling.
`);
  });
});

const { ethers } = require("hardhat");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// SIM — THE $100 FIRST BUY.
//
// The dev puts $100 in as the very first buy on their own launch, the curve then fills to the graduation
// ceiling, and the dev exits. Swept across every curve width to find where a $100 first buy pays best.
//
// Two numbers are reported per width and they are very different:
//   PAPER  — the bag marked at the graduation price. What a chart screenshot shows.
//   REAL   — what the dev actually receives selling into the curve, which includes their own slippage on the
//            way out and the 1% sell tax + 1% LP fee. This is the honest number.
//
// The gap between them is the point of the exercise: on steep curves the dev owns so much of the supply that
// selling it moves the price against them enormously, and paper multiples do not survive contact with an exit.

const ZERO = ethers.ZeroAddress;
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const ONE = 10n ** 18n;
const MIN_SQRT_LIMIT = 4295128739n + 1n;
const MAX_SQRT_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;

const TS = 100, FEE = 10000;
const SUPPLY = 1_000_000_000n * ONE;
const CURVE = 730_000_000n * ONE;
const RESERVE = SUPPLY - CURVE;
const MON_USD = 0.021;
const TARGET_RAISE = 373_000;

const DEV_USD = 100;
const DEV_MON = Math.round(DEV_USD / MON_USD); // 4,762 MON
const FILL = 600_000; // enough to walk any of these curves to the ceiling

// must be multiples of tickSpacing — gradTick = startTick - width has to stay aligned
const WIDTHS = [23000, 34500, 46000, 57500, 69000, 86000, 115000];

const L = Math.log(1.0001);
function geometryFor(width) {
  const mid = Math.log(Number(CURVE / ONE) / TARGET_RAISE) / L;
  const start = Math.round((mid + width / 2) / TS) * TS;
  return { start, grad: start - width, width };
}
const poolIdOf = (k) => ethers.keccak256(
  abi.encode(["tuple(address,address,uint24,int24,address)"], [[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]])
);

describe("SIM — a $100 dev first-buy across every curve width", () => {
  it("finds where a $100 opening buy returns the most, on paper and for real", async function () {
    this.timeout(900000);
    const [deployer, platform, creator, dev, whale] = await ethers.getSigners();
    for (const s of [dev, whale]) {
      await ethers.provider.send("hardhat_setBalance", [s.address, "0x" + (10n ** 25n).toString(16)]);
    }

    const rows = [];
    for (const width of WIDTHS) {
      const g = geometryFor(width);
      const pm = await (await ethers.getContractFactory("PoolManager")).deploy(deployer.address);
      const sv = await (await ethers.getContractFactory("MonPadStateView")).deploy(await pm.getAddress());
      const dep = await (await ethers.getContractFactory("DeterministicDeployer")).deploy();
      const reg = await (await ethers.getContractFactory("FeeWalletRegistry")).deploy(platform.address, deployer.address);
      const p2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
      const posm = await (await ethers.getContractFactory("MockPositionManagerV4")).deploy(await pm.getAddress(), await p2.getAddress());
      const lv = await (await ethers.getContractFactory("LockVault")).deploy(await posm.getAddress(), await reg.getAddress());
      const cd = await (await ethers.getContractFactory("CurveV4Deployer")).deploy(await dep.getAddress());
      const sd = await (await ethers.getContractFactory("StakingDeployer")).deploy(await dep.getAddress());
      const fc = await (await ethers.getContractFactory("MonPadV4FeeConfig")).deploy(deployer.address, {
        buyTaxBps: 100, sellTaxBps: 100, sellFloorShareBps: 0, buyLpFloorShareBps: 0, buyBufferShareBps: 2000, referralShareBps: 0,
        platformGradBps: 2000, creatorGradBps: 1500, ambushGradBps: 0,
        lpFee: FEE, startTickMag: g.start, curveWidth: width, minGradWidth: width - 200,
      });
      const f = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
        await pm.getAddress(), await posm.getAddress(), await p2.getAddress(), await sv.getAddress(),
        await dep.getAddress(), await cd.getAddress(), await sd.getAddress(), await fc.getAddress(),
        await reg.getAddress(), await lv.getAddress()
      );
      await lv.setFactory(await f.getAddress());

      const cfg = { name: `W${width}`, symbol: `W`, decimals: 18, supply: SUPPLY, curveSupply: CURVE, reserveSupply: RESERVE, tickSpacing: TS, creator: creator.address };
      const tSalt = ethers.id(`dev-${width}`), cSalt = ethers.id(`devc-${width}`);
      const TokenF = await ethers.getContractFactory("PadToken");
      const init = ethers.concat([TokenF.bytecode, abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await f.getAddress()])]);
      const pt = ethers.getCreate2Address(await dep.getAddress(), tSalt, ethers.keccak256(init));
      const HookF = await ethers.getContractFactory("MonPadFeeHook");
      const { salt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, await pm.getAddress(), await f.getAddress(), await reg.getAddress(), pt));

      let token, hook;
      try {
        [token, hook] = await f.launch.staticCall(cfg, tSalt, salt, cSalt);
        await (await f.launch(cfg, tSalt, salt, cSalt)).wait();
      } catch (e) { rows.push({ width, err: (e.shortMessage || "").slice(0, 30) }); continue; }

      const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: TS, hooks: hook };
      const poolId = poolIdOf(key);
      const tok = await ethers.getContractAt("PadToken", token);
      const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(await pm.getAddress());
      const swAddr = await sw.getAddress();
      const gradSqrt = (await (await (await ethers.getContractFactory("TickHelper")).deploy()).sqrt(g.grad));

      const buy = async (who, mon, limit) => {
        const b0 = await ethers.provider.getBalance(who.address);
        const t0 = await tok.balanceOf(who.address);
        const rc = await (await sw.connect(who).swap(
          key, { zeroForOne: true, amountSpecified: -E(mon), sqrtPriceLimitX96: limit },
          { takeClaims: false, settleUsingBurn: false }, "0x", { value: E(mon) }
        )).wait();
        return { spent: b0 - (await ethers.provider.getBalance(who.address)) - rc.gasUsed * rc.gasPrice,
                 got: (await tok.balanceOf(who.address)) - t0 };
      };

      // 1) dev opens with $100
      const d = await buy(dev, DEV_MON, MIN_SQRT_LIMIT);
      // 2) the curve fills to the graduation ceiling
      await buy(whale, FILL, gradSqrt);
      const tickAtGrad = Number((await sv.getSlot0(poolId))[1]);

      // paper: the dev's bag marked at the graduation price
      const pxGrad = 1 / Math.pow(1.0001, tickAtGrad);           // MON per whole token
      const paperMon = (Number(d.got) / 1e18) * pxGrad;
      // real: what the dev actually gets selling it all back into the curve
      await (await tok.connect(dev).approve(swAddr, d.got)).wait();
      const b0 = await ethers.provider.getBalance(dev.address);
      const rc = await (await sw.connect(dev).swap(
        key, { zeroForOne: false, amountSpecified: -d.got, sqrtPriceLimitX96: MAX_SQRT_LIMIT },
        { takeClaims: false, settleUsingBurn: false }, "0x"
      )).wait();
      const realMon = Number((await ethers.provider.getBalance(dev.address)) - b0 + rc.gasUsed * rc.gasPrice) / 1e18;

      const inMon = Number(d.spent) / 1e18;
      rows.push({
        width, maxx: Math.pow(1.0001, width),
        supplyPct: (Number(d.got) / Number(SUPPLY)) * 100,
        paperX: paperMon / inMon, realX: realMon / inMon,
        paperUsd: paperMon * MON_USD, realUsd: realMon * MON_USD,
      });
    }

    console.log(`
  A $${DEV_USD} first buy (${DEV_MON.toLocaleString()} MON), curve then fills to graduation, dev exits.
  Same ~${TARGET_RAISE.toLocaleString()} MON raise in every row.

  ${"width".padStart(7)}${"curve max".padStart(12)}${"dev supply".padStart(12)}${"PAPER x".padStart(11)}${"PAPER $".padStart(12)}${"REAL x".padStart(10)}${"REAL $".padStart(11)}`);
    for (const r of rows) {
      if (r.err) { console.log(`  ${String(r.width).padStart(5)}   FAILED ${r.err}`); continue; }
      console.log(
        `  ${String(r.width).padStart(5)}` +
        `${(r.maxx >= 1000 ? Math.round(r.maxx).toLocaleString() + "x" : r.maxx.toFixed(0) + "x").padStart(12)}` +
        `${(r.supplyPct.toFixed(2) + "%").padStart(12)}` +
        `${(r.paperX.toFixed(1) + "x").padStart(11)}` +
        `${("$" + Math.round(r.paperUsd).toLocaleString()).padStart(12)}` +
        `${(r.realX.toFixed(2) + "x").padStart(10)}` +
        `${("$" + Math.round(r.realUsd).toLocaleString()).padStart(11)}`
      );
    }
    const best = rows.filter((r) => !r.err).sort((a, b) => b.realX - a.realX)[0];
    const bestPaper = rows.filter((r) => !r.err).sort((a, b) => b.paperX - a.paperX)[0];
    console.log(`
  BEST PAPER : width ${bestPaper.width} -> ${bestPaper.paperX.toFixed(0)}x  ($${Math.round(bestPaper.paperUsd).toLocaleString()})
  BEST REAL  : width ${best.width} -> ${best.realX.toFixed(2)}x  ($${Math.round(best.realUsd).toLocaleString()})
`);
  });
});

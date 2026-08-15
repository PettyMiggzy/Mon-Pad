const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const PadTokenArtifact = require("../../artifacts/contracts/pads/PadToken.sol/PadToken.json");

// ---------------------------------------------------------------------------------------------------------
// Fixed points measured on Robinhood Chain (chainId 4663) and used here as LITERAL fixtures. Nothing in this
// file is a tolerance: if the in-contract geometry does not reproduce these numbers to the wei, the pad's rows
// will not join against the observational dataset and the whole instrument is useless.
// ---------------------------------------------------------------------------------------------------------
const V1_SQRT_206800 = 2450529930707065325983240078348008n; // Initialize event, BRACKETS pool
const V3_CANONICAL_INIT_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const V3_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const V3_BRACKETS_TOKEN = "0x5e453647539d4dd766d7c4c3d6ce589900d39415";
const V3_BRACKETS_POOL = "0x5c5c7264aee5be47fc2ec4ac2b5db475e8ae5342";
const V4_LIQUIDITY = 32341460503543476955346n; // BRACKETS Mint.liquidity
const V4_AMOUNT1 = 999999999999999999999994558n; // BRACKETS Mint.amount1 — 5,442 wei SHORT of 1e27
const V5_AMOUNT0 = 999999999999999999999990349n; // token0-side pool, 9,651 wei short

// The canonical `Launched` signature. topic0 is ORDER-DEPENDENT: this string is the schema-freeze tripwire.
const LAUNCHED_SIG =
  "Launched(uint256,address,address,(address,address,address,bool,uint24,int24,int24,int24,int24,uint256," +
  "uint256,uint256,uint256,uint128,uint256,address,uint256,bool,int256,int256,address,uint256,uint8,uint256," +
  "address,uint256,uint256,bytes32,bytes32,uint32,address,string,string))";
const LAUNCHED_TOPIC0 = "0x66d9355c608452ef1c1d042b0cc4b674566a5e9cd513f0e0ea154a7822a693f0";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const E = (x) => ethers.parseEther(String(x));
const SUPPLY = 10n ** 27n; // 1,000,000,000 tokens at 18dp — the reference pad's hardcoded supply
const HARDHAT_CHAIN = 31337n;
const FAR = 4_000_000_000n; // deadline well past any test's block timestamp

const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 };
const FillMode = { NORMAL: 0, PARTIAL: 1, ZERO: 2 };

const abi = ethers.AbiCoder.defaultAbiCoder();

/** CREATE2 init-code hash for a PadToken with these constructor args, deployed BY `pad`. */
function padTokenInitHash(pad, cfg) {
  const args = abi.encode(
    ["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad],
  );
  return ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
}

/**
 * Mine a salt landing the predicted token on the requested side of the quote token. Pure JS, ZERO RPC —
 * the sort side is an experimental variable and mining it must not cost a single call against the paid proxy.
 * ~2 attempts on average.
 */
function mineSalt(pad, cfg, weth, wantToken0, from = 0) {
  const h = padTokenInitHash(pad, cfg);
  const w = BigInt(weth);
  for (let i = from; i < from + 100000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token };
  }
  throw new Error("no salt found");
}

describe("AtomicExperimentPad — parameterised launch rig", () => {
  async function setup() {
    const [owner, operator, stranger, rescue, vault] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("MockWETH9")).deploy();
    const factory = await (await ethers.getContractFactory("MockV3Factory")).deploy();
    const npm = await (await ethers.getContractFactory("MockNPM")).deploy(await factory.getAddress());
    const ticks = await (await ethers.getContractFactory("TickHelper")).deploy();

    // The mock pool's bytecode can never hash to the canonical 0xe34f199b..., which is exactly why the pad
    // takes the hash as a constructor immutable — otherwise the CREATE2 assertion could not be exercised
    // offline at all.
    const poolInitHash = ethers.keccak256((await ethers.getContractFactory("MockV3Pool")).bytecode);

    const pad = await (await ethers.getContractFactory("AtomicExperimentPad")).deploy(
      owner.address,
      rescue.address,
      vault.address,
      await factory.getAddress(),
      await npm.getAddress(),
      await weth.getAddress(),
      HARDHAT_CHAIN,
      100n, // START_LAUNCH_ID — clears the reference pad's ids 3..8
      poolInitHash,
    );
    await pad.connect(owner).setOperator(operator.address, true);

    const ctx = {
      owner, operator, stranger, rescue, vault, weth, factory, npm, ticks, pad, poolInitHash,
      padAddr: await pad.getAddress(),
      wethAddr: await weth.getAddress(),
      npmAddr: await npm.getAddress(),
      factoryAddr: await factory.getAddress(),
    };
    return ctx;
  }

  /** The reference pad's exact geometry: single-sided token wall, ZERO quote, token sorts as token1. */
  function bracketsDefaults() {
    return {
      experimentId: ethers.id("exp/base"),
      armId: ethers.id("arm/base"),
      replicate: 1,
      name: "Brackets",
      symbol: "BRACKETS",
      decimals: 18,
      totalSupply: SUPPLY,
      tokenSalt: ethers.ZeroHash,
      wantTokenIsToken0: false,
      fee: 10000,
      openingTick: 206800,
      tickLower: 46000,
      tickUpper: 206800,
      seedTokenAmount: SUPPLY,
      seedQuoteWei: 0n,
      seedTokenMin: 0n,
      seedQuoteMin: 0n,
      lpTo: Recipient.OPERATOR,
      devBuyQuoteWei: 0n,
      devBuyMinTokensOut: 0n,
      devBuySqrtPriceLimitX96: 0n,
      devBuyTo: Recipient.OPERATOR,
      residualTo: Recipient.OPERATOR,
      deadline: FAR,
    };
  }

  /** The mirrored regime: token sorts as token0, so the range must sit ABOVE the opening tick. */
  function token0Defaults() {
    return {
      ...bracketsDefaults(),
      name: "Dbts",
      symbol: "DBTS",
      wantTokenIsToken0: true,
      openingTick: -190600,
      tickLower: -190600,
      tickUpper: 887200,
    };
  }

  /** Two-sided: the range STRADDLES the opening tick, so a nonzero quote seed is required. */
  function straddleDefaults() {
    return { ...bracketsDefaults(), tickLower: -887200, tickUpper: 887200, seedQuoteWei: E(1) };
  }

  function build(ctx, over = {}, saltFrom = 0) {
    const p = { ...bracketsDefaults(), ...over };
    const { salt, token } = mineSalt(ctx.padAddr, p, ctx.wethAddr, p.wantTokenIsToken0, saltFrom);
    p.tokenSalt = salt;
    return { p, token };
  }

  const valueFor = (p) => p.seedQuoteWei + p.devBuyQuoteWei;

  async function launch(ctx, p, signer = ctx.operator, extraValue = 0n) {
    return ctx.pad.connect(signer).launch(p, { value: valueFor(p) + extraValue });
  }

  /** Decode the pad's own Launched log out of a receipt, ignoring token/pool/NPM logs. */
  async function recordOf(ctx, tx) {
    const rc = await tx.wait();
    const mine = rc.logs.filter((l) => l.address.toLowerCase() === ctx.padAddr.toLowerCase());
    expect(mine.length, "the pad must emit exactly one log per launch").to.equal(1);
    const parsed = ctx.pad.interface.parseLog({ topics: [...mine[0].topics], data: mine[0].data });
    return { rc, log: mine[0], parsed, rec: parsed.args.record, launchId: parsed.args.launchId };
  }

  // =========================================================================================================
  // GROUP A — geometry and prediction, pinned to real chain measurements
  // =========================================================================================================
  describe("A — math and prediction pinned to real chain measurements", () => {
    it("A1: getSqrtPriceAtTick(206800) is the exact sqrtPriceX96 the BRACKETS pool initialized at", async () => {
      const { ticks } = await setup();
      expect(await ticks.sqrt(206800)).to.equal(V1_SQRT_206800);
    });

    it("A2: the usable full range at spacing 200 is [-887200, 887200], not +/-887272", async () => {
      const { ticks } = await setup();
      expect(await ticks.minUsable(200)).to.equal(-887200n);
      expect(await ticks.maxUsable(200)).to.equal(887200n);
    });

    it("A3: reproduces the real BRACKETS mint to the wei — L, amount0 = 0, amount1 short by 5,442", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      const pv = await ctx.pad.previewLaunch(p);
      expect(pv.tokenIsToken0).to.equal(false);
      expect(pv.sqrtStart).to.equal(V1_SQRT_206800);
      expect(pv.liquidity).to.equal(V4_LIQUIDITY);
      expect(pv.amount0Achieved).to.equal(0n);
      expect(pv.amount1Achieved).to.equal(V4_AMOUNT1);
    });

    it("A4: reproduces the real token0-side mint to the wei — amount0 short by 9,651, amount1 = 0", async () => {
      const ctx = await setup();
      const { p } = build(ctx, token0Defaults());
      const pv = await ctx.pad.previewLaunch(p);
      expect(pv.tokenIsToken0).to.equal(true);
      expect(pv.amount0Achieved).to.equal(V5_AMOUNT0);
      expect(pv.amount1Achieved).to.equal(0n);
    });

    it("A5: CREATE2 with the canonical init hash reproduces the real BRACKETS pool address", () => {
      const [t0, t1] =
        BigInt(V3_WETH) < BigInt(V3_BRACKETS_TOKEN) ? [V3_WETH, V3_BRACKETS_TOKEN] : [V3_BRACKETS_TOKEN, V3_WETH];
      const salt = ethers.keccak256(abi.encode(["address", "address", "uint24"], [t0, t1, 10000]));
      const predicted = ethers.getCreate2Address(V3_FACTORY, salt, V3_CANONICAL_INIT_HASH);
      expect(predicted.toLowerCase()).to.equal(V3_BRACKETS_POOL);
    });

    it("A6: previewLaunch predicts the token address launch() actually deploys", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx);
      const pv = await ctx.pad.previewLaunch(p);
      expect(pv.predictedToken).to.equal(token);
      const tx = await launch(ctx, p);
      const { rec, parsed } = await recordOf(ctx, tx);
      expect(parsed.args.token).to.equal(token);
      expect(rec.pool).to.equal(pv.predictedPool);
    });

    it("A7: the deployed pad runtime is under the 24576-byte EIP-170 limit", async () => {
      const ctx = await setup();
      const code = await ethers.provider.getCode(ctx.padAddr);
      const size = (code.length - 2) / 2;
      expect(size).to.be.lessThan(24576);
    });

    it("A8: the emitted topic0 equals keccak of the canonical Launched signature — schema tripwire", async () => {
      const ctx = await setup();
      expect(ethers.id(LAUNCHED_SIG)).to.equal(LAUNCHED_TOPIC0);
      expect(ctx.pad.interface.getEvent("Launched").topicHash).to.equal(LAUNCHED_TOPIC0);
      const { p } = build(ctx);
      const { log } = await recordOf(ctx, await launch(ctx, p));
      expect(log.topics[0]).to.equal(LAUNCHED_TOPIC0);
    });
  });

  // =========================================================================================================
  // GROUP B — access control. Only the operator set may launch; the role is flat and un-escalatable.
  // =========================================================================================================
  describe("B — access control", () => {
    it("B1: a stranger cannot launch, and nothing is deployed on the way to the revert", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      await expect(launch(ctx, p, ctx.stranger)).to.be.revertedWithCustomError(ctx.pad, "NotOperator");
      expect(await ctx.pad.launchCount()).to.equal(0n);
    });

    it("B2: an allowlisted operator can launch", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      await expect(launch(ctx, p)).to.emit(ctx.pad, "Launched");
      expect(await ctx.pad.launchCount()).to.equal(1n);
    });

    it("B3: the owner can launch without being explicitly allowlisted", async () => {
      const ctx = await setup();
      expect(await ctx.pad.isOperator(ctx.owner.address)).to.equal(false);
      const { p } = build(ctx);
      await expect(launch(ctx, p, ctx.owner)).to.emit(ctx.pad, "Launched");
    });

    it("B4: an operator cannot grant operator — no self-administering role", async () => {
      const ctx = await setup();
      await expect(ctx.pad.connect(ctx.operator).setOperator(ctx.stranger.address, true))
        .to.be.revertedWithCustomError(ctx.pad, "OwnableUnauthorizedAccount");
    });

    it("B5: revocation is instant — no timelock stands between a stolen key and closing it", async () => {
      const ctx = await setup();
      await ctx.pad.connect(ctx.owner).setOperator(ctx.operator.address, false);
      const { p } = build(ctx);
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "NotOperator");
    });

    it("B6: renounceOwnership is disabled", async () => {
      const ctx = await setup();
      await expect(ctx.pad.connect(ctx.owner).renounceOwnership())
        .to.be.revertedWithCustomError(ctx.pad, "RenounceDisabled");
    });

    it("B7: Ownable2Step — a transfer is inert until accepted, and the old owner keeps launching", async () => {
      const ctx = await setup();
      await ctx.pad.connect(ctx.owner).transferOwnership(ctx.stranger.address);
      expect(await ctx.pad.owner()).to.equal(ctx.owner.address);
      const { p } = build(ctx);
      await expect(launch(ctx, p, ctx.owner)).to.emit(ctx.pad, "Launched");
      await expect(ctx.pad.connect(ctx.stranger).setOperator(ctx.stranger.address, true))
        .to.be.revertedWithCustomError(ctx.pad, "OwnableUnauthorizedAccount");
      await ctx.pad.connect(ctx.stranger).acceptOwnership();
      expect(await ctx.pad.owner()).to.equal(ctx.stranger.address);
    });

    it("B8: an operator cannot touch governance", async () => {
      const ctx = await setup();
      const op = ctx.pad.connect(ctx.operator);
      await expect(op.proposeRescueRecipient(ctx.operator.address))
        .to.be.revertedWithCustomError(ctx.pad, "OwnableUnauthorizedAccount");
      await expect(op.commitRescueRecipient()).to.be.revertedWithCustomError(ctx.pad, "OwnableUnauthorizedAccount");
      await expect(op.declareExperiment(ethers.id("x"), "x"))
        .to.be.revertedWithCustomError(ctx.pad, "OwnableUnauthorizedAccount");
    });

    it("B9: the ABI carries no LP-reaching selector and no operator-nameable destination", async () => {
      const ctx = await setup();
      const fns = ctx.pad.interface.fragments.filter((f) => f.type === "function");
      // Restricted to STATE-CHANGING functions: `BURN_ADDRESS` is a view constant naming a destination
      // level, not a way to burn anything.
      const mutating = fns.filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure");
      const banned = /decreaseLiquidity|burn|onERC721Received|transferFrom/i;
      expect(mutating.filter((f) => banned.test(f.name)).map((f) => f.name)).to.deep.equal([]);

      // No function may take a caller-named value destination. `sweepStrandedToken(address asset)` names an
      // ASSET, not a destination — the destination is the timelocked rescueRecipient.
      const destish = /^(to|recipient|receiver|dest|destination)$/i;
      const offenders = [];
      for (const f of fns) {
        for (const i of f.inputs) if (i.type === "address" && destish.test(i.name || "")) offenders.push(f.name);
      }
      expect(offenders).to.deep.equal([]);
    });
  });

  // =========================================================================================================
  // GROUP C — every parameter demonstrably changes an independently observable artefact
  // =========================================================================================================
  describe("C — every parameter takes effect on-chain", () => {
    it("C1: name and symbol reach the token and the record", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx, { name: "Odd Name", symbol: "ODD" });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      const t = await ethers.getContractAt("PadToken", token);
      expect(await t.name()).to.equal("Odd Name");
      expect(await t.symbol()).to.equal("ODD");
      expect(rec.name).to.equal("Odd Name");
      expect(rec.symbol).to.equal("ODD");
    });

    it("C2: decimals is UNCAPPED — 6, 18 and 24 all launch (a cap would encode a hypothesis)", async () => {
      const ctx = await setup();
      for (const d of [6, 18, 24]) {
        const { p, token } = build(ctx, { decimals: d, name: `D${d}`, symbol: `D${d}` });
        const { rec } = await recordOf(ctx, await launch(ctx, p));
        const t = await ethers.getContractAt("PadToken", token);
        expect(await t.decimals()).to.equal(d);
        expect(rec.decimals).to.equal(d);
      }
    });

    it("C3: totalSupply reaches the token and the record", async () => {
      const ctx = await setup();
      for (const s of [SUPPLY, 10n ** 21n]) {
        const { p, token } = build(ctx, { totalSupply: s, seedTokenAmount: s, name: `S${s}`, symbol: "S" });
        const { rec } = await recordOf(ctx, await launch(ctx, p));
        const t = await ethers.getContractAt("PadToken", token);
        expect(await t.totalSupply()).to.equal(s);
        expect(rec.totalSupply).to.equal(s);
      }
    });

    it("C4: the salt moves the token address, and both land where preview said", async () => {
      const ctx = await setup();
      const a = build(ctx, {}, 0);
      const b = build(ctx, {}, Number(BigInt(a.p.tokenSalt)) + 1);
      expect(a.token).to.not.equal(b.token);
      expect((await ctx.pad.previewLaunch(a.p)).predictedToken).to.equal(a.token);
      expect((await ctx.pad.previewLaunch(b.p)).predictedToken).to.equal(b.token);
      const ra = await recordOf(ctx, await launch(ctx, a.p));
      const rb = await recordOf(ctx, await launch(ctx, b.p));
      expect(ra.parsed.args.token).to.equal(a.token);
      expect(rb.parsed.args.token).to.equal(b.token);
    });

    it("C5: sort side flips token0/token1 AND the amount mapping — both directions", async () => {
      const ctx = await setup();

      const one = build(ctx); // token sorts as token1 (WETH is token0)
      const r1 = await recordOf(ctx, await launch(ctx, one.p));
      const mp1 = await ctx.npm.lastMintParams();
      expect(mp1.token0).to.equal(ctx.wethAddr);
      expect(mp1.token1).to.equal(one.token);
      expect(mp1.amount0Desired).to.equal(0n);
      expect(mp1.amount1Desired).to.equal(SUPPLY);
      expect(r1.rec.tokenIsToken0).to.equal(false);
      expect(r1.rec.seedAmount0).to.equal(0n);
      expect(r1.rec.seedAmount1).to.equal(V4_AMOUNT1);

      const two = build(ctx, token0Defaults()); // token sorts as token0
      const r2 = await recordOf(ctx, await launch(ctx, two.p));
      const mp2 = await ctx.npm.lastMintParams();
      expect(mp2.token0).to.equal(two.token);
      expect(mp2.token1).to.equal(ctx.wethAddr);
      expect(mp2.amount0Desired).to.equal(SUPPLY); // MIRRORED relative to the first launch
      expect(mp2.amount1Desired).to.equal(0n);
      expect(r2.rec.tokenIsToken0).to.equal(true);
      expect(r2.rec.seedAmount0).to.equal(V5_AMOUNT0);
      expect(r2.rec.seedAmount1).to.equal(0n);
    });

    it("C6: fee reaches the mint, and tickSpacing is READ from the factory rather than assumed", async () => {
      const ctx = await setup();
      const a = build(ctx, { fee: 10000 });
      const ra = await recordOf(ctx, await launch(ctx, a.p));
      expect((await ctx.npm.lastMintParams()).fee).to.equal(10000n);
      expect(ra.rec.fee).to.equal(10000n);
      expect(ra.rec.tickSpacing).to.equal(200n);

      const b = build(ctx, {
        fee: 3000, tickLower: 45960, tickUpper: 206820, openingTick: 206820, name: "Fee3000", symbol: "F3K",
      });
      const rb = await recordOf(ctx, await launch(ctx, b.p));
      expect(rb.rec.fee).to.equal(3000n);
      expect(rb.rec.tickSpacing).to.equal(60n); // the factory's map, not a constant in the pad
    });

    it("C7: openingTick lands as the pool's initialized price and as the record's achieved tick", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { openingTick: 206600, tickUpper: 206600 });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      const pool = await ethers.getContractAt("MockV3Pool", rec.pool);
      expect((await pool.slot0())[0]).to.equal(await ctx.ticks.sqrt(206600));
      expect(rec.openingTick).to.equal(206600n);
    });

    it("C8: both range bounds reach the mint — concentrated and full-range", async () => {
      const ctx = await setup();
      const a = build(ctx, { tickLower: 200000, tickUpper: 206800 }); // concentrated
      const ra = await recordOf(ctx, await launch(ctx, a.p));
      let mp = await ctx.npm.lastMintParams();
      expect(mp.tickLower).to.equal(200000n);
      expect(mp.tickUpper).to.equal(206800n);
      expect(ra.rec.tickLower).to.equal(200000n);
      expect(ra.rec.tickUpper).to.equal(206800n);

      const b = build(ctx, { ...straddleDefaults(), name: "Wide", symbol: "WIDE" }); // straddling ⇒ two-sided
      const rb = await recordOf(ctx, await launch(ctx, b.p));
      mp = await ctx.npm.lastMintParams();
      expect(mp.tickLower).to.equal(-887200n);
      expect(mp.tickUpper).to.equal(887200n);
      expect(rb.rec.tickLower).to.equal(-887200n);
    });

    it("C9: seedTokenAmount changes what the pool actually ends up holding", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx, { seedTokenAmount: 6n * 10n ** 26n });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      const t = await ethers.getContractAt("PadToken", token);
      expect(rec.requestedSeedToken).to.equal(6n * 10n ** 26n);
      expect(await t.balanceOf(rec.pool)).to.equal(rec.seedAmount1);
      expect(rec.seedAmount1).to.be.lessThan(6n * 10n ** 26n); // rounded down, as the real venue does
    });

    it("C10: FLAGSHIP — zero-quote gives exactly one zero side, nonzero quote gives two live sides", async () => {
      const ctx = await setup();

      const zero = build(ctx); // the reference pad's only regime
      const rz = await recordOf(ctx, await launch(ctx, zero.p));
      expect(rz.rec.requestedSeedQuote).to.equal(0n);
      expect(rz.rec.seedAmount0).to.equal(0n);
      expect(rz.rec.seedAmount1).to.be.greaterThan(0n);
      expect(await ctx.weth.balanceOf(rz.rec.pool)).to.equal(0n);

      // the regime the reference pad NEVER exercised
      const two = build(ctx, { ...straddleDefaults(), name: "Twosided", symbol: "TWO" });
      const rt = await recordOf(ctx, await launch(ctx, two.p));
      expect(rt.rec.requestedSeedQuote).to.equal(E(1));
      expect(rt.rec.seedAmount0).to.be.greaterThan(0n);
      expect(rt.rec.seedAmount1).to.be.greaterThan(0n);
      expect(await ctx.weth.balanceOf(rt.rec.pool)).to.equal(rt.rec.seedAmount0);
    });

    it("C11: devBuyQuoteWei — zero is a recorded LEVEL, nonzero produces a real same-tx swap", async () => {
      const ctx = await setup();

      const none = build(ctx);
      const rn = await recordOf(ctx, await launch(ctx, none.p));
      expect(rn.rec.devBought).to.equal(false);
      expect(rn.rec.devBuyAmount0).to.equal(0n);
      expect(rn.rec.devBuyAmount1).to.equal(0n);
      expect(rn.rc.logs.filter((l) => l.topics[0] === ethers.id(
        "Swap(address,address,int256,int256,uint160,uint128,int24)",
      )).length).to.equal(0);

      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const some = build(ctx, { devBuyQuoteWei: E(2), name: "Dev", symbol: "DEV" });
      const rs = await recordOf(ctx, await launch(ctx, some.p));
      expect(rs.rec.devBought).to.equal(true);
      expect(rs.rec.devBuyAmount0).to.equal(E(2)); // WETH is token0 here ⇒ positive input
      expect(rs.rec.devBuyAmount1).to.equal(-(5n * 10n ** 24n)); // negative output, as the Swap log carries it
      expect(await ctx.weth.balanceOf(rs.rec.pool)).to.equal(E(2));
    });

    it("C12: a binding price limit shows up as a partial fill and an unconsumed remainder", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.PARTIAL, 5000, 4n * 10n ** 24n);
      const { p } = build(ctx, { devBuyQuoteWei: E(2) });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.requestedDevBuyQuote).to.equal(E(2));
      expect(rec.devBuyAmount0).to.equal(E(1)); // only half consumed
      expect(rec.nativeRefunded).to.equal(E(1)); // the rest came back
    });

    it("C13: lpTo places the position NFT at all three levels, and never at the pad", async () => {
      const ctx = await setup();
      const cases = [
        [Recipient.OPERATOR, ctx.operator.address],
        [Recipient.VAULT, ctx.vault.address],
        [Recipient.BURN, DEAD],
      ];
      for (const [level, expected] of cases) {
        const { p } = build(ctx, { lpTo: level, name: `L${level}`, symbol: `L${level}` });
        const { rec } = await recordOf(ctx, await launch(ctx, p));
        expect(await ctx.npm.ownerOf(rec.positionId)).to.equal(expected);
        expect(rec.lpRecipient).to.equal(expected);
        expect(await ctx.npm.ownerOf(rec.positionId)).to.not.equal(ctx.padAddr);
      }
    });

    it("C14: devBuyTo places the dev bag — and is the address a chain observer reads as `buyer`", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const cases = [
        [Recipient.OPERATOR, ctx.operator.address],
        [Recipient.VAULT, ctx.vault.address],
        [Recipient.BURN, DEAD],
      ];
      for (const [level, expected] of cases) {
        const { p, token } = build(ctx, { devBuyTo: level, devBuyQuoteWei: E(1), name: `B${level}`, symbol: `B${level}` });
        const { rec } = await recordOf(ctx, await launch(ctx, p));
        const t = await ethers.getContractAt("PadToken", token);
        expect(rec.devBuyRecipient).to.equal(expected);
        expect(await t.balanceOf(expected)).to.be.greaterThanOrEqual(5n * 10n ** 24n);
      }
    });

    it("C15: residualTo disposes the unseeded supply at all three levels", async () => {
      const ctx = await setup();
      const cases = [
        [Recipient.OPERATOR, ctx.operator.address],
        [Recipient.VAULT, ctx.vault.address],
        [Recipient.BURN, DEAD],
      ];
      for (const [level, expected] of cases) {
        const { p, token } = build(ctx, {
          seedTokenAmount: 6n * 10n ** 26n, residualTo: level, name: `R${level}`, symbol: `R${level}`,
        });
        const { rec } = await recordOf(ctx, await launch(ctx, p));
        const t = await ethers.getContractAt("PadToken", token);
        expect(rec.residualTo).to.equal(expected);
        expect(rec.residualTokens).to.equal(SUPPLY - rec.seedAmount1);
        expect(rec.residualTokens).to.be.greaterThan(4n * 10n ** 26n - 1n);
        expect(await t.balanceOf(expected)).to.equal(rec.residualTokens);
      }
    });

    it("C16: experimentId / armId / replicate round-trip verbatim", async () => {
      const ctx = await setup();
      const eid = ethers.id("exp/seed-quote-sweep");
      const aid = ethers.id("arm/quote=1e18");
      const { p } = build(ctx, { experimentId: eid, armId: aid, replicate: 7 });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.experimentId).to.equal(eid);
      expect(rec.armId).to.equal(aid);
      expect(rec.replicate).to.equal(7n);
    });

    it("C17: the deadline is passed through to the mint", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { deadline: FAR - 12345n });
      await launch(ctx, p);
      expect((await ctx.npm.lastMintParams()).deadline).to.equal(FAR - 12345n);
    });

    it("C18: launch ids run sequentially from START_LAUNCH_ID and never collide with the reference 3..8", async () => {
      const ctx = await setup();
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const { p } = build(ctx, { name: `N${i}`, symbol: `N${i}` });
        const { launchId } = await recordOf(ctx, await launch(ctx, p));
        ids.push(launchId);
      }
      expect(ids).to.deep.equal([101n, 102n, 103n]);
      for (const id of ids) expect(id).to.be.greaterThan(8n);
      expect(await ctx.pad.tokenOfLaunch(101n)).to.not.equal(ethers.ZeroAddress);
    });
  });

  // =========================================================================================================
  // GROUP D — funds cannot strand
  // =========================================================================================================
  describe("D — funds cannot strand", () => {
    it("D1: after a launch the pad holds zero of the launched token, zero WETH and no extra native", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const variants = [
        {},
        straddleDefaults(),
        token0Defaults(),
        { devBuyQuoteWei: E(1) },
        { seedTokenAmount: 6n * 10n ** 26n, residualTo: Recipient.BURN },
      ];
      for (const [i, v] of variants.entries()) {
        const before = await ethers.provider.getBalance(ctx.padAddr);
        const { p, token } = build(ctx, { ...v, name: `V${i}`, symbol: `V${i}` });
        await launch(ctx, p);
        const t = await ethers.getContractAt("PadToken", token);
        expect(await t.balanceOf(ctx.padAddr), `token stranded in variant ${i}`).to.equal(0n);
        expect(await ctx.weth.balanceOf(ctx.padAddr), `WETH stranded in variant ${i}`).to.equal(0n);
        expect(await ethers.provider.getBalance(ctx.padAddr), `native moved in variant ${i}`).to.equal(before);
      }
    });

    it("D2: over-sending costs the operator exactly seed + devBuy + gas, and reconciles in the record", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const { p } = build(ctx, { ...straddleDefaults(), devBuyQuoteWei: E(2) });
      const spend = valueFor(p);
      const before = await ethers.provider.getBalance(ctx.operator.address);
      const tx = await launch(ctx, p, ctx.operator, E(1)); // 1 ETH too much
      const { rc, rec } = await recordOf(ctx, tx);
      const gas = rc.gasUsed * rc.gasPrice;
      const after = await ethers.provider.getBalance(ctx.operator.address);
      // The seed pulls slightly LESS quote than requested (rounding), and that difference comes back too.
      const quoteUnused = p.seedQuoteWei - rec.seedAmount0;
      expect(before - after).to.equal(spend + gas - quoteUnused);
      expect(rec.nativeIn).to.equal(spend + E(1));
      expect(rec.nativeRefunded).to.equal(E(1) + quoteUnused);
    });

    it("D3: an unconsumed dev-buy remainder is unwrapped and refunded, and shows in nativeRefunded", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.PARTIAL, 2500, 4n * 10n ** 24n);
      const { p } = build(ctx, { devBuyQuoteWei: E(4) });
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.devBuyAmount0).to.equal(E(1));
      expect(rec.nativeRefunded).to.equal(E(3));
      expect(await ctx.weth.balanceOf(ctx.padAddr)).to.equal(0n);
    });

    it("D4: the mint's shortfall is not retained, and the record carries ACHIEVED not requested", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx);
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.requestedSeedToken).to.equal(SUPPLY);
      expect(rec.seedAmount1).to.equal(V4_AMOUNT1);
      expect(rec.requestedSeedToken - rec.seedAmount1).to.equal(5442n); // the real BRACKETS shortfall
      const t = await ethers.getContractAt("PadToken", token);
      expect(await t.balanceOf(ctx.padAddr)).to.equal(0n);
      expect(await t.balanceOf(ctx.operator.address)).to.equal(rec.residualTokens);
    });

    it("D5: under-sending reverts InsufficientValue with the real numbers", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { ...straddleDefaults(), devBuyQuoteWei: E(1) });
      await expect(ctx.pad.connect(ctx.operator).launch(p, { value: E(1) }))
        .to.be.revertedWithCustomError(ctx.pad, "InsufficientValue")
        .withArgs(E(2), E(1));
      expect(await ctx.pad.launchCount()).to.equal(0n);
    });

    it("D6: DONATION IMMUNITY — a donated ETH and WETH balance neither breaks nor funds a launch", async () => {
      const ctx = await setup();
      await ctx.stranger.sendTransaction({ to: ctx.padAddr, value: E(1) });
      await ctx.weth.connect(ctx.stranger).deposit({ value: E(1) });
      await ctx.weth.connect(ctx.stranger).transfer(ctx.padAddr, E(1));

      const { p } = build(ctx, straddleDefaults());
      const before = await ethers.provider.getBalance(ctx.operator.address);
      const tx = await launch(ctx, p);
      const { rc, rec } = await recordOf(ctx, tx);
      const gas = rc.gasUsed * rc.gasPrice;
      const after = await ethers.provider.getBalance(ctx.operator.address);
      expect(before - after).to.equal(rec.seedAmount0 + gas); // refund unaffected by the donations

      expect(await ethers.provider.getBalance(ctx.padAddr)).to.equal(E(1));
      expect(await ctx.weth.balanceOf(ctx.padAddr)).to.equal(E(1));
    });

    it("D7: sweepStrandedToken is permissionless, pays only rescueRecipient, and reverts on nothing", async () => {
      const ctx = await setup();
      await ctx.weth.connect(ctx.stranger).deposit({ value: E(1) });
      await ctx.weth.connect(ctx.stranger).transfer(ctx.padAddr, E(1));
      await expect(ctx.pad.connect(ctx.stranger).sweepStrandedToken(ctx.wethAddr))
        .to.emit(ctx.pad, "Swept").withArgs(ctx.wethAddr, ctx.rescue.address, E(1));
      expect(await ctx.weth.balanceOf(ctx.rescue.address)).to.equal(E(1));
      await expect(ctx.pad.connect(ctx.stranger).sweepStrandedToken(ctx.wethAddr))
        .to.be.revertedWithCustomError(ctx.pad, "NothingToSweep");
    });

    it("D8: sweepStrandedNative likewise, and it recovers the donated ETH from D6", async () => {
      const ctx = await setup();
      await ctx.stranger.sendTransaction({ to: ctx.padAddr, value: E(1) });
      const before = await ethers.provider.getBalance(ctx.rescue.address);
      await expect(ctx.pad.connect(ctx.stranger).sweepStrandedNative())
        .to.emit(ctx.pad, "Swept").withArgs(ethers.ZeroAddress, ctx.rescue.address, E(1));
      expect((await ethers.provider.getBalance(ctx.rescue.address)) - before).to.equal(E(1));
      await expect(ctx.pad.connect(ctx.stranger).sweepStrandedNative())
        .to.be.revertedWithCustomError(ctx.pad, "NothingToSweep");
    });

    it("D9: repointing the rescue recipient costs the full 2-day timelock", async () => {
      const ctx = await setup();
      await expect(ctx.pad.connect(ctx.owner).commitRescueRecipient())
        .to.be.revertedWithCustomError(ctx.pad, "NoProposal");

      await expect(ctx.pad.connect(ctx.owner).proposeRescueRecipient(ctx.vault.address))
        .to.emit(ctx.pad, "RescueRecipientProposed");
      await expect(ctx.pad.connect(ctx.owner).commitRescueRecipient())
        .to.be.revertedWithCustomError(ctx.pad, "TimelockNotElapsed");
      expect(await ctx.pad.rescueRecipient()).to.equal(ctx.rescue.address);

      await ctx.pad.connect(ctx.owner).cancelRescueProposal();
      expect(await ctx.pad.pendingRescueEta()).to.equal(0n);

      await ctx.pad.connect(ctx.owner).proposeRescueRecipient(ctx.vault.address);
      await time.increase(2 * 24 * 3600 + 1);
      await expect(ctx.pad.connect(ctx.owner).commitRescueRecipient())
        .to.emit(ctx.pad, "RescueRecipientCommitted").withArgs(ctx.vault.address);

      await ctx.stranger.sendTransaction({ to: ctx.padAddr, value: E(1) });
      const before = await ethers.provider.getBalance(ctx.vault.address);
      await ctx.pad.connect(ctx.stranger).sweepStrandedNative();
      expect((await ethers.provider.getBalance(ctx.vault.address)) - before).to.equal(E(1));
    });

    it("D10: a refund that cannot be delivered reverts the launch rather than stranding value", async () => {
      const ctx = await setup();
      const bad = await (await ethers.getContractFactory("BadRefundReceiver")).deploy();
      const badAddr = await bad.getAddress();
      await ctx.pad.connect(ctx.owner).setOperator(badAddr, true);
      await bad.fund({ value: E(5) }); // receive() reverts, so funding must go through a function

      const { p } = build(ctx);
      const data = ctx.pad.interface.encodeFunctionData("launch", [p]);
      // Zero seed and zero dev buy, but 1 ETH over-sent ⇒ there IS a refund to deliver, and it must fail loudly.
      await expect(bad.fire(ctx.padAddr, E(1), data)).to.be.revertedWithCustomError(ctx.pad, "RefundFailed");
      expect(await ctx.pad.launchCount()).to.equal(0n);
    });

    it("D11: seedTokenMin == seedTokenAmount reverts BadMins before anything deploys", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { seedTokenMin: SUPPLY });
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "BadMins");
      expect(await ctx.pad.launchCount()).to.equal(0n);
    });
  });

  // =========================================================================================================
  // GROUP E — the event round-trips to the intended configuration
  // =========================================================================================================
  describe("E — the event round-trips to the intended configuration", () => {
    it("E1: exactly one Launched log per launch, and it is the pad's only log", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      const rc = await (await launch(ctx, p)).wait();
      const mine = rc.logs.filter((l) => l.address.toLowerCase() === ctx.padAddr.toLowerCase());
      expect(mine.length).to.equal(1);
      expect(mine[0].topics[0]).to.equal(LAUNCHED_TOPIC0);
    });

    it("E2: FULL ROUND TRIP — all 33 record fields against params or independently-read chain state", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const eid = ethers.id("exp/full");
      const aid = ethers.id("arm/full");
      const { p, token } = build(ctx, {
        ...straddleDefaults(),
        experimentId: eid,
        armId: aid,
        replicate: 7,
        name: "Full Round Trip",
        symbol: "FRT",
        decimals: 9,
        seedTokenAmount: 6n * 10n ** 26n,
        seedTokenMin: 1n,
        seedQuoteMin: 1n,
        lpTo: Recipient.VAULT,
        devBuyQuoteWei: E(2),
        devBuyMinTokensOut: 1n,
        devBuyTo: Recipient.BURN,
        residualTo: Recipient.OPERATOR,
        deadline: FAR - 99n,
      });
      const { rec, parsed, launchId } = await recordOf(ctx, await launch(ctx, p, ctx.operator, E(3)));

      const t = await ethers.getContractAt("PadToken", token);
      const pool = await ethers.getContractAt("MockV3Pool", rec.pool);
      const pos = await ctx.npm.positions(rec.positionId);

      // --- indexed topics -----------------------------------------------------------------------------
      expect(launchId).to.equal(101n);
      expect(parsed.args.token).to.equal(token);
      expect(parsed.args.creator).to.equal(ctx.operator.address);

      // --- 1..4 identity + orientation, checked against the venue, not against the params --------------
      expect(rec.pool).to.equal(await ctx.factory.getPool(token, ctx.wethAddr, 10000));
      expect(rec.factory).to.equal(ctx.factoryAddr);
      expect(rec.quoteToken).to.equal(ctx.wethAddr);
      expect(rec.tokenIsToken0).to.equal(BigInt(token) < BigInt(ctx.wethAddr));
      expect(rec.tokenIsToken0).to.equal(false);

      // --- 5..9 pool geometry, read back off the pool and the position --------------------------------
      expect(rec.fee).to.equal(await pool.fee());
      expect(rec.tickSpacing).to.equal(await pool.tickSpacing());
      expect(rec.tickSpacing).to.equal(await ctx.factory.feeAmountTickSpacing(10000));
      expect((await pool.slot0())[0]).to.equal(await ctx.ticks.sqrt(rec.openingTick));
      expect(rec.openingTick).to.equal(206800n);
      expect(rec.tickLower).to.equal(pos[5]);
      expect(rec.tickUpper).to.equal(pos[6]);

      // --- 10..15 the seed: REQUESTED vs ACHIEVED, achieved measured off real balances ----------------
      expect(rec.requestedSeedToken).to.equal(6n * 10n ** 26n);
      expect(rec.requestedSeedQuote).to.equal(E(1));
      expect(rec.seedAmount0 + rec.devBuyAmount0).to.equal(await ctx.weth.balanceOf(rec.pool));
      // the pool's token balance is the seed MINUS what the dev buy walked out
      expect(rec.seedAmount1).to.equal((await t.balanceOf(rec.pool)) + 5n * 10n ** 24n);
      expect(rec.seedLiquidity).to.equal(pos[7]);
      expect(rec.seedLiquidity).to.equal(await pool.liquidity());
      expect(rec.positionId).to.equal(1n);

      // --- 16 LP custody ------------------------------------------------------------------------------
      expect(rec.lpRecipient).to.equal(ctx.vault.address);
      expect(await ctx.npm.ownerOf(rec.positionId)).to.equal(ctx.vault.address);

      // --- 17..21 the dev buy, signed exactly as the Swap log carries it ------------------------------
      expect(rec.requestedDevBuyQuote).to.equal(E(2));
      expect(rec.devBought).to.equal(true);
      expect(rec.devBuyAmount0).to.equal(E(2));
      expect(rec.devBuyAmount1).to.equal(-(5n * 10n ** 24n));
      expect(rec.devBuyRecipient).to.equal(DEAD);
      expect(await t.balanceOf(DEAD)).to.equal(5n * 10n ** 24n);

      // --- 22..25 token facts and residual disposal ---------------------------------------------------
      expect(rec.totalSupply).to.equal(await t.totalSupply());
      expect(rec.decimals).to.equal(await t.decimals());
      expect(rec.decimals).to.equal(9n);
      expect(rec.residualTo).to.equal(ctx.operator.address);
      expect(rec.residualTokens).to.equal(await t.balanceOf(ctx.operator.address));
      expect(rec.residualTokens).to.equal(SUPPLY - rec.seedAmount1);

      // --- 26..27 native accounting, auditable from the log alone -------------------------------------
      expect(rec.nativeIn).to.equal(E(1) + E(2) + E(3));
      expect(rec.nativeRefunded).to.equal(E(3) + (E(1) - rec.seedAmount0));

      // --- 28..33 provenance --------------------------------------------------------------------------
      expect(rec.experimentId).to.equal(eid);
      expect(rec.armId).to.equal(aid);
      expect(rec.replicate).to.equal(7n);
      expect(rec.operator).to.equal(ctx.operator.address);
      expect(rec.name).to.equal(await t.name());
      expect(rec.symbol).to.equal(await t.symbol());
    });

    it("E3: achieved differs from requested, visibly and by the exact venue shortfall", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      const shortfall = rec.requestedSeedToken - rec.seedAmount1;
      expect(shortfall).to.equal(5442n);
      expect(shortfall).to.be.greaterThan(0n);
    });

    it("E4: the record's pool equals both the CREATE2 prediction and the factory's own getPool", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx);
      const pv = await ctx.pad.previewLaunch(p);
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.pool).to.equal(pv.predictedPool);
      expect(rec.pool).to.equal(await ctx.factory.getPool(token, ctx.wethAddr, 10000));
    });

    it("E5: ExperimentDeclared fires in its OWN transaction, before any launch, never from launch()", async () => {
      const ctx = await setup();
      const eid = ethers.id("exp/pre-registered");
      const declareRc = await (await ctx.pad.connect(ctx.owner).declareExperiment(eid, "seeded quote sweep")).wait();
      await expect(declareRc).to.not.equal(null);

      const { p } = build(ctx, { experimentId: eid });
      const rc = await (await launch(ctx, p)).wait();
      expect(rc.blockNumber).to.be.greaterThan(declareRc.blockNumber); // pre-registration is provable by order
      const declTopic = ctx.pad.interface.getEvent("ExperimentDeclared").topicHash;
      expect(rc.logs.filter((l) => l.topics[0] === declTopic).length).to.equal(0);
    });

    it("E6: the governance events fire with the documented topic0s", async () => {
      const ctx = await setup();
      const t = (n) => ctx.pad.interface.getEvent(n).topicHash;
      expect(t("ExperimentDeclared")).to.equal("0x933cdd0315994f2e914d3292c66aed9b819d35276fbb1b4f1454ecf2485149be");
      expect(t("OperatorSet")).to.equal("0x1a594081ae893ab78e67d9b9e843547318164322d32c65369d78a96172d9dc8f");
      expect(t("RescueRecipientProposed")).to.equal("0x655141062e4b7333b7ee518799385fa365de7aa42812311e00a52422ab6a93ac");
      expect(t("RescueRecipientCommitted")).to.equal("0x518f00fff3bf6ce770be8e73fab3199bf0747ef22fcaf7cf29f866f84ca0a736");
      expect(t("Swept")).to.equal("0x7b09c29f9106defeccc9ac3b823f3aad0b470d120e5df7aed033b5c43a4bf718");

      await expect(ctx.pad.connect(ctx.owner).setOperator(ctx.stranger.address, true))
        .to.emit(ctx.pad, "OperatorSet").withArgs(ctx.stranger.address, true);
      await expect(ctx.pad.connect(ctx.owner).declareExperiment(ethers.id("e"), "n"))
        .to.emit(ctx.pad, "ExperimentDeclared").withArgs(ethers.id("e"), ctx.owner.address, "n");
    });
  });

  // =========================================================================================================
  // GROUP F — preflight fires before money moves
  // =========================================================================================================
  describe("F — preflight fires before money moves", () => {
    async function expectPreflightRevert(ctx, p, err, args) {
      const call = launch(ctx, p);
      const e = args
        ? await expect(call).to.be.revertedWithCustomError(ctx.pad, err).withArgs(...args)
        : await expect(call).to.be.revertedWithCustomError(ctx.pad, err);
      expect(await ctx.pad.launchCount(), "launchCount must be untouched").to.equal(0n);
      return e;
    }

    it("F1: a disabled tier reverts FeeTierDisabled and deploys nothing", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { fee: 2500 });
      await expectPreflightRevert(ctx, p, "FeeTierDisabled", [2500]);
    });

    it("F2: the fee->spacing map is READ, so a non-canonical venue changes what aligns", async () => {
      const ctx = await setup();
      // Factory 0xe0c4ceb9... really emits fee 10000 with tickSpacing 100. Reproduce it.
      await ctx.factory.setFeeAmountTickSpacing(10000, 100);
      const ok = build(ctx, { tickLower: 46000, tickUpper: 206800 }); // aligned to 200 ⇒ also aligned to 100
      const { rec } = await recordOf(ctx, await launch(ctx, ok.p));
      expect(rec.tickSpacing).to.equal(100n);

      const bad = build(ctx, { tickLower: 46050, name: "Mis", symbol: "MIS" }); // aligned to neither
      await expect(launch(ctx, bad.p))
        .to.be.revertedWithCustomError(ctx.pad, "TickNotAligned").withArgs(46050, 100);
    });

    it("F3: a misaligned bound reverts TickNotAligned with the offending tick and spacing", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { tickLower: 46100 });
      await expectPreflightRevert(ctx, p, "TickNotAligned", [46100, 200]);
    });

    it("F4: an inverted or empty range reverts BadRange", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { tickLower: 206800, tickUpper: 46000 });
      await expectPreflightRevert(ctx, p, "BadRange");
    });

    it("F5: 887272 is NOT usable at spacing 200 — 887400 is out of bounds, 887200 works", async () => {
      const ctx = await setup();
      // Alignment is checked before bounds, and 887272 % 200 == 72, so this is the alignment failure.
      const a = build(ctx, { ...straddleDefaults(), tickUpper: 887272 });
      await expectPreflightRevert(ctx, a.p, "TickNotAligned", [887272, 200]);

      const b = build(ctx, { ...straddleDefaults(), tickUpper: 887400 });
      await expectPreflightRevert(ctx, b.p, "TickOutOfBounds", [887400]);

      const c = build(ctx, straddleDefaults());
      await expect(launch(ctx, c.p)).to.emit(ctx.pad, "Launched");
    });

    it("F6: a straddling range with zero quote reverts RangeSideMismatch, naming the numbers", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { tickLower: -887200, tickUpper: 887200, seedQuoteWei: 0n });
      // previewLaunch answers the whole question in ONE eth_call: liquidity 0 means the cell is degenerate,
      // and the achieved amounts name the quote this range would need at this supply.
      const pv = await ctx.pad.previewLaunch(p);
      expect(pv.liquidity).to.equal(0n);
      expect(pv.amount0Achieved).to.be.greaterThan(0n);
      await expectPreflightRevert(ctx, p, "RangeSideMismatch", [
        pv.amount0Achieved, pv.amount1Achieved, 0n, p.seedTokenAmount,
      ]);
    });

    it("F7: a single-sided range with a nonzero quote also reverts RangeSideMismatch", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { seedQuoteWei: E(1) }); // range entirely at/below the open ⇒ token-only
      await expectPreflightRevert(ctx, p, "RangeSideMismatch");
    });

    it("F8: the BRACKETS boundary case (openingTick == tickUpper, zero quote) SUCCEEDS", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      expect(p.openingTick).to.equal(p.tickUpper);
      const { rec } = await recordOf(ctx, await launch(ctx, p));
      expect(rec.seedAmount0).to.equal(0n);
      expect(rec.seedAmount1).to.equal(V4_AMOUNT1);
    });

    it("F9: a salt that lands on the wrong side reverts SortSideMismatch", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx);
      const wrong = { ...p, wantTokenIsToken0: true }; // salt was mined for token1
      await expectPreflightRevert(ctx, wrong, "SortSideMismatch", [token, false]);
    });

    it("F10: relaunching the same predicted token reverts AlreadyLaunched", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      await launch(ctx, p);
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "AlreadyLaunched");
      expect(await ctx.pad.launchCount()).to.equal(1n);
    });

    it("F11: an expired deadline reverts Expired", async () => {
      const ctx = await setup();
      const { p } = build(ctx, { deadline: 1n });
      await expectPreflightRevert(ctx, p, "Expired");
    });

    it("F12: a zero supply reverts BadToken; an over-sized seed reverts BadSeed", async () => {
      const ctx = await setup();
      const a = build(ctx, { totalSupply: 0n });
      await expectPreflightRevert(ctx, a.p, "BadToken");
      const b = build(ctx, { seedTokenAmount: SUPPLY + 1n });
      await expectPreflightRevert(ctx, b.p, "BadSeed");
      const c = build(ctx, { name: "" });
      await expectPreflightRevert(ctx, c.p, "BadToken");
    });

    it("F13: a dev-buy limit on the wrong side of the opening price reverts BadLimitSide", async () => {
      const ctx = await setup();
      // token1 case ⇒ zeroForOne ⇒ the limit must sit BELOW sqrtStart.
      const { p } = build(ctx, { devBuyQuoteWei: E(1), devBuySqrtPriceLimitX96: V1_SQRT_206800 + 1n });
      await expectPreflightRevert(ctx, p, "BadLimitSide");
    });
  });

  // =========================================================================================================
  // GROUP G — pool verification and the front-run
  // =========================================================================================================
  describe("G — pool verification and front-run", () => {
    it("G1: a pool pre-initialized at a hostile price is REFUSED before its price is read", async () => {
      const ctx = await setup();
      const { p, token } = build(ctx);
      await ctx.factory.createPool(token, ctx.wethAddr, 10000);
      const poolAddr = await ctx.factory.getPool(token, ctx.wethAddr, 10000);
      const pool = await ethers.getContractAt("MockV3Pool", poolAddr);
      const hostile = await ctx.ticks.sqrt(100000);
      await pool.initialize(hostile);

      // Rejected by the pre-existence check before the price is even read — stricter than the
      // PoolAlreadyInit path it used to take, and rejected earlier for the same reason as G2.
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "PoolAlreadyExists");
    });

    it("G2: a pool pre-created in an EARLIER tx is REFUSED, even at our exact price", async () => {
      // Adoption used to be allowed here. It must not be: createAndInitializePoolIfNecessary is
      // idempotent, so adopting emits no Initialize log in the launch tx, and the observational
      // pipeline keys a launch on `sameTxAsBirth` (scripts/watch-launches.cjs). An adopted pool
      // therefore joins the dataset as one that was never born — a TREATED launch silently filed as
      // a control. Losing a launch is cheap; mislabelling one corrupts the result.
      const ctx = await setup();
      const { p, token } = build(ctx);
      await ctx.factory.createPool(token, ctx.wethAddr, 10000);
      const poolAddr = await ctx.factory.getPool(token, ctx.wethAddr, 10000);
      await (await ethers.getContractAt("MockV3Pool", poolAddr)).initialize(V1_SQRT_206800);
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "PoolAlreadyExists");
    });

    it("G3: a position manager returning some other pool reverts PoolAddressMismatch", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      const pv = await ctx.pad.previewLaunch(p);
      await ctx.npm.setPoolOverride(ctx.stranger.address);
      await expect(launch(ctx, p))
        .to.be.revertedWithCustomError(ctx.pad, "PoolAddressMismatch")
        .withArgs(pv.predictedPool, ctx.stranger.address);
    });

    it("G4: with an unmeasured init hash the pad falls back to getPool — and still catches a mismatch", async () => {
      const ctx = await setup();
      const pad2 = await (await ethers.getContractFactory("AtomicExperimentPad")).deploy(
        ctx.owner.address, ctx.rescue.address, ctx.vault.address,
        ctx.factoryAddr, ctx.npmAddr, ctx.wethAddr, HARDHAT_CHAIN, 200n, ethers.ZeroHash,
      );
      const pad2Addr = await pad2.getAddress();
      await pad2.connect(ctx.owner).setOperator(ctx.operator.address, true);

      const p = { ...bracketsDefaults() };
      const mined = mineSalt(pad2Addr, p, ctx.wethAddr, false);
      p.tokenSalt = mined.salt;

      // Happy path: no CREATE2 prediction available, so the equality is against the factory's own answer.
      await expect(pad2.connect(ctx.operator).launch(p, { value: 0 })).to.emit(pad2, "Launched");
      expect(await ctx.factory.getPool(mined.token, ctx.wethAddr, 10000)).to.not.equal(ethers.ZeroAddress);

      const p2 = { ...bracketsDefaults(), name: "Two", symbol: "TWO" };
      p2.tokenSalt = mineSalt(pad2Addr, p2, ctx.wethAddr, false).salt;
      await ctx.npm.setPoolOverride(ctx.stranger.address);
      await expect(pad2.connect(ctx.operator).launch(p2, { value: 0 }))
        .to.be.revertedWithCustomError(pad2, "PoolAddressMismatch");
    });

    it("G5: a pool whose spacing disagrees with the factory map reverts SpacingMismatch", async () => {
      const ctx = await setup();
      const { p } = build(ctx);
      // The pool must be BORN with the wrong spacing: staging it by pre-creating one now trips the
      // pre-existence guard first (see G2), so this uses a factory hook instead.
      await ctx.factory.setSpacingOverrideOnCreate(60);
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "SpacingMismatch");
    });
  });

  // =========================================================================================================
  // GROUP H — callback security. The transient latch is the whole authentication.
  // =========================================================================================================
  describe("H — callback security", () => {
    it("H1: the drain regression — a hostile pool cannot pull stray WETH out of the pad", async () => {
      const ctx = await setup();
      await ctx.weth.connect(ctx.stranger).deposit({ value: E(5) });
      await ctx.weth.connect(ctx.stranger).transfer(ctx.padAddr, E(5));

      const hostile = await (await ethers.getContractFactory("HostilePool")).deploy();
      await expect(hostile.attack(ctx.padAddr, true, E(5)))
        .to.be.revertedWithCustomError(ctx.pad, "NotPool");
      expect(await ctx.weth.balanceOf(ctx.padAddr)).to.equal(E(5));
    });

    it("H2: a direct callback outside a launch reverts NotPool", async () => {
      const ctx = await setup();
      await expect(
        ctx.pad.connect(ctx.stranger).uniswapV3SwapCallback(E(1), 0, abi.encode(["bool"], [true])),
      ).to.be.revertedWithCustomError(ctx.pad, "NotPool");
    });

    it("H3: the latch is CLEARED after a completed launch", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.NORMAL, 10000, 5n * 10n ** 24n);
      const { p } = build(ctx, { devBuyQuoteWei: E(1) });
      await launch(ctx, p);

      await ctx.weth.connect(ctx.stranger).deposit({ value: E(1) });
      await ctx.weth.connect(ctx.stranger).transfer(ctx.padAddr, E(1));
      const hostile = await (await ethers.getContractFactory("HostilePool")).deploy();
      await expect(hostile.attack(ctx.padAddr, true, E(1)))
        .to.be.revertedWithCustomError(ctx.pad, "NotPool");
      expect(await ctx.weth.balanceOf(ctx.padAddr)).to.equal(E(1));
    });

    it("H4: a callback whose owed delta is not positive reverts NotPool", async () => {
      const ctx = await setup();
      await ctx.factory.setPoolDefaults(FillMode.ZERO, 10000, 0n); // consumes nothing ⇒ owed == 0
      const { p } = build(ctx, { devBuyQuoteWei: E(1) });
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "NotPool");
      expect(await ctx.pad.launchCount()).to.equal(0n); // the claim was rolled back with the tx
    });

    it("H5: a sweep cannot be re-entered from inside a launch — they share one lock", async () => {
      const ctx = await setup();
      await ctx.weth.setReenterTarget(ctx.padAddr); // WETH.deposit() will call back into sweepStrandedNative
      const { p } = build(ctx, straddleDefaults());
      await expect(launch(ctx, p)).to.be.revertedWithCustomError(ctx.pad, "ReentrancyGuardReentrantCall");
    });
  });
});

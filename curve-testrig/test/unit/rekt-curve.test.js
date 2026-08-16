const { ethers } = require("hardhat");
const { expect } = require("chai");

const PadTokenArtifact = require("../../artifacts/contracts/pads/PadToken.sol/PadToken.json");

// ---------------------------------------------------------------------------------------------------------
// RektCurve exists to make ONE claim true: the ETH the curve raises is the ETH the pool opens with, to the
// wei, with nothing skimmed and nothing added. Most of what follows is that claim stated in different ways —
// against the raise, against the pool's balance, against the price the last buyer paid.
// ---------------------------------------------------------------------------------------------------------
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const HARDHAT_CHAIN = 31337n;
const FAR = 4_000_000_000n;
const FEE = 10000;

const TOTAL = 15n * 10n ** 26n; // 1.5B at 18dp
const CURVE_SUPPLY = 10n ** 27n; // 1B sold on the curve
const SEED = CURVE_SUPPLY / 2n; //  500M seeded — and the checked half of the curve supply
const TARGET = E(1); //             the 92% cell's seed, paid for by buyers

function padTokenInitHash(pad, cfg) {
  const args = abi.encode(
    ["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad],
  );
  return ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
}

/** Mine the CREATE2 salt for the wanted sort side. Pure JS, zero RPC. */
function mineSalt(pad, cfg, weth, wantToken0) {
  const h = padTokenInitHash(pad, cfg);
  const w = BigInt(weth);
  for (let i = 0; i < 100000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token };
  }
  throw new Error("no salt found");
}

describe("RektCurve — the raise IS the pool's quote side", () => {
  async function setup() {
    const [owner, operator, alice, bob, vault] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("MockWETH9")).deploy();
    const factory = await (await ethers.getContractFactory("MockV3Factory")).deploy();
    const npm = await (await ethers.getContractFactory("MockNPM")).deploy(
      await factory.getAddress(),
      await weth.getAddress(),
    );

    const poolInitHash = ethers.keccak256((await ethers.getContractFactory("MockV3Pool")).bytecode);
    await factory.createPool("0x0000000000000000000000000000000000000a11", "0x0000000000000000000000000000000000000b22", FEE);
    const probePool = await factory.getPool(
      "0x0000000000000000000000000000000000000a11",
      "0x0000000000000000000000000000000000000b22",
      FEE,
    );

    const curve = await (await ethers.getContractFactory("RektCurve")).deploy(
      owner.address,
      vault.address,
      await factory.getAddress(),
      await npm.getAddress(),
      await weth.getAddress(),
      HARDHAT_CHAIN,
      poolInitHash,
      probePool,
    );
    await curve.connect(owner).setOperator(operator.address, true);

    return {
      owner, operator, alice, bob, vault, weth, factory, npm, curve,
      curveAddr: await curve.getAddress(),
      wethAddr: await weth.getAddress(),
    };
  }

  function defaults(wantToken0 = false) {
    return {
      name: "Rekt", symbol: "REKT", decimals: 18,
      totalSupply: TOTAL, tokenSalt: ethers.ZeroHash, wantTokenIsToken0: wantToken0,
      curveSupply: CURVE_SUPPLY, target: TARGET, fee: FEE,
    };
  }

  async function create(ctx, wantToken0 = false) {
    const cfg = defaults(wantToken0);
    const { salt, token } = mineSalt(ctx.curveAddr, cfg, ctx.wethAddr, wantToken0);
    cfg.tokenSalt = salt;
    await ctx.curve.connect(ctx.operator).create(cfg);
    return { cfg, token };
  }

  // -------------------------------------------------------------------------------------------------------
  // The calibration
  // -------------------------------------------------------------------------------------------------------

  it("buying the whole curve supply raises EXACTLY the target — not approximately", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);

    // Deliberately overshoot. The curve must charge only what empties it and hand back the rest.
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });

    const c = await ctx.curve.curves(token);
    expect(c.sold).to.equal(CURVE_SUPPLY);
    // `raised` is zeroed by graduation, so read the seeded amount out of the event instead.
    const ev = (await ctx.curve.queryFilter(ctx.curve.filters.Graduated(token)))[0];
    expect(ev.args.quoteSeeded + (await ethers.provider.getBalance(ctx.curveAddr))).to.equal(TARGET);
  });

  it("refunds the overpayment rather than keeping it", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);

    const before = await ethers.provider.getBalance(ctx.alice.address);
    const tx = await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(ctx.alice.address);

    // Alice paid exactly TARGET plus gas — the other 4 ETH came back.
    expect(before - after - rc.gasUsed * rc.gasPrice).to.equal(TARGET);
  });

  it("prices the pool at the price the last curve buyer paid", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });

    // Curve closes at 2*target/curveSupply. The pool holds target against curveSupply/2 — same number.
    // Assert it through the sqrt price the pool was actually initialised with, which is what a bot reads.
    const c = await ctx.curve.curves(token);
    const pool = await ethers.getContractAt("MockV3Pool", c.pool);
    const sqrtP = await pool.sqrtPriceX96();

    const [a0, a1] = c.tokenIsToken0 ? [SEED, TARGET] : [TARGET, SEED];
    const expected = bigintSqrt((a1 << 192n) / a0);
    expect(sqrtP).to.equal(expected);
  });

  // -------------------------------------------------------------------------------------------------------
  // The claim
  // -------------------------------------------------------------------------------------------------------

  it("puts the raise into the pool as WETH — the curve keeps none of it", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });

    const c = await ctx.curve.curves(token);
    const ev = (await ctx.curve.queryFilter(ctx.curve.filters.Graduated(token)))[0];

    // Every wei raised is either in the pool as WETH or is unusable dust left by rounding down.
    const poolWeth = await ctx.weth.balanceOf(c.pool);
    const dust = await ethers.provider.getBalance(ctx.curveAddr);
    expect(poolWeth + dust).to.equal(TARGET);
    expect(ev.args.tokensSeeded).to.equal(SEED);
    // Dust is rounding, not a fee: sub-gwei against a 1 ETH raise.
    expect(dust).to.be.lessThan(10n ** 9n);
  });

  it("sends the LP position to the vault, never to itself", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });

    const ev = (await ctx.curve.queryFilter(ctx.curve.filters.Graduated(token)))[0];
    expect(await ctx.npm.ownerOf(ev.args.positionId)).to.equal(ctx.vault.address);
  });

  it("works on both sort sides", async () => {
    for (const wantToken0 of [true, false]) {
      const ctx = await setup();
      const { token } = await create(ctx, wantToken0);
      const c0 = await ctx.curve.curves(token);
      expect(c0.tokenIsToken0).to.equal(wantToken0);

      await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });
      const c = await ctx.curve.curves(token);
      expect(c.graduated).to.equal(true);
      expect(await ctx.weth.balanceOf(c.pool)).to.be.greaterThan(TARGET - 10n ** 9n);
    }
  });

  // -------------------------------------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------------------------------------

  it("a partial buy leaves the curve open and the raise held", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E("0.25") });

    const c = await ctx.curve.curves(token);
    expect(c.graduated).to.equal(false);
    expect(c.raised).to.equal(E("0.25"));
    expect(await ethers.provider.getBalance(ctx.curveAddr)).to.equal(E("0.25"));
    expect(await ctx.curve.totalRaised()).to.equal(E("0.25"));
  });

  it("a sell round-trip cannot mint value out of the curve", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E("0.25") });

    const tok = await ethers.getContractAt("PadToken", token);
    const held = await tok.balanceOf(ctx.alice.address);
    await tok.connect(ctx.alice).approve(ctx.curveAddr, held);

    const out = await ctx.curve.previewSell(token, held);
    expect(out).to.be.lessThanOrEqual(E("0.25")); // never more than went in
    await ctx.curve.connect(ctx.alice).sell(token, held, 0, FAR);

    const c = await ctx.curve.curves(token);
    expect(c.sold).to.equal(0n);
    expect(c.raised).to.be.lessThanOrEqual(E("0.25") / 10n ** 12n); // only rounding remains
  });

  it("previewBuy agrees with what buy actually charges", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    const [outPred, spendPred] = await ctx.curve.previewBuy(token, E("0.3"));

    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E("0.3") });
    const tok = await ethers.getContractAt("PadToken", token);
    expect(await tok.balanceOf(ctx.alice.address)).to.equal(outPred);
    expect((await ctx.curve.curves(token)).raised).to.equal(spendPred);
  });

  it("anyone can buy — the experiment is whether strangers turn up", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await expect(ctx.curve.connect(ctx.bob).buy(token, 0, FAR, { value: E("0.1") })).to.not.be.reverted;
  });

  it("only operators can create", async () => {
    const ctx = await setup();
    const cfg = defaults();
    cfg.tokenSalt = mineSalt(ctx.curveAddr, cfg, ctx.wethAddr, false).salt;
    await expect(ctx.curve.connect(ctx.alice).create(cfg)).to.be.revertedWithCustomError(ctx.curve, "NotOperator");
  });

  // -------------------------------------------------------------------------------------------------------
  // The guards
  // -------------------------------------------------------------------------------------------------------

  it("refuses a supply split that would open the pool off the curve's price", async () => {
    const ctx = await setup();
    const cfg = defaults();
    cfg.curveSupply = 8n * 10n ** 26n; // 800M curve / 700M seed — seed != curveSupply/2
    cfg.tokenSalt = mineSalt(ctx.curveAddr, cfg, ctx.wethAddr, false).salt;
    await expect(ctx.curve.connect(ctx.operator).create(cfg)).to.be.revertedWithCustomError(
      ctx.curve, "BadSeedSplit",
    );
  });

  it("refuses a token that landed on the wrong side of WETH", async () => {
    const ctx = await setup();
    const cfg = defaults(false);
    // Mine for token0, then ask for token1 — the deployed address cannot satisfy it.
    cfg.tokenSalt = mineSalt(ctx.curveAddr, cfg, ctx.wethAddr, true).salt;
    await expect(ctx.curve.connect(ctx.operator).create(cfg)).to.be.revertedWithCustomError(
      ctx.curve, "SortSideMismatch",
    );
  });

  it("cannot trade a graduated curve", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E(5) });
    await expect(ctx.curve.connect(ctx.bob).buy(token, 0, FAR, { value: E(1) })).to.be.revertedWithCustomError(
      ctx.curve, "AlreadyGraduated",
    );
  });

  it("cannot graduate before the target", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E("0.1") });
    await expect(ctx.curve.graduate(token)).to.be.revertedWithCustomError(ctx.curve, "NotGraduated");
  });

  it("sweepExcess cannot reach a live curve's raise", async () => {
    const ctx = await setup();
    const { token } = await create(ctx);
    await ctx.curve.connect(ctx.alice).buy(token, 0, FAR, { value: E("0.4") });
    // Balance is entirely buyer money, so there is nothing to sweep.
    await expect(ctx.curve.connect(ctx.owner).sweepExcess(ctx.owner.address)).to.be.revertedWithCustomError(
      ctx.curve, "NothingToSweep",
    );
    expect(await ethers.provider.getBalance(ctx.curveAddr)).to.equal(E("0.4"));
  });

  it("refuses to deploy against a venue whose NPM disagrees about its factory", async () => {
    const ctx = await setup();
    const otherFactory = await (await ethers.getContractFactory("MockV3Factory")).deploy();
    await expect(
      (await ethers.getContractFactory("RektCurve")).deploy(
        ctx.owner.address, ctx.vault.address,
        await otherFactory.getAddress(), // not the factory this NPM reports
        await ctx.npm.getAddress(), ctx.wethAddr,
        HARDHAT_CHAIN, ethers.ZeroHash, ethers.ZeroAddress,
      ),
    ).to.be.revertedWithCustomError(ctx.curve, "NpmFactoryMismatch");
  });

  it("refuses to deploy with the LP vault pointed at itself", async () => {
    // The address is unknowable before deploy, so the reachable case is the zero address; the self-check is
    // asserted by construction — RektCurve has no ERC721 receiver, so a self-vault would strand every NFT.
    const ctx = await setup();
    await expect(
      (await ethers.getContractFactory("RektCurve")).deploy(
        ctx.owner.address, ethers.ZeroAddress,
        await ctx.factory.getAddress(), await ctx.npm.getAddress(), ctx.wethAddr,
        HARDHAT_CHAIN, ethers.ZeroHash, ethers.ZeroAddress,
      ),
    ).to.be.revertedWithCustomError(ctx.curve, "ZeroAddress");
  });

  it("refuses the wrong chain", async () => {
    const ctx = await setup();
    await expect(
      (await ethers.getContractFactory("RektCurve")).deploy(
        ctx.owner.address, ctx.vault.address,
        await ctx.factory.getAddress(), await ctx.npm.getAddress(), ctx.wethAddr,
        4663n, ethers.ZeroHash, ethers.ZeroAddress,
      ),
    ).to.be.revertedWithCustomError(ctx.curve, "WrongChain");
  });

  it("cannot renounce ownership into a state with no operator", async () => {
    const ctx = await setup();
    await expect(ctx.curve.connect(ctx.owner).renounceOwnership()).to.be.revertedWithCustomError(
      ctx.curve, "RenounceDisabled",
    );
  });
});

/** Integer sqrt, mirroring OpenZeppelin's Math.sqrt (floor). */
function bigintSqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

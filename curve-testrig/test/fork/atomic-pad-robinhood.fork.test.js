const { ethers } = require("hardhat");
const { expect } = require("chai");

const PadTokenArtifact = require("../../artifacts/contracts/pads/PadToken.sol/PadToken.json");

/**
 * AtomicExperimentPad against the REAL Robinhood Chain venue.
 *
 * SKIPPED BY DEFAULT. https://api.robinlab.io/rpc is the user's own paid proxy with two collectors already
 * running against it, so the default suite must spend ZERO RPC. Run explicitly:
 *
 *   FORK_RPC=https://api.robinlab.io/rpc FORK_CHAINID=4663 \
 *     npx hardhat test test/fork/atomic-pad-robinhood.fork.test.js
 *
 * Requires the `4663: { hardforkHistory: { cancun: 0 } }` entry in networks.hardhat.chains.
 */
const RUN = !!process.env.FORK_RPC;

// MEASURED constants — see contracts/interfaces/IUniswapV3Minimal.sol for how each was verified.
const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const NPM = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const POOL_INIT_CODE_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
const CHAIN_ID = 4663n;
// A REAL pool minted by FACTORY. The constructor re-derives its address from POOL_INIT_CODE_HASH and
// asserts the match, so a wrong hash can no longer deploy cleanly and brick every launch.
const POOL_PROBE = "0x479a1d0d9aec941382d9cab3ba69dd3914d981e9";

const V4_LIQUIDITY = 32341460503543476955346n;
const V4_AMOUNT1 = 999999999999999999999994558n;
const SUPPLY = 10n ** 27n;
const E = (x) => ethers.parseEther(String(x));
const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 };
const abi = ethers.AbiCoder.defaultAbiCoder();

const MINT_TOPIC = ethers.id("Mint(address,address,int24,int24,uint128,uint256,uint256)");

function mineSalt(pad, cfg, weth, wantToken0) {
  const args = abi.encode(
    ["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad],
  );
  const h = ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
  const w = BigInt(weth);
  for (let i = 0; i < 100000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token };
  }
  throw new Error("no salt found");
}

(RUN ? describe : describe.skip)("AtomicExperimentPad — Robinhood Chain fork", () => {
  async function deployPad() {
    const [owner] = await ethers.getSigners();
    const pad = await (await ethers.getContractFactory("AtomicExperimentPad")).deploy(
      owner.address, owner.address, owner.address, FACTORY, NPM, WETH, CHAIN_ID, 1000n, POOL_INIT_CODE_HASH,
      POOL_PROBE,
    );
    return { owner, pad, padAddr: await pad.getAddress() };
  }

  function base(over = {}) {
    return {
      experimentId: ethers.id("fork/arm-zero"),
      armId: ethers.id("fork/arm-zero"),
      replicate: 1,
      name: "Fork Arm Zero",
      symbol: "FAZ",
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
      deadline: 4_000_000_000n,
      ...over,
    };
  }

  it("K1: ARM ZERO — replays the reference launch geometry against the real venue, to the wei", async () => {
    const { owner, pad, padAddr } = await deployPad();
    const p = base();
    p.tokenSalt = mineSalt(padAddr, p, WETH, false).salt;

    const rc = await (await pad.connect(owner).launch(p, { value: 0 })).wait();
    const mint = rc.logs.find((l) => l.topics[0] === MINT_TOPIC);
    expect(mint, "the pool must emit a Mint in the SAME tx as its birth").to.not.equal(undefined);
    const [, liquidity, amount0, amount1] = abi.decode(["address", "uint128", "uint256", "uint256"], mint.data);

    // One assertion that validates the entire geometry story end to end: sort side, tick orientation,
    // spacing alignment, the single-sided side condition, and the round-down shortfall.
    expect(liquidity).to.equal(V4_LIQUIDITY);
    expect(amount0).to.equal(0n);
    expect(amount1).to.equal(V4_AMOUNT1);
  });

  it("K2: THE UNTESTED REGIME — nonzero seeded quote, straddling range, and a real dev buy", async () => {
    const { owner, pad, padAddr } = await deployPad();
    const p = base({
      name: "Fork Two Sided",
      symbol: "F2S",
      armId: ethers.id("fork/two-sided"),
      tickLower: -887200,
      tickUpper: 887200,
      seedQuoteWei: E(0.05),
      devBuyQuoteWei: E(0.01),
    });
    p.tokenSalt = mineSalt(padAddr, p, WETH, false).salt;

    const preview = await pad.previewLaunch(p);
    expect(preview.liquidity).to.be.greaterThan(0n);
    expect(preview.amount0Achieved).to.be.greaterThan(0n);
    expect(preview.amount1Achieved).to.be.greaterThan(0n);

    const rc = await (await pad.connect(owner).launch(p, { value: E(0.06) })).wait();
    const log = rc.logs.find((l) => l.address.toLowerCase() === padAddr.toLowerCase());
    const rec = pad.interface.parseLog({ topics: [...log.topics], data: log.data }).args.record;

    // Both sides live — the regime the reference pad NEVER exercised, which is the reason this pad exists.
    expect(rec.seedAmount0).to.be.greaterThan(0n);
    expect(rec.seedAmount1).to.be.greaterThan(0n);
    expect(rec.devBought).to.equal(true);
    expect(rec.devBuyAmount0).to.be.greaterThan(0n); // WETH in
    expect(rec.devBuyAmount1).to.be.lessThan(0n); // tokens out
  });

  it("K3: the fee->tickSpacing map still matches what was measured — a drifted venue fails loudly", async () => {
    const factory = await ethers.getContractAt("IUniswapV3Factory", FACTORY);
    const expected = { 100: 1n, 500: 10n, 3000: 60n, 10000: 200n, 2500: 0n, 20000: 0n };
    for (const [fee, spacing] of Object.entries(expected)) {
      expect(await factory.feeAmountTickSpacing(Number(fee)), `tier ${fee}`).to.equal(spacing);
    }
  });
});

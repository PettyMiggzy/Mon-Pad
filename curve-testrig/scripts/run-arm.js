#!/usr/bin/env node
/*
 * Run one arm of an experiment through AtomicExperimentPad.
 *
 * RPC BUDGET IS A HARD CONSTRAINT. https://api.robinlab.io/rpc is a paid proxy with two collectors already
 * running against it. This script therefore:
 *   - mines every CREATE2 salt in PURE JS (zero calls; ~2 attempts on average per cell),
 *   - spends exactly ONE eth_call (previewLaunch) per cell to confirm the contract agrees with the plan,
 *   - sends launches strictly one at a time with a >= MIN_GAP_MS pause,
 *   - never sweeps logs.
 *
 * It also refuses to run an arm whose experimentId has no prior ExperimentDeclared log — pre-registration
 * enforced in the tooling as well as in block order.
 *
 * Usage:
 *   PAD=0x.. ARM=path/to/arm.json npx hardhat run scripts/run-arm.js --network <net>
 *   DRY_RUN=1 to preview every cell and send nothing.
 *
 * arm.json shape (units are the contract's — see IUniswapV3Minimal.sol / LaunchParams NatSpec):
 * {
 *   "experiment": "seed-quote-sweep",          // hashed with keccak256(utf8) into experimentId
 *   "arm": "quote=1e18",                       // hashed into armId
 *   "replicates": 3,
 *   "declaredFromBlock": 0,                    // optional: narrows the ExperimentDeclared lookup
 *   "cell": {                                  // any LaunchParams field except the derived ones
 *     "name": "Probe", "symbol": "PRB", "decimals": 18,
 *     "totalSupply": "1000000000000000000000000000",
 *     "wantTokenIsToken0": false,
 *     "fee": 10000, "openingTick": 206800, "tickLower": -887200, "tickUpper": 887200,
 *     "seedTokenAmount": "1000000000000000000000000000",
 *     "seedQuoteWei": "1000000000000000000",
 *     "lpTo": "VAULT", "devBuyQuoteWei": "0", "devBuyTo": "OPERATOR", "residualTo": "BURN"
 *   }
 * }
 * Replicates within an arm are BYTE-IDENTICAL in treatment. Distinctness comes from starting each
 * replicate's CREATE2 salt search at a different offset, NOT from mutating name/symbol — those are
 * themselves experimental variables (they are what a human or a scanner reads), so varying them per
 * replicate would silently confound every within-arm comparison with a text difference.
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const PadTokenArtifact = require("../artifacts/contracts/pads/PadToken.sol/PadToken.json");

const MIN_GAP_MS = Number(process.env.MIN_GAP_MS || 250); // >= 200ms, the stated budget floor
const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 };
const abi = ethers.AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recip(v) {
  if (typeof v === "number") return v;
  const k = String(v || "OPERATOR").toUpperCase();
  if (!(k in Recipient)) throw new Error(`unknown recipient level ${v} (OPERATOR | VAULT | BURN)`);
  return Recipient[k];
}

/** Pure-JS CREATE2 mining. The sort side is an experimental variable; discovering it must cost no RPC. */
function mineSalt(pad, cfg, weth, wantToken0, startAt = 0) {
  const args = abi.encode(
    ["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad],
  );
  const h = ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
  const w = BigInt(weth);
  // Start each replicate at its own offset so identical (name, symbol, supply) still yields distinct
  // token addresses. Half of all salts satisfy either sort side, so this terminates in ~2 tries.
  for (let i = startAt; i < startAt + 500000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token, tries: i - startAt + 1 };
  }
  throw new Error("no salt found in 500k attempts — check the token config");
}

function buildParams(cell, experimentId, armId, replicate, deadline) {
  return {
    experimentId,
    armId,
    replicate,
    name: cell.name,
    symbol: cell.symbol,
    decimals: cell.decimals ?? 18,
    totalSupply: BigInt(cell.totalSupply),
    tokenSalt: ethers.ZeroHash, // filled in by the miner
    wantTokenIsToken0: !!cell.wantTokenIsToken0,
    fee: cell.fee,
    openingTick: cell.openingTick,
    tickLower: cell.tickLower,
    tickUpper: cell.tickUpper,
    seedTokenAmount: BigInt(cell.seedTokenAmount),
    seedQuoteWei: BigInt(cell.seedQuoteWei ?? 0),
    seedTokenMin: BigInt(cell.seedTokenMin ?? 0),
    seedQuoteMin: BigInt(cell.seedQuoteMin ?? 0),
    lpTo: recip(cell.lpTo),
    devBuyQuoteWei: BigInt(cell.devBuyQuoteWei ?? 0),
    devBuyMinTokensOut: BigInt(cell.devBuyMinTokensOut ?? 0),
    devBuySqrtPriceLimitX96: BigInt(cell.devBuySqrtPriceLimitX96 ?? 0),
    devBuyTo: recip(cell.devBuyTo),
    residualTo: recip(cell.residualTo),
    deadline,
  };
}

async function main() {
  const padAddr = process.env.PAD;
  if (!padAddr || !ethers.isAddress(padAddr)) throw new Error("PAD must be the deployed AtomicExperimentPad address");
  const armFile = process.env.ARM;
  if (!armFile) throw new Error("ARM must point at an arm JSON file");
  const spec = JSON.parse(fs.readFileSync(path.resolve(armFile), "utf8"));

  const [signer] = await ethers.getSigners();
  const pad = await ethers.getContractAt("AtomicExperimentPad", padAddr, signer);
  const weth = await pad.WETH();

  const experimentId = ethers.id(spec.experiment);
  const armId = ethers.id(spec.arm);
  const replicates = Number(spec.replicates || 1);
  const dry = process.env.DRY_RUN === "1";

  // PRE-REGISTRATION GATE. One filtered getLogs, not a sweep.
  const declared = await pad.queryFilter(
    pad.filters.ExperimentDeclared(experimentId),
    Number(spec.declaredFromBlock || 0),
    "latest",
  );
  if (declared.length === 0) {
    throw new Error(
      `experimentId ${experimentId} ("${spec.experiment}") has never been declared on ${padAddr}.\n` +
        "Call declareExperiment(id, note) from the owner key FIRST — a hypothesis registered after the fact " +
        "is not a hypothesis.",
    );
  }
  console.log(`experiment "${spec.experiment}" declared at block ${declared[0].blockNumber}`);
  console.log(`arm "${spec.arm}" x${replicates} on ${network.name} as ${signer.address}${dry ? " (DRY RUN)" : ""}\n`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  for (let r = 1; r <= replicates; r++) {
    const p = buildParams(spec.cell, experimentId, armId, r, deadline);
    const mined = mineSalt(padAddr, p, weth, p.wantTokenIsToken0, r * 2 ** 20);
    p.tokenSalt = mined.salt;

    // ONE eth_call for the whole cell: token, pool, sort side, spacing, opening price, liquidity and the
    // EXACT amounts the mint will pull. If this disagrees with the plan, nothing is sent.
    const pv = await pad.previewLaunch(p);
    console.log(`replicate ${r}: token ${pv.predictedToken} (salt tries ${mined.tries})`);
    console.log(`  pool ${pv.predictedPool}  tokenIsToken0 ${pv.tokenIsToken0}  spacing ${pv.tickSpacing}`);
    console.log(`  liquidity ${pv.liquidity}  amount0 ${pv.amount0Achieved}  amount1 ${pv.amount1Achieved}`);
    if (pv.liquidity === 0n) {
      throw new Error(
        "previewLaunch reports zero liquidity — this cell is degenerate. The achieved amounts above name " +
          "what each side would have to be for this range at this opening tick.",
      );
    }

    if (!dry) {
      const value = p.seedQuoteWei + p.devBuyQuoteWei;
      const tx = await pad.launch(p, { value });
      const rc = await tx.wait();
      const log = rc.logs.find((l) => l.address.toLowerCase() === padAddr.toLowerCase());
      const rec = pad.interface.parseLog({ topics: [...log.topics], data: log.data });
      console.log(
        `  launched id ${rec.args.launchId} in ${rc.hash} (block ${rc.blockNumber})\n` +
          `  seed achieved ${rec.args.record.seedAmount0} / ${rec.args.record.seedAmount1}`,
      );
    }
    // Strictly one in flight, with a gap. Two collectors are already on this endpoint.
    await sleep(MIN_GAP_MS);
  }
  console.log("\nDone. Run scripts/join-launches.cjs before the NEXT arm, not after the twentieth.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});

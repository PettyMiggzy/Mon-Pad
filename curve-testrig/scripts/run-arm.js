#!/usr/bin/env node
/*
 * Run ONE arm of an experiment through RektPad.
 *
 * ------------------------------------------------------------------------------------------------------
 * THE TEXT ON THE TOKEN IS AN EXPERIMENTAL VARIABLE. IT MUST NOT ENCODE THE ARM.
 * ------------------------------------------------------------------------------------------------------
 * `name` and `symbol` are what a human, a scanner and a sniper bot READ. If the treatment arm ships
 * "Probe Q1"/"PQ1" and the control ships "Probe Q0"/"PQ0", then every observation is confounded with a
 * visible text difference and the experiment measures the label, not the seed. So:
 *
 *   - name/symbol/decimals/totalSupply are IDENTICAL across replicates AND ACROSS ARMS,
 *   - distinctness of the deployed token addresses comes ENTIRELY from where each cell starts its
 *     CREATE2 salt search: armId picks a 2**24-wide block, the replicate index picks a 2**20-wide slot
 *     inside it. Disjoint blocks, deterministic, zero RPC, and nothing observable leaks the assignment.
 *
 * A fix that changes only this script fixes nothing — the confound is materialised in the arm JSON files.
 * scripts/arm-quote-seeded.json and scripts/arm-quote-zero.json therefore carry BYTE-IDENTICAL name and
 * symbol. If you add an arm to this experiment, copy that text verbatim.
 *
 * ------------------------------------------------------------------------------------------------------
 * RPC BUDGET. https://api.robinlab.io/rpc is a paid proxy with two collectors already running against it.
 * Every salt is mined in PURE JS (zero calls). Per cell this script spends exactly THREE eth_calls:
 *   1. launchOfToken(token)      — resume: has this exact cell already been launched?
 *   2. previewLaunch(p)          — the readable geometry diagnostic (achieved amounts, liquidity, pool)
 *   3. launch.staticCall(p)      — THE SEND GATE. previewLaunch deliberately returns numbers where launch
 *                                  reverts (its own NatSpec says so): it evaluates neither A10's side
 *                                  condition, nor tick alignment/bounds, nor the deadline, nor name/symbol
 *                                  length, nor seedTokenAmount<=totalSupply, nor min-vs-desired, nor
 *                                  InsufficientValue, nor AlreadyLaunched — and it cannot see a live
 *                                  PoolAlreadyExists front-run at all. staticCall closes all of them.
 * Plus ONE declaration lookup for the whole run. Nothing sweeps logs from block 0.
 *
 * ------------------------------------------------------------------------------------------------------
 * PRE-REGISTRATION. Two gates, both refusing to send anything:
 *   (a) the experimentId must already have an ExperimentDeclared log on this pad, in an EARLIER block;
 *   (b) that declaration's `note` must contain the keccak digest of the CANONICALISED arm spec below.
 * (b) is what makes (a) mean something: the chain only enforces block order, so the digest is what ties
 * those blocks to the parameters actually run. Every launch parameter is already in the Launched event,
 * so a sceptical reader verifies spec-versus-execution by comparing the two — the chain does not do it.
 *
 * CANONICALISATION (reimplement it in ten lines; that is the point):
 *   - drop every top-level key in {declaredFromBlock, declaredTx} and every key starting with "_",
 *     recursively drop "_"-prefixed keys anywhere;
 *   - sort every object's keys ascending by JS string order;
 *   - integers and integer-valued strings become their canonical decimal string; booleans and other
 *     strings pass through unchanged;
 *   - digest = keccak256(utf8(JSON.stringify(canonical)))   [JSON.stringify default: no whitespace].
 * `DIGEST_ONLY=1` prints the canonical JSON and the digest and exits, so you can paste it into the
 * declareExperiment note from the OWNER key before any launch.
 *
 * ------------------------------------------------------------------------------------------------------
 * RESUME. A failure at replicate 5 of a pre-registered n=8 must not permanently block the design. Salts
 * are deterministic in (armId, replicate, name, symbol, decimals, totalSupply, pad), so the predicted
 * token address is an exact resume key: launchOfToken(token) != 0 means that cell is already done and is
 * skipped. The skip is then VERIFIED against the Launched log (armId + replicate must match), so a
 * salt-block collision can never be mistaken for a completed cell.
 *
 * ------------------------------------------------------------------------------------------------------
 * Usage:
 *   PAD=0x.. ARM=scripts/arm-quote-seeded.json npx hardhat run scripts/run-arm.js --network robinhood
 *   DIGEST_ONLY=1 ARM=..                    print the canonical spec + digest, touch no network
 *   DRY_RUN=1                               run every gate, send nothing
 *   MIN_GAP_MS=250                          floor for the randomised inter-cell gap
 *   STATIC_CALL_GAS=8000000                 explicit gas for the staticCall if the proxy caps eth_call
 *   DECLARED_FROM_BLOCK=123                 override the declaration scan floor (rehearsals)
 *   PROGRESS=path.json                      where the per-run progress record is written
 *
 * For the FULL 16-cell interleaved experiment use scripts/run-experiment.js, which imports this file's
 * cell loop verbatim and only changes the order it iterates. run-arm.js stays the single-arm rehearsal.
 *
 * arm.json shape (units are the contract's — see IUniswapV3Minimal.sol / LaunchParams NatSpec):
 * {
 *   "experiment": "seed-quote-sweep",          // hashed with keccak256(utf8) into experimentId
 *   "arm": "quote=1e18 (treatment)",           // hashed into armId; also picks the salt block
 *   "replicates": 8,                           // <= 15 (see SALT LAYOUT below)
 *   "declaredTx": "0x..",                      // preferred: the declareExperiment tx hash. one RPC call.
 *   "declaredFromBlock": 36700000,             // fallback scan floor. NEVER 0. omit to use deployBlock.
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
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const PadTokenArtifact = require("../artifacts/contracts/pads/PadToken.sol/PadToken.json");

const MIN_GAP_MS = Number(process.env.MIN_GAP_MS || 250); // >= 200ms, the stated budget floor
const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 };
const abi = ethers.AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SALT LAYOUT. Each arm owns a 2**24-wide block of the salt space, chosen by armId; each replicate owns a
// 2**20-wide slot inside it; the miner searches at most 500k salts from its slot's start. So the highest
// salt a replicate can touch is r*2**20 + 500000, which must stay inside the arm's block:
//   15 * 2**20 + 500000 = 16,228,640  <  16,777,216 = 2**24        -> replicates <= 15.
// Worst case armOffset 1023*2**24 + 16,228,640 ~= 1.72e10, far under 2**53, so plain JS numbers are exact.
const ARM_BLOCK = 2 ** 24;
const REPLICATE_BLOCK = 2 ** 20;
const SEARCH_WINDOW = 500000;
const MAX_REPLICATES = 15;

/** Keys that describe HOW to look the declaration up, not WHAT is being run. Excluded from the digest —
 *  declaredTx cannot be inside a digest that has to be written into that very transaction. */
const DIGEST_IGNORED_TOP_LEVEL = new Set(["declaredFromBlock", "declaredTx"]);

function recip(v) {
  if (typeof v === "number") return v;
  const k = String(v || "OPERATOR").toUpperCase();
  if (!(k in Recipient)) throw new Error(`unknown recipient level ${v} (OPERATOR | VAULT | BURN)`);
  return Recipient[k];
}

// ------------------------------------------------------------------------------------------------------
// Canonicalisation + digest (E7). Deliberately trivial so a reader can reimplement it and check the note.
// ------------------------------------------------------------------------------------------------------

function canonicalValue(v) {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`non-integer number ${v} in the arm spec — every numeric field is an exact integer`);
    return String(v);
  }
  if (typeof v === "string") return /^-?(0|[1-9][0-9]*)$/.test(v) ? BigInt(v).toString() : v;
  if (Array.isArray(v)) return v.map(canonicalValue);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (k.startsWith("_")) continue;
      out[k] = canonicalValue(v[k]);
    }
    return out;
  }
  throw new Error(`unsupported ${typeof v} in the arm spec — canonicalisation must stay total`);
}

function canonicalSpec(spec) {
  const out = {};
  for (const k of Object.keys(spec).sort()) {
    if (k.startsWith("_") || DIGEST_IGNORED_TOP_LEVEL.has(k)) continue;
    out[k] = canonicalValue(spec[k]);
  }
  return out;
}

function specDigest(spec) {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonicalSpec(spec))));
}

// ------------------------------------------------------------------------------------------------------
// Salt mining
// ------------------------------------------------------------------------------------------------------

/** The arm's block of the salt space. Folding armId in HERE is what lets both arms ship identical text. */
function armOffset(armId) {
  return Number(BigInt(armId) % 1024n) * ARM_BLOCK;
}

function saltStart(armId, replicate) {
  if (!Number.isInteger(replicate) || replicate < 1 || replicate > MAX_REPLICATES) {
    throw new Error(`replicate ${replicate} out of range — the salt layout supports 1..${MAX_REPLICATES}`);
  }
  return armOffset(armId) + replicate * REPLICATE_BLOCK;
}

/** Pure-JS CREATE2 mining. The sort side is an experimental variable; discovering it must cost no RPC. */
function mineSalt(pad, cfg, weth, wantToken0, startAt = 0) {
  const args = abi.encode(
    ["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad],
  );
  const h = ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
  const w = BigInt(weth);
  // Half of all salts satisfy either sort side, so this terminates in ~2 tries.
  for (let i = startAt; i < startAt + SEARCH_WINDOW; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token, tries: i - startAt + 1 };
  }
  throw new Error(`no salt found in ${SEARCH_WINDOW} attempts — check the token config`);
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

// ------------------------------------------------------------------------------------------------------
// Revert decoding. A custom error printed as "execution reverted" costs an hour; printed by name, a second.
// ------------------------------------------------------------------------------------------------------

function revertData(e) {
  for (const d of [e?.data, e?.error?.data, e?.info?.error?.data, e?.error?.error?.data]) {
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) return d;
    if (d && typeof d.data === "string" && d.data.startsWith("0x")) return d.data;
  }
  return null;
}

function decodeRevert(iface, e) {
  const data = revertData(e);
  if (data) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return `${parsed.name}(${parsed.args.map((a) => String(a)).join(", ")})`;
    } catch {
      /* fall through to the plain message */
    }
  }
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

function looksLikeFunding(e) {
  const s = `${e?.code || ""} ${e?.shortMessage || ""} ${e?.message || ""}`.toLowerCase();
  return s.includes("insufficient funds") || s.includes("insufficient_funds");
}

// ------------------------------------------------------------------------------------------------------
// Declaration lookup (E6). Prefer an exact tx reference; fall back to a BOUNDED, chunked scan. Never 0.
// ------------------------------------------------------------------------------------------------------

function deploymentRecordPath(chainId) {
  return path.join(__dirname, `deployment-${chainId}.json`);
}

function readDeployBlock(chainId) {
  const p = deploymentRecordPath(chainId);
  if (!fs.existsSync(p)) {
    throw new Error(
      `no declaration scan floor. ${p} does not exist, and this arm sets neither declaredTx nor ` +
        "declaredFromBlock.\nA block-0-to-latest getLogs is exactly what a range-capped paid proxy " +
        "refuses, which would make the pre-registration gate fail CLOSED on a correctly declared " +
        "experiment. Set declaredTx (best), or declaredFromBlock, or restore the deployment record.",
    );
  }
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  const b = Number(rec.deployBlock);
  if (!Number.isInteger(b) || b <= 0) {
    throw new Error(`${p} has no usable deployBlock (${rec.deployBlock}) — refusing to default to 0`);
  }
  return b;
}

function resolveFromBlock(spec, chainId) {
  const override = process.env.DECLARED_FROM_BLOCK;
  if (override !== undefined && override.trim() !== "") {
    const b = Number(override);
    if (!Number.isInteger(b) || b < 0) throw new Error(`DECLARED_FROM_BLOCK must be a block number, got "${override}"`);
    return b;
  }
  if (spec.declaredFromBlock !== undefined && spec.declaredFromBlock !== null) {
    const b = Number(spec.declaredFromBlock);
    if (!Number.isInteger(b) || b < 0) throw new Error(`declaredFromBlock must be a block number, got ${spec.declaredFromBlock}`);
    if (b === 0) {
      throw new Error(
        "declaredFromBlock:0 asks for every log from genesis. A range-capped or rate-limited RPC answers " +
          "that with an error and the pre-registration gate then fails CLOSED on a correctly declared " +
          "experiment. Set declaredTx (one call, and it is the artefact you would cite anyway), or a real " +
          "floor, or delete the field to use the pad's deploy block.",
      );
    }
    return b;
  }
  return readDeployBlock(chainId);
}

/** Returns { blockNumber, notes: string[], source } for the EARLIEST declaration found. */
async function findDeclaration(pad, padAddr, spec, experimentId, chainId) {
  const provider = pad.runner.provider ?? ethers.provider;
  const topic0 = pad.interface.getEvent("ExperimentDeclared").topicHash;

  if (spec.declaredTx) {
    const rc = await provider.getTransactionReceipt(spec.declaredTx);
    if (!rc) throw new Error(`declaredTx ${spec.declaredTx} has no receipt on this network`);
    // BOTH conditions matter: a receipt from some other pad, or for some other experimentId, would
    // otherwise satisfy the gate — strictly worse than the scan it replaces.
    const hits = rc.logs.filter(
      (l) =>
        l.address.toLowerCase() === padAddr.toLowerCase() &&
        l.topics[0] === topic0 &&
        l.topics[1] === experimentId,
    );
    if (hits.length === 0) {
      throw new Error(
        `declaredTx ${spec.declaredTx} carries no ExperimentDeclared log for experimentId ${experimentId} ` +
          `emitted by ${padAddr}. Wrong tx, wrong pad, or wrong experiment string.`,
      );
    }
    const notes = hits.map((l) => pad.interface.parseLog({ topics: [...l.topics], data: l.data }).args.note);
    return { blockNumber: rc.blockNumber, notes, source: `tx ${spec.declaredTx}` };
  }

  const fromBlock = resolveFromBlock(spec, chainId);
  const latest = await provider.getBlockNumber();
  const filter = pad.filters.ExperimentDeclared(experimentId);
  let logs;
  try {
    logs = await pad.queryFilter(filter, fromBlock, latest);
  } catch (e) {
    // Range cap. Chunk rather than give up — but say so, because the fix is declaredTx.
    const span = Number(process.env.LOG_CHUNK || 10000);
    console.warn(`  wide getLogs refused (${e.shortMessage || e.message}); chunking ${span} blocks at a time`);
    logs = [];
    for (let from = fromBlock; from <= latest && logs.length === 0; from += span) {
      const to = Math.min(from + span - 1, latest);
      logs = logs.concat(await pad.queryFilter(filter, from, to));
    }
  }
  if (logs.length === 0) return null;
  logs.sort((a, b) => a.blockNumber - b.blockNumber);
  return {
    blockNumber: logs[0].blockNumber,
    notes: logs.map((l) => l.args.note),
    source: `scan [${fromBlock}, ${latest}]`,
  };
}

// ------------------------------------------------------------------------------------------------------
// Progress record
// ------------------------------------------------------------------------------------------------------

function makeProgress(file, header) {
  const state = { ...header, cells: [] };
  if (fs.existsSync(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(prev.cells)) state.cells = prev.cells;
    } catch {
      /* a corrupt record must not block the run; on-chain launchOfToken is the source of truth */
    }
  }
  return {
    file,
    state,
    record(entry) {
      state.cells = state.cells.filter((c) => !(c.arm === entry.arm && c.replicate === entry.replicate));
      state.cells.push(entry);
      state.cells.sort((a, b) => (a.arm === b.arm ? a.replicate - b.replicate : String(a.arm).localeCompare(String(b.arm))));
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    },
  };
}

// ------------------------------------------------------------------------------------------------------
// One cell. run-experiment.js reuses this verbatim and changes only the ORDER it is called in.
// ------------------------------------------------------------------------------------------------------

/**
 * @param ctx {{ pad, padAddr, provider, weth, spec, experimentId, armId, dry, declBlock, progress, fromBlock }}
 */
async function runCell(ctx, r) {
  const { pad, padAddr, provider, weth, spec, experimentId, armId, dry } = ctx;
  const label = `[${spec.arm}] r${r}`;

  // Deadline is recomputed PER CELL. One deadline for a whole interleaved run can expire mid-run and
  // surface as a confusing Expired revert after several cells have already landed.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const p = buildParams(spec.cell, experimentId, armId, r, deadline);
  const mined = mineSalt(padAddr, p, weth, p.wantTokenIsToken0, saltStart(armId, r));
  p.tokenSalt = mined.salt;

  // ---- (1) RESUME. Check BEFORE the staticCall: an already-launched cell must skip, not abort the run.
  const existing = await pad.launchOfToken(mined.token);
  if (existing !== 0n) {
    await assertSkipBelongsToThisCell(ctx, mined.token, r, existing);
    console.log(`${label}: already launched as id ${existing} (token ${mined.token}) — skipping`);
    ctx.progress?.record({ arm: spec.arm, armId, replicate: r, token: mined.token, launchId: String(existing), status: "pre-existing" });
    return { status: "skipped", token: mined.token, launchId: existing };
  }

  // ---- (2) DIAGNOSTIC. previewLaunch is READABLE where launch is merely rejected — keep it for the
  //          achieved amounts. It is NOT the gate.
  const pv = await pad.previewLaunch(p);
  console.log(`${label}: token ${pv.predictedToken} (salt tries ${mined.tries}, start ${saltStart(armId, r)})`);
  console.log(`  pool ${pv.predictedPool}  tokenIsToken0 ${pv.tokenIsToken0}  spacing ${pv.tickSpacing}`);
  console.log(`  liquidity ${pv.liquidity}  amount0 ${pv.amount0Achieved}  amount1 ${pv.amount1Achieved}`);

  // ---- (3) ASSERT the printed values instead of merely printing them. mineSalt derives the token from the
  //          LOCAL artifact bytecode; previewLaunch derives it from type(PadToken).creationCode compiled
  //          into the DEPLOYED pad. Those agree only if artifacts/ is in sync with what is on-chain.
  if (pv.predictedToken.toLowerCase() !== mined.token.toLowerCase()) {
    throw new Error(
      `${label}: predicted token disagrees with the mined salt.\n` +
        `  pad says   ${pv.predictedToken}\n  miner says ${mined.token}\n` +
        "artifacts/contracts/pads/PadToken.sol/PadToken.json is stale or predates the deployed pad. " +
        "Run `npx hardhat compile` against the SAME source the pad was deployed from. Sending now would " +
        "die on TokenAddressMismatch or SortSideMismatch with no hint of the cause.",
    );
  }
  if (pv.tokenIsToken0 !== p.wantTokenIsToken0) {
    throw new Error(
      `${label}: sort side disagrees — pad says tokenIsToken0=${pv.tokenIsToken0}, the cell wants ` +
        `${p.wantTokenIsToken0}. The launch would revert SortSideMismatch.`,
    );
  }
  if (pv.liquidity === 0n) {
    throw new Error(
      `${label}: previewLaunch reports zero liquidity — this cell is degenerate. The achieved amounts ` +
        "above name what each side would have to be for this range at this opening tick.",
    );
  }

  // ---- (4) THE SEND GATE. Everything previewLaunch does not check.
  const value = p.seedQuoteWei + p.devBuyQuoteWei;
  const overrides = { value };
  if (process.env.STATIC_CALL_GAS) overrides.gasLimit = BigInt(process.env.STATIC_CALL_GAS);
  try {
    await pad.launch.staticCall(p, overrides);
  } catch (e) {
    const decoded = decodeRevert(pad.interface, e);
    if (decoded.startsWith("AlreadyLaunched")) {
      // Raced with something else between (1) and (4). Treat as done rather than aborting the arm.
      console.log(`${label}: AlreadyLaunched at the gate — treating as complete and skipping`);
      return { status: "skipped", token: mined.token, launchId: await pad.launchOfToken(mined.token) };
    }
    if (looksLikeFunding(e)) {
      throw new Error(
        `${label}: the simulated launch cannot be paid for — FUND THE OPERATOR ${await resolveSender(ctx)}.\n` +
          `  needs at least ${ethers.formatEther(value)} native plus gas. This is NOT a geometry problem; ` +
          "the cell itself passed every parameter check above.\n  " + decoded,
      );
    }
    throw new Error(
      `${label}: launch.staticCall reverted — NOTHING WAS SENT.\n  ${decoded}\n` +
        "previewLaunch above is not a gate: it returns numbers where launch reverts (see its NatSpec). " +
        "If this is an eth_call gas cap rather than a real revert, set STATIC_CALL_GAS.",
    );
  }

  if (dry) {
    console.log(`${label}: gate PASSED (dry run — nothing sent)\n`);
    return { status: "dry", token: mined.token };
  }

  // ---- (5) SEND.
  const tx = await pad.launch(p, { value });
  const rc = await tx.wait();

  // A send that succeeded but whose receipt cannot be parsed is STILL a completed launch. Throwing a raw
  // TypeError here is the one shape that makes a naive resume double-send.
  let launchId = null;
  let seeded = null;
  try {
    const topic0 = pad.interface.getEvent("Launched").topicHash;
    const log = rc.logs.find((l) => l.address.toLowerCase() === padAddr.toLowerCase() && l.topics[0] === topic0);
    if (log) {
      const rec = pad.interface.parseLog({ topics: [...log.topics], data: log.data });
      launchId = String(rec.args.launchId);
      seeded = `${rec.args.record.seedAmount0} / ${rec.args.record.seedAmount1}`;
    }
  } catch (e) {
    console.warn(`  WARNING: receipt parse failed (${e.message}). The launch LANDED in ${rc.hash}.`);
  }
  if (launchId === null) {
    console.warn(
      `  WARNING: no readable Launched log in ${rc.hash} — the tx SUCCEEDED, so this cell is COMPLETE. ` +
        "Do not re-run it blind; launchOfToken will confirm on the next pass.",
    );
  }

  // Block order IS the pre-registration evidence. Assert it rather than assume it.
  if (ctx.declBlock !== undefined && rc.blockNumber <= ctx.declBlock) {
    throw new Error(
      `${label}: launch landed in block ${rc.blockNumber} but the declaration is block ${ctx.declBlock}. ` +
        "The hypothesis must precede the data. Stop and document this.",
    );
  }

  console.log(
    `  launched id ${launchId ?? "?"} in ${rc.hash} (block ${rc.blockNumber})` +
      (seeded ? `\n  seed achieved ${seeded}` : "") + "\n",
  );
  ctx.progress?.record({
    arm: spec.arm,
    armId,
    replicate: r,
    token: mined.token,
    launchId,
    tx: rc.hash,
    block: rc.blockNumber,
    status: "launched",
    at: new Date().toISOString(),
  });
  return { status: "launched", token: mined.token, launchId, tx: rc.hash, block: rc.blockNumber };
}

async function resolveSender(ctx) {
  try {
    return await ctx.pad.runner.getAddress();
  } catch {
    return "the operator key";
  }
}

/**
 * A skip must be EXACT, not heuristic. armOffset is armId mod 1024, so two arms CAN in principle land in
 * the same salt block; without this check the second arm would silently "resume" over the first arm's
 * launches and record eight cells it never ran. One filtered getLogs, only on the skip path.
 */
async function assertSkipBelongsToThisCell(ctx, token, r, launchId) {
  const { pad, spec, armId, experimentId } = ctx;
  const from = ctx.fromBlock ?? 0;
  let logs = [];
  try {
    logs = await pad.queryFilter(pad.filters.Launched(null, token), from, "latest");
  } catch (e) {
    throw new Error(
      `cannot verify the skip of replicate ${r} (launchId ${launchId}, token ${token}): ${e.shortMessage || e.message}\n` +
        "Refusing to assume it belongs to this arm — an unverified skip silently fabricates a data point.",
    );
  }
  if (logs.length === 0) {
    throw new Error(
      `launchOfToken says ${token} is launch ${launchId}, but no Launched log for it was found from block ` +
        `${from}. Widen the search (declaredFromBlock / DECLARED_FROM_BLOCK) before trusting the skip.`,
    );
  }
  const rec = logs[logs.length - 1].args.record;
  if (rec.armId !== armId || rec.experimentId !== experimentId || Number(rec.replicate) !== r) {
    throw new Error(
      `SALT BLOCK COLLISION. Token ${token} for [${spec.arm}] r${r} was already launched, but by\n` +
        `  experimentId ${rec.experimentId}\n  armId        ${rec.armId} (replicate ${rec.replicate})\n` +
        `expected\n  experimentId ${experimentId}\n  armId        ${armId} (replicate ${r})\n` +
        "Two arms hashed into the same 2**24 salt block (armId mod 1024). Rename one arm string and " +
        "re-derive; do NOT skip this cell.",
    );
  }
}

// ------------------------------------------------------------------------------------------------------
// Shared setup, used by both run-arm.js and run-experiment.js
// ------------------------------------------------------------------------------------------------------

function loadSpec(armFile) {
  const spec = JSON.parse(fs.readFileSync(path.resolve(armFile), "utf8"));
  if (!spec.experiment || !spec.arm) throw new Error(`${armFile}: "experiment" and "arm" are required`);
  const replicates = Number(spec.replicates || 1);
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > MAX_REPLICATES) {
    throw new Error(`${armFile}: replicates must be 1..${MAX_REPLICATES} (the salt layout's slot width)`);
  }
  for (const k of ["name", "symbol", "totalSupply", "seedTokenAmount", "fee"]) {
    if (spec.cell?.[k] === undefined) throw new Error(`${armFile}: cell.${k} is required`);
  }
  return { spec, replicates, experimentId: ethers.id(spec.experiment), armId: ethers.id(spec.arm), digest: specDigest(spec) };
}

/** Throws unless a declaration exists AND its note commits to `digest`. In DRY_RUN the digest half warns. */
async function assertPreRegistered(pad, padAddr, spec, experimentId, digest, chainId, dry) {
  const decl = await findDeclaration(pad, padAddr, spec, experimentId, chainId);
  if (!decl) {
    throw new Error(
      `experimentId ${experimentId} ("${spec.experiment}") has never been declared on ${padAddr}.\n` +
        "Call declareExperiment(id, note) from the OWNER key FIRST, in its own transaction — a hypothesis " +
        "registered after the fact is not a hypothesis.",
    );
  }
  const committed = decl.notes.some((n) => String(n).toLowerCase().includes(digest.toLowerCase()));
  const msg =
    `the declaration at block ${decl.blockNumber} does not commit to this spec.\n` +
    `  spec digest : ${digest}\n` +
    `  note(s)     : ${decl.notes.map((n) => JSON.stringify(String(n))).join(", ")}\n` +
    "Only a bytes32 label is committed on-chain, so armId and every cell parameter stay post-hoc mutable; " +
    "the digest in the note is what ties the declaration block to the parameters actually run. Re-declare " +
    "with the digest in the note (DIGEST_ONLY=1 prints it), or fix the arm file back to what was declared.";
  if (!committed) {
    if (!dry) throw new Error(msg);
    console.warn(`\nWOULD REFUSE TO LAUNCH: ${msg}\n(dry run — continuing, nothing is sent)\n`);
  }
  console.log(`experiment "${spec.experiment}" declared at block ${decl.blockNumber} (${decl.source})`);
  console.log(`  spec digest ${digest}${committed ? " — committed in the note" : " — NOT COMMITTED"}`);
  return decl;
}

// ------------------------------------------------------------------------------------------------------

async function main() {
  const armFile = process.env.ARM;
  if (!armFile) throw new Error("ARM must point at an arm JSON file");
  const { spec, replicates, experimentId, armId, digest } = loadSpec(armFile);

  // Offline, network-free: what to paste into declareExperiment's note.
  if (process.env.DIGEST_ONLY === "1") {
    console.log(JSON.stringify(canonicalSpec(spec)));
    console.log(digest);
    return;
  }

  const padAddr = process.env.PAD;
  if (!padAddr || !ethers.isAddress(padAddr)) throw new Error("PAD must be the deployed RektPad address");
  const dry = process.env.DRY_RUN === "1";

  const [signer] = await ethers.getSigners();
  const pad = await ethers.getContractAt("RektPad", padAddr, signer);
  const provider = ethers.provider;
  const weth = await pad.WETH();
  const { chainId } = await provider.getNetwork();

  const decl = await assertPreRegistered(pad, padAddr, spec, experimentId, digest, chainId, dry);
  console.log(
    `arm "${spec.arm}" x${replicates} on ${network.name} (chain ${chainId}) as ${signer.address}` +
      `${dry ? " (DRY RUN)" : ""}`,
  );
  console.log(`  salt block ${armOffset(armId)}  token text "${spec.cell.name}" / "${spec.cell.symbol}"\n`);

  const progressFile =
    process.env.PROGRESS || path.join(__dirname, `progress-${chainId}-${experimentId.slice(2, 10)}.json`);
  const progress = makeProgress(progressFile, {
    chainId: Number(chainId),
    pad: padAddr,
    experiment: spec.experiment,
    experimentId,
    specDigest: digest,
    declarationBlock: decl.blockNumber,
  });

  const ctx = {
    pad, padAddr, provider, weth, spec, experimentId, armId, dry,
    declBlock: decl.blockNumber, progress, fromBlock: decl.blockNumber,
  };

  for (let r = 1; r <= replicates; r++) {
    await runCell(ctx, r);
    // Strictly one in flight, with a RANDOMISED gap >= the floor. Two collectors are already on this
    // endpoint, and a metronomic 250ms cadence is itself a fingerprint.
    await sleep(MIN_GAP_MS + Math.floor(Math.random() * MIN_GAP_MS));
  }
  console.log(`progress record: ${progressFile}`);
  console.log("\nDone. Run scripts/join-launches.cjs before the NEXT arm, not after the twentieth.");
}

module.exports = {
  ARM_BLOCK, REPLICATE_BLOCK, MAX_REPLICATES, MIN_GAP_MS,
  canonicalSpec, specDigest, armOffset, saltStart, mineSalt, buildParams,
  loadSpec, findDeclaration, assertPreRegistered, makeProgress, runCell,
  decodeRevert, sleep,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  });
}

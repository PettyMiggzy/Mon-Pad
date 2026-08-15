#!/usr/bin/env node
/*
 * Run a WHOLE experiment — every arm, INTERLEAVED — through AtomicExperimentPad.
 *
 * ------------------------------------------------------------------------------------------------------
 * WHY INTERLEAVE. Not for anonymity: the pad address, the operator EOA and LP_VAULT are constant across
 * arms, so any bot that fingerprints one of them sees the entire experiment from launch 1 regardless of
 * ordering, and the contract's own header already accepts that (arm boundaries fall on contract
 * boundaries). Interleaving buys protection against ADAPTATION, which is the dominant threat here.
 *
 * The most likely single failure mode for a 16-launch run from one pad is a sniper fleet that takes the
 * first launch or two and then blacklists the pad or the operator. Under BLOCKED ordering (all of arm A,
 * then all of arm B) that decay is PERFECTLY confounded with arm: arm 1 gets the fresh-pad attention,
 * arm 2 gets a blacklisted pad, and the result is a large, clean, entirely artefactual effect in
 * whichever direction arm 1 happened to run — indistinguishable from the real signal being sought.
 * Under alternating ordering the same decay hits both arms roughly equally: it degrades power instead of
 * manufacturing an effect, and becomes a testable launch-index trend. Time-window confounding (fleet
 * uptime, gas regime, hour of day) is a real but secondary bonus.
 *
 * ------------------------------------------------------------------------------------------------------
 * THE ORDER IS PRE-COMMITTED. The full sequence is built UP FRONT from a NAMED SEED, printed, and hashed;
 * that hash must appear in the ExperimentDeclared note before the first launch, or this script refuses to
 * send. A randomised order generated inside the run is not pre-registration — it is a decision made after
 * seeing the chain. Generate and publish the sequence FIRST:
 *
 *   SEQUENCE_ONLY=1 SEED="<name it>" ARMS=scripts/arm-quote-seeded.json,scripts/arm-quote-zero.json \
 *     npx hardhat run scripts/run-experiment.js
 *
 * then declareExperiment(keccak256("seed-quote-sweep"), "<the printed digest>") from the OWNER key, then:
 *
 *   PAD=0x.. SEED="<same>" ARMS=.. npx hardhat run scripts/run-experiment.js --network robinhood
 *
 * E3's resume is a HARD PREREQUISITE of interleaving, not an optional companion: a failure partway now
 * leaves BOTH arms partially complete. Re-running is safe — every completed cell is skipped by its
 * on-chain launchOfToken, verified against the Launched log.
 *
 * ------------------------------------------------------------------------------------------------------
 * Every cell goes through scripts/run-arm.js's runCell VERBATIM. This file changes only the sequence it
 * iterates; nothing about a single launch differs between a single-arm rehearsal and the real run.
 *
 * Env:
 *   ARMS       comma-separated arm JSON paths (default: the two shipped seed-quote arms)
 *   SEED       REQUIRED. The named seed for the within-pair order. Publish it with the sequence.
 *   PAD        deployed AtomicExperimentPad
 *   DRY_RUN=1  run every gate for every cell, send nothing
 *   SEQUENCE_ONLY=1  print the sequence + digest and exit; touches no network
 *   MIN_GAP_MS, STATIC_CALL_GAS, DECLARED_FROM_BLOCK, PROGRESS — as run-arm.js
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const {
  MIN_GAP_MS, canonicalSpec, armOffset, loadSpec, findDeclaration, makeProgress, runCell, sleep,
} = require("./run-arm.js");

const DEFAULT_ARMS = ["scripts/arm-quote-seeded.json", "scripts/arm-quote-zero.json"];

/** Deterministic byte stream from a named seed. keccak chained, so it is reimplementable anywhere. */
function byteStream(seed) {
  let h = ethers.keccak256(ethers.toUtf8Bytes(String(seed)));
  let i = 0;
  return () => {
    if (i === 32) {
      h = ethers.keccak256(h);
      i = 0;
    }
    const b = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
    i += 1;
    return b;
  };
}

/** Fisher-Yates with rejection sampling — a plain `% n` would bias the order, and the order is evidence. */
function shuffle(arr, nextByte) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const bound = i + 1;
    const limit = 256 - (256 % bound);
    let x;
    do {
      x = nextByte();
    } while (x >= limit);
    const j = x % bound;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One block per replicate index: all arms appear exactly once, in a seeded order. With two arms that is
 * strict alternation with a coin-flip on which side leads each pair.
 */
function buildSequence(arms, replicates, seed) {
  const next = byteStream(seed);
  const seq = [];
  for (let r = 1; r <= replicates; r++) {
    for (const idx of shuffle(arms.map((_, i) => i), next)) seq.push({ armIndex: idx, replicate: r });
  }
  return seq;
}

function sequenceCommitment(arms, seq, seed) {
  const canonical = {
    seed: String(seed),
    experiment: arms[0].spec.experiment,
    arms: arms.map((a) => ({ arm: a.spec.arm, digest: a.digest, spec: canonicalSpec(a.spec) })),
    sequence: seq.map((c) => [arms[c.armIndex].spec.arm, String(c.replicate)]),
  };
  const json = JSON.stringify(canonical);
  return { json, digest: ethers.keccak256(ethers.toUtf8Bytes(json)) };
}

/** E1's enforcement point. If two arms differ in the text a scanner reads, the symbol encodes the arm. */
function assertNoTextConfound(arms) {
  const [ref] = arms;
  for (const a of arms.slice(1)) {
    for (const k of ["name", "symbol", "decimals", "totalSupply"]) {
      if (String(a.spec.cell[k]) !== String(ref.spec.cell[k])) {
        throw new Error(
          `TEXT CONFOUND: "${a.spec.arm}" has cell.${k} = ${JSON.stringify(a.spec.cell[k])} but ` +
            `"${ref.spec.arm}" has ${JSON.stringify(ref.spec.cell[k])}.\n` +
            "name/symbol/decimals/totalSupply are what a human, a scanner and a sniper bot READ — if they " +
            "differ across arms the token itself announces its treatment assignment and every observation " +
            "is confounded. Distinctness of the deployed addresses comes from the armId salt block, not " +
            "from the text. Make them byte-identical.",
        );
      }
    }
  }
  const offsets = new Map();
  for (const a of arms) {
    const off = armOffset(a.armId);
    if (offsets.has(off)) {
      throw new Error(
        `SALT BLOCK COLLISION: "${a.spec.arm}" and "${offsets.get(off)}" both hash to salt block ${off} ` +
          "(armId mod 1024). They would mine identical token addresses and the second arm would be " +
          "rejected as AlreadyLaunched. Rename one arm string.",
      );
    }
    offsets.set(off, a.spec.arm);
  }
}

async function main() {
  const armFiles = (process.env.ARMS || DEFAULT_ARMS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  if (armFiles.length < 2) throw new Error("ARMS must name at least two arm files — one arm needs run-arm.js, not this");
  const seed = process.env.SEED;
  if (!seed) {
    throw new Error(
      "SEED is required and must be NAMED and PUBLISHED with the sequence. An unnamed or unpublished seed " +
        "makes the committed order unverifiable, which is the whole point of committing it.",
    );
  }

  const arms = armFiles.map((f) => ({ file: f, ...loadSpec(f) }));
  const experiment = arms[0].spec.experiment;
  for (const a of arms) {
    if (a.spec.experiment !== experiment) {
      throw new Error(`${a.file}: experiment "${a.spec.experiment}" != "${experiment}" — one run, one experimentId`);
    }
    if (a.replicates !== arms[0].replicates) {
      throw new Error(`${a.file}: replicates ${a.replicates} != ${arms[0].replicates} — interleaving needs equal n`);
    }
  }
  assertNoTextConfound(arms);

  const replicates = arms[0].replicates;
  const seq = buildSequence(arms, replicates, seed);
  const commit = sequenceCommitment(arms, seq, seed);

  console.log(`experiment "${experiment}"  ${arms.length} arms x ${replicates} = ${seq.length} cells`);
  console.log(`  token text  "${arms[0].spec.cell.name}" / "${arms[0].spec.cell.symbol}" (identical in every arm)`);
  for (const a of arms) console.log(`  arm "${a.spec.arm}"  salt block ${armOffset(a.armId)}  digest ${a.digest}`);
  console.log("\nPRE-COMMITTED SEQUENCE:");
  seq.forEach((c, i) => console.log(`  ${String(i + 1).padStart(3)}. ${arms[c.armIndex].spec.arm}  r${c.replicate}`));
  console.log(`\nsequence digest ${commit.digest}`);

  if (process.env.SEQUENCE_ONLY === "1") {
    const out = path.join(__dirname, `sequence-${ethers.id(experiment).slice(2, 10)}.json`);
    fs.writeFileSync(out, `${commit.json}\n`);
    console.log(`canonical sequence written to ${out} — publish it alongside the arm files.`);
    return;
  }

  const padAddr = process.env.PAD;
  if (!padAddr || !ethers.isAddress(padAddr)) throw new Error("PAD must be the deployed AtomicExperimentPad address");
  const dry = process.env.DRY_RUN === "1";

  const [signer] = await ethers.getSigners();
  const pad = await ethers.getContractAt("AtomicExperimentPad", padAddr, signer);
  const provider = ethers.provider;
  const weth = await pad.WETH();
  const { chainId } = await provider.getNetwork();
  const experimentId = arms[0].experimentId;

  // The declaration lookup fields must agree across arms — they describe one declaration.
  const lookup = { declaredTx: arms[0].spec.declaredTx, declaredFromBlock: arms[0].spec.declaredFromBlock };
  for (const a of arms.slice(1)) {
    if ((a.spec.declaredTx || null) !== (lookup.declaredTx || null)) {
      throw new Error(`${a.file}: declaredTx disagrees with ${arms[0].file} — there is one declaration, not two`);
    }
  }

  const decl = await findDeclaration(pad, padAddr, lookup, experimentId, chainId);
  if (!decl) {
    throw new Error(
      `experimentId ${experimentId} ("${experiment}") has never been declared on ${padAddr}.\n` +
        "Call declareExperiment(id, note) from the OWNER key FIRST, in its own transaction.",
    );
  }
  const committed = decl.notes.some((n) => String(n).toLowerCase().includes(commit.digest.toLowerCase()));
  if (!committed) {
    const msg =
      `the declaration at block ${decl.blockNumber} does not commit to this sequence.\n` +
      `  sequence digest : ${commit.digest}\n` +
      `  note(s)         : ${decl.notes.map((n) => JSON.stringify(String(n))).join(", ")}\n` +
      "The order must be fixed BEFORE the first launch or it is not pre-registration. Re-run with " +
      "SEQUENCE_ONLY=1, declare with the digest in the note, then run this again.";
    if (!dry) throw new Error(msg);
    console.warn(`\nWOULD REFUSE TO LAUNCH: ${msg}\n(dry run — continuing, nothing is sent)\n`);
  }
  console.log(`\ndeclared at block ${decl.blockNumber} (${decl.source})${committed ? " — sequence committed" : " — SEQUENCE NOT COMMITTED"}`);
  console.log(`running on ${network.name} (chain ${chainId}) as ${signer.address}${dry ? " (DRY RUN)" : ""}\n`);

  const progressFile =
    process.env.PROGRESS || path.join(__dirname, `progress-${chainId}-${experimentId.slice(2, 10)}.json`);
  const progress = makeProgress(progressFile, {
    chainId: Number(chainId),
    pad: padAddr,
    experiment,
    experimentId,
    seed: String(seed),
    sequenceDigest: commit.digest,
    declarationBlock: decl.blockNumber,
  });

  const ctxOf = arms.map((a) => ({
    pad, padAddr, provider, weth, dry, progress,
    spec: a.spec, experimentId: a.experimentId, armId: a.armId,
    declBlock: decl.blockNumber, fromBlock: decl.blockNumber,
  }));

  let launched = 0;
  let skipped = 0;
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i];
    console.log(`--- cell ${i + 1}/${seq.length} ---`);
    const res = await runCell(ctxOf[c.armIndex], c.replicate);
    if (res.status === "launched") launched += 1;
    if (res.status === "skipped") skipped += 1;
    if (i < seq.length - 1) await sleep(MIN_GAP_MS + Math.floor(Math.random() * MIN_GAP_MS));
  }

  console.log(`\n${launched} launched, ${skipped} already complete, ${seq.length} cells in the committed order.`);
  console.log(`progress record: ${progressFile}`);
  console.log("Run scripts/join-launches.cjs now, not after the twentieth launch.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  });
}

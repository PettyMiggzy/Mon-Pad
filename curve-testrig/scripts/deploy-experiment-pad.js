#!/usr/bin/env node
/*
 * Deploy AtomicExperimentPad.
 *
 * EVERY address comes from the environment with NO DEFAULT. A defaulted address on a research rig is how you
 * end up with the hot deploy key as the rescue recipient, or a pad pointed at the wrong one of the four V3
 * factories on this chain — both silent, both only discovered after the data is unusable.
 *
 * NEARLY EVERYTHING THIS SCRIPT PASSES IS AN IMMUTABLE. A wrong value does not fail here; it deploys cleanly
 * and bricks every launch afterwards, and the only fix is a redeploy with a broken arm boundary. So every
 * immutable is CROSS-CHECKED AGAINST THE LIVE VENUE BEFORE the deploy transaction is sent:
 *   - POOL_INIT_CODE_HASH is not length-checked and trusted, it is used to RE-DERIVE the address of a real
 *     on-chain pool (POOL_PROBE) and must reproduce it exactly;
 *   - the same probe proves FACTORY is the factory that actually minted this venue's pools;
 *   - POSITION_MANAGER.factory() and .WETH9() must equal FACTORY and WETH;
 *   - START_LAUNCH_ID is parsed strictly (an exported-but-empty env var used to silently mean 0, which
 *     collides head-on with the reference pad's ids 3..8 — the exact collision the immutable exists to
 *     prevent).
 *
 *   OWNER               root admin. Multisig or hardware. NEVER the key in PRIVATE_KEY.
 *   RESCUE_RECIPIENT    fixed sweep destination. Repointing it costs a 2-day timelock.
 *   LP_VAULT            the Recipient.VAULT level. May be 0x...dEaD, may not be zero.
 *   FACTORY             UniswapV3Factory. Robinhood Chain canonical: 0x1f7d7550b1b028f7571e69a784071f0205fd2efa
 *   POSITION_MANAGER    NonfungiblePositionManager: 0x73991a25c818bf1f1128deaab1492d45638de0d3
 *   WETH                quote token: 0x0bd7d308f8e1639fab988df18a8011f41eacad73
 *   EXPECTED_CHAIN_ID   asserted IN THE CONSTRUCTOR. 4663 for Robinhood Chain.
 *   START_LAUNCH_ID     offsets this pad's ids clear of the reference pad's 3..8. Default and suggested: 1000.
 *                       Below 1000 is refused unless START_LAUNCH_ID_OK=1 says you mean it.
 *   POOL_INIT_CODE_HASH 0xe34f199b... on the canonical factory; omit (or 0x00..) to fall back to
 *                       factory.getPool per launch, which is slower but unbreakable.
 *   POOL_PROBE          REQUIRED whenever POOL_INIT_CODE_HASH is set: any REAL pool minted by FACTORY, used
 *                       to prove the hash. Robinhood Chain: 0x479a1d0d9aec941382d9cab3ba69dd3914d981e9.
 *   CONFIRM_LIVE_DEPLOY when the target is a live-money chain (143, 4663) this must equal that chain id.
 *   OPERATORS           optional comma-separated hot keys to allowlist immediately.
 *
 * Writes scripts/deployment-<chainId>.json (pad address, deploy block, tx hash, every constructor argument).
 * run-arm.js anchors its ExperimentDeclared lookup on that deploy block instead of scanning from block 0, so
 * this file is a load-bearing artefact, not a convenience — do not delete it.
 *
 * Usage:
 *   OWNER=0x.. RESCUE_RECIPIENT=0x.. LP_VAULT=0x.. FACTORY=0x.. POSITION_MANAGER=0x.. WETH=0x.. \
 *   EXPECTED_CHAIN_ID=4663 CONFIRM_LIVE_DEPLOY=4663 START_LAUNCH_ID=1000 \
 *   POOL_INIT_CODE_HASH=0xe34f199b... POOL_PROBE=0x479a1d0d... \
 *     npx hardhat run scripts/deploy-experiment-pad.js --network robinhood
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

/**
 * Chains where a mistake costs real money. The pad's ACTUAL target (4663, Robinhood Chain) is one of them:
 * the previous version of this gate knew only about Monad (143) while promising testnet-only protection, so
 * the live target sailed through a check whose error text said it could not. A gate that overstates what it
 * does is worse than no gate — it buys false confidence at exactly the moment real money is committed.
 */
const LIVE_CHAINS = { 143: "Monad mainnet", 4663: "Robinhood Chain" };

/** Minimal ABIs, declared HERE rather than imported. These are pre-deploy probes of a live venue; they must
 *  not silently follow an edit to contracts/interfaces/IUniswapV3Minimal.sol. */
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];
const NPM_ABI = [
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
];
const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
  "function feeAmountTickSpacing(uint24) view returns (int24)",
];

function reqAddr(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set explicitly (no default is safe for an address)`);
  if (!ethers.isAddress(v)) throw new Error(`${name} is not an address: ${v}`);
  return ethers.getAddress(v);
}

/** Strict unsigned-integer env parse. `BigInt(process.env.X ?? default)` is NOT this: `??` does not fire on
 *  an exported-but-empty variable, and BigInt("") === BigInt("  ") === 0n. */
function reqUint(name, fallback) {
  const raw = process.env[name];
  const s = raw === undefined || raw === null ? "" : String(raw).trim();
  if (s === "") {
    if (fallback === undefined) throw new Error(`${name} must be set`);
    return fallback;
  }
  if (!/^[0-9]+$/.test(s)) throw new Error(`${name} must be a decimal integer, got ${JSON.stringify(raw)}`);
  return BigInt(s);
}

/** An address with no code is a typo that deploys cleanly and bricks every launch. */
async function requireCode(name, addr) {
  const code = await ethers.provider.getCode(addr);
  if (code === "0x") throw new Error(`${name} ${addr} has NO CODE on this chain — wrong address or wrong network`);
  return code;
}

/** create2 pool address, the same derivation the pad compiles in. */
function poolFor(factory, initHash, t0, t1, fee) {
  const salt = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24"], [t0, t1, fee]),
  );
  return ethers.getCreate2Address(ethers.getAddress(factory), salt, initHash);
}

/**
 * Proves POOL_INIT_CODE_HASH against the live venue, and as a side effect proves FACTORY is the factory that
 * minted this venue's pools. Reads token0/token1/fee off a REAL pool, then requires BOTH
 *   factory.getPool(t0,t1,fee) == probe        (the factory acknowledges this pool)
 *   create2(factory, keccak(t0,t1,fee), hash) == probe   (the hash reproduces it)
 */
async function verifyInitCodeHash(factory, initHash, probe) {
  await requireCode("POOL_PROBE", probe);
  const pool = new ethers.Contract(probe, POOL_ABI, ethers.provider);
  let t0, t1, fee;
  try {
    [t0, t1, fee] = await Promise.all([pool.token0(), pool.token1(), pool.fee()]);
  } catch (e) {
    throw new Error(`POOL_PROBE ${probe} does not answer token0()/token1()/fee() — it is not a V3 pool (${e.shortMessage || e.message})`);
  }
  const f = new ethers.Contract(factory, FACTORY_ABI, ethers.provider);
  const viaFactory = await f.getPool(t0, t1, Number(fee));
  if (viaFactory.toLowerCase() !== probe.toLowerCase()) {
    throw new Error(
      `FACTORY ${factory} does not know POOL_PROBE ${probe}: getPool(${t0}, ${t1}, ${fee}) == ${viaFactory}.\n` +
        "Either FACTORY is the wrong one of this chain's V3 factories, or POOL_PROBE was minted by a different one.",
    );
  }
  const derived = poolFor(factory, initHash, t0, t1, Number(fee));
  if (derived.toLowerCase() !== probe.toLowerCase()) {
    throw new Error(
      `POOL_INIT_CODE_HASH ${initHash} does not reproduce POOL_PROBE ${probe} (derived ${derived}).\n` +
        "This hash is an IMMUTABLE: deploying it would make every launch revert PoolAddressMismatch and cost a redeploy.\n" +
        "Either correct the hash, or omit POOL_INIT_CODE_HASH entirely to use the per-launch getPool fallback.",
    );
  }
  return { t0, t1, fee: Number(fee) };
}

/** FACTORY, POSITION_MANAGER and WETH are three independent immutables that must agree, on a chain with four
 *  live V3 factories. A mismatch bricks every launch with no recovery but a redeploy. */
async function verifyNpm(npmAddr, factory, weth) {
  const npm = new ethers.Contract(npmAddr, NPM_ABI, ethers.provider);
  let npmFactory, npmWeth;
  try {
    npmFactory = await npm.factory();
  } catch (e) {
    throw new Error(`POSITION_MANAGER ${npmAddr} does not answer factory() (${e.shortMessage || e.message})`);
  }
  try {
    npmWeth = await npm.WETH9();
  } catch (e) {
    throw new Error(`POSITION_MANAGER ${npmAddr} does not answer WETH9() (${e.shortMessage || e.message})`);
  }
  if (npmFactory.toLowerCase() !== factory.toLowerCase()) {
    throw new Error(`POSITION_MANAGER.factory() == ${npmFactory}, but FACTORY == ${factory}`);
  }
  if (npmWeth.toLowerCase() !== weth.toLowerCase()) {
    throw new Error(`POSITION_MANAGER.WETH9() == ${npmWeth}, but WETH == ${weth}`);
  }
}

async function main() {
  // ------------------------------------------------------------------ env, parsed before anything is read
  const owner = reqAddr("OWNER");
  const rescue = reqAddr("RESCUE_RECIPIENT");
  const lpVault = reqAddr("LP_VAULT");
  const factory = reqAddr("FACTORY");
  const npm = reqAddr("POSITION_MANAGER");
  const weth = reqAddr("WETH");

  const expectedChainId = reqUint("EXPECTED_CHAIN_ID");
  if (expectedChainId === 0n) throw new Error("EXPECTED_CHAIN_ID must be nonzero (it is asserted in the constructor)");

  const startLaunchId = reqUint("START_LAUNCH_ID", 1000n);
  if (startLaunchId === 0n) {
    throw new Error(
      "START_LAUNCH_ID=0 makes this pad's first launch id 1 — colliding with the reference pad's ids 3..8, " +
        "which is precisely what this immutable exists to prevent. Use 1000.",
    );
  }
  if (startLaunchId < 1000n && process.env.START_LAUNCH_ID_OK !== "1") {
    throw new Error(
      `START_LAUNCH_ID=${startLaunchId} is below 1000 and may collide with the reference pad's id space ` +
        "(3..8, and it can still grow). Set START_LAUNCH_ID_OK=1 if you have checked and mean it.",
    );
  }

  const initHash = (process.env.POOL_INIT_CODE_HASH || "").trim() || ethers.ZeroHash;
  if (initHash !== ethers.ZeroHash) {
    if (!ethers.isHexString(initHash) || ethers.dataLength(initHash) !== 32) {
      throw new Error("POOL_INIT_CODE_HASH must be 32 bytes (or omitted for the getPool fallback)");
    }
  }
  const poolProbe = initHash === ethers.ZeroHash ? null : reqAddr("POOL_PROBE");

  const ops = (process.env.OPERATORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const op of ops) {
    if (!ethers.isAddress(op)) throw new Error(`OPERATORS contains a non-address: ${op}`);
  }

  // ------------------------------------------------------------------ chain
  const [deployer] = await ethers.getSigners();
  const live = (await ethers.provider.getNetwork()).chainId;
  if (live !== expectedChainId) {
    throw new Error(
      `network is chain ${live} but EXPECTED_CHAIN_ID is ${expectedChainId} — the constructor would revert WrongChain`,
    );
  }
  const liveName = LIVE_CHAINS[Number(live)];
  if (liveName && process.env.CONFIRM_LIVE_DEPLOY !== String(live)) {
    throw new Error(
      `Chain ${live} is ${liveName} — a LIVE chain with real money, not a testnet. This deploy freezes ` +
        "owner, rescue recipient, LP vault, factory, position manager, WETH, chain id, start launch id and " +
        `the pool init code hash permanently. Re-run with CONFIRM_LIVE_DEPLOY=${live} to acknowledge that.`,
    );
  }
  if (owner.toLowerCase() === deployer.address.toLowerCase()) {
    console.warn(
      "WARNING: OWNER == the deploy key. The owner key can revoke operators and (after 2 days) repoint the\n" +
        "         rescue destination. Move ownership to a cold key before running any real arm.",
    );
  }

  // ------------------------------------------------------------------ venue, verified BEFORE the deploy tx
  console.log(`Verifying the venue on ${network.name} (chain ${live}) before deploying:`);
  await requireCode("FACTORY", factory);
  await requireCode("POSITION_MANAGER", npm);
  await requireCode("WETH", weth);
  await verifyNpm(npm, factory, weth);
  console.log(`  POSITION_MANAGER.factory() == ${factory}  and  .WETH9() == ${weth}`);
  if (poolProbe) {
    const p = await verifyInitCodeHash(factory, initHash, poolProbe);
    console.log(`  POOL_INIT_CODE_HASH reproduces ${poolProbe} from (${p.t0}, ${p.t1}, ${p.fee})`);
  } else {
    console.log("  POOL_INIT_CODE_HASH unset — the pad will verify each pool with factory.getPool instead");
  }

  console.log(`\nDeploying AtomicExperimentPad from ${deployer.address} on ${network.name} (chain ${live})`);
  console.log(`  owner ${owner}\n  rescue ${rescue}\n  lpVault ${lpVault}`);
  console.log(`  factory ${factory}\n  npm ${npm}\n  weth ${weth}`);
  console.log(`  startLaunchId ${startLaunchId}  poolInitCodeHash ${initHash}`);
  if (poolProbe) console.log(`  poolProbe ${poolProbe}`);

  // The constructor takes the probe as a 10th argument so the hash↔venue binding lives inside the artifact
  // that is actually immutable, not only in this script. Tolerate the 9-argument build so a stale compile
  // fails LOUDLY here rather than as an opaque ethers arity error.
  const padFactory = await ethers.getContractFactory("AtomicExperimentPad");
  const ctorInputs = padFactory.interface.deploy.inputs;
  const args = [owner, rescue, lpVault, factory, npm, weth, expectedChainId, startLaunchId, initHash];
  if (ctorInputs.length === 10 && ctorInputs[9].type === "address") {
    args.push(poolProbe || ethers.ZeroAddress);
  } else if (ctorInputs.length === 9) {
    console.warn(
      "NOTE: the compiled AtomicExperimentPad takes 9 constructor arguments, i.e. it has no poolProbe check.\n" +
        "      The init-code-hash / factory binding above was verified by this script only. Run\n" +
        "      `npx hardhat compile` if you expected the probe argument.",
    );
  } else {
    throw new Error(
      `AtomicExperimentPad's constructor takes ${ctorInputs.length} arguments (${ctorInputs.map((i) => i.type).join(", ")}), ` +
        "which this script does not know how to fill. Refusing to guess at the ORDER of nine immutables.",
    );
  }

  // OWNERSHIP IS HANDED OVER, NOT SET AT CONSTRUCTION. A mistyped OWNER passes every constructor check
  // (any address is a valid address) and permanently bricks the pad: no operator can ever be granted,
  // ownership can never move, and the only fix is a redeploy. Ownable2Step already solves this — deploy
  // owned by the deploy key, then transferOwnership(OWNER), which the real owner must ACCEPT. If OWNER is
  // wrong, nobody accepts and the deploy key still controls a working pad.
  args[0] = deployer.address;
  const pad = await padFactory.deploy(...args);
  const deployTx = pad.deploymentTransaction();
  await pad.waitForDeployment();
  const padAddr = await pad.getAddress();
  const rc = await ethers.provider.getTransactionReceipt(deployTx.hash);
  console.log(`\nAtomicExperimentPad ${padAddr}`);
  console.log(`  tx ${deployTx.hash}  block ${rc.blockNumber}`);

  // Grant operators FIRST, while the deploy key still owns the pad — after the handover only OWNER can.
  for (const op of ops) {
    await (await pad.setOperator(ethers.getAddress(op), true)).wait();
    console.log(`  operator + ${op}`);
  }

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await pad.transferOwnership(owner)).wait();
    console.log(`\n  ownership OFFERED to ${owner}`);
    console.log(`  >>> NOT COMPLETE until that key calls acceptOwnership() on ${padAddr}.`);
    console.log(`  >>> Until it does, ${deployer.address} is still the owner — which is the point:`);
    console.log(`  >>> a mistyped OWNER leaves you in control instead of bricking the pad.`);
  } else {
    console.log(`\n  owner == deploy key (no handover). Fine for a testnet rehearsal, NOT for real money.`);
  }

  // Six eth_calls, ONCE. The pad reads this map at launch time rather than hardcoding it, so print what the
  // venue actually says now — a drift here changes which fee tiers are usable levels of the experiment.
  const f = new ethers.Contract(factory, FACTORY_ABI, ethers.provider);
  const map = {};
  for (const fee of [100, 500, 3000, 10000, 2500, 20000]) {
    map[fee] = Number(await f.feeAmountTickSpacing(fee));
  }
  console.log(`\nfee -> tickSpacing on ${factory}:`);
  for (const [fee, s] of Object.entries(map)) {
    console.log(`  ${fee.padStart(5)} -> ${s === 0 ? "DISABLED" : s}`);
  }

  // ------------------------------------------------------------------ the record run-arm.js reads
  const recordPath = path.join(__dirname, `deployment-${live}.json`);
  if (fs.existsSync(recordPath)) {
    const backup = `${recordPath}.${Date.now()}.bak`;
    fs.renameSync(recordPath, backup);
    console.warn(`\nWARNING: a deployment record for chain ${live} already existed. Moved to ${path.basename(backup)}.`);
  }
  const record = {
    chainId: Number(live),
    network: network.name,
    pad: padAddr,
    deployBlock: rc.blockNumber,
    deployTx: deployTx.hash,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    constructorArgs: {
      initialOwner: owner,
      rescueRecipient: rescue,
      lpVault,
      factory,
      npm,
      weth,
      expectedChainId: expectedChainId.toString(),
      startLaunchId: startLaunchId.toString(),
      poolInitCodeHash: initHash,
      poolProbe: poolProbe || null,
    },
    operatorsGranted: ops,
    ownershipOfferedTo: owner.toLowerCase() === deployer.address.toLowerCase() ? null : owner,
    feeAmountTickSpacing: map,
  };
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nwrote ${recordPath}`);
  console.log("  run-arm.js anchors its declaration lookup on deployBlock — do not delete this file.");

  console.log(
    "\nNext: declareExperiment(<id>, <note>) from the OWNER key, in its OWN transaction BEFORE any launch\n" +
      "in that arm. Put the keccak digest of the canonicalised arm spec in the note: the chain enforces only\n" +
      "that the declaration precedes the launches in block order, so the digest is what ties those blocks to\n" +
      "the parameters actually run. Every parameter is already in the Launched event, so a sceptical reader\n" +
      "verifies spec-versus-execution by comparing the two — the chain does not check it for you.",
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});

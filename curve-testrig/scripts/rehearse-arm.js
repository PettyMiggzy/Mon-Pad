/*
 * Full dress rehearsal of an experiment, against a FORK of the real venue. Deploys the pad, declares the
 * experiment, and executes every replicate of both arms using live chain state — spending nothing.
 *
 * Runs the same code path the live run would, so a config error, a bad tick range, a salt-mining failure
 * or an out-of-gas surfaces here rather than after real capital is committed.
 *
 *   FORK_RPC=https://api.robinlab.io/rpc FORK_CHAINID=4663 \
 *     npx hardhat run scripts/rehearse-arm.js
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const PadTokenArtifact = require("../artifacts/contracts/pads/PadToken.sol/PadToken.json");

const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const NPM = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const INIT_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
// A real FACTORY-minted pool; the constructor proves INIT_HASH reproduces it.
const POOL_PROBE = "0x479a1d0d9aec941382d9cab3ba69dd3914d981e9";
// Mirror run-arm.js's salt layout EXACTLY. Now that both arms ship byte-identical name/symbol/supply,
// a shared salt space would mine the SAME token address for arm 2 as arm 1 and every launch would
// revert. Each arm owns a 2**24 block, each replicate a 2**20 slot inside it.
const ARM_BLOCK = 2 ** 24;
const REPLICATE_BLOCK = 2 ** 20;
const armOffset = (armId) => Number(BigInt(armId) % 1024n) * ARM_BLOCK;
const Recipient = { OPERATOR: 0, VAULT: 1, BURN: 2 };
const abi = ethers.AbiCoder.defaultAbiCoder();

function mineSalt(pad, cfg, wantToken0, startAt) {
  const args = abi.encode(["string", "string", "uint8", "uint256", "address"],
    [cfg.name, cfg.symbol, cfg.decimals, cfg.totalSupply, pad]);
  const h = ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode, args]));
  const w = BigInt(WETH);
  for (let i = startAt; i < startAt + 500000; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const token = ethers.getCreate2Address(pad, salt, h);
    if (BigInt(token) < w === wantToken0) return { salt, token };
  }
  throw new Error("no salt found");
}

(async () => {
  const [op] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`rehearsing on forked chain ${chainId} as ${op.address}`);
  console.log(`  balance ${ethers.formatEther(await ethers.provider.getBalance(op.address))} (fork funny money)\n`);

  const pad = await (await ethers.getContractFactory("RektPad")).deploy(
    op.address, op.address, op.address, FACTORY, NPM, WETH, chainId, 1n, INIT_HASH, POOL_PROBE);
  await pad.waitForDeployment();
  const padAddr = await pad.getAddress();
  console.log(`pad deployed ${padAddr}`);
  await (await pad.setOperator(op.address, true)).wait();

  const armFiles = ["scripts/arm-quote-seeded.json", "scripts/arm-quote-zero.json"];
  const expId = ethers.id("seed-quote-sweep");
  await (await pad.declareExperiment(expId, "seed-quote-sweep")).wait();
  console.log(`experiment declared ${expId.slice(0, 18)}...\n`);

  let totalGas = 0n, totalValue = 0n, ok = 0, fail = 0;
  for (const f of armFiles) {
    const spec = JSON.parse(fs.readFileSync(f));
    console.log(`ARM "${spec.arm}"  x${spec.replicates}`);
    for (let r = 1; r <= spec.replicates; r++) {
      const c = spec.cell;
      const armId = ethers.id(spec.arm);
      const mined = mineSalt(padAddr, c, c.wantTokenIsToken0, armOffset(armId) + r * REPLICATE_BLOCK);
      const p = {
        experimentId: expId, armId, replicate: r,
        name: c.name, symbol: c.symbol, decimals: c.decimals,
        totalSupply: BigInt(c.totalSupply), tokenSalt: mined.salt,
        wantTokenIsToken0: c.wantTokenIsToken0, fee: c.fee,
        openingTick: c.openingTick, tickLower: c.tickLower, tickUpper: c.tickUpper,
        seedTokenAmount: BigInt(c.seedTokenAmount), seedQuoteWei: BigInt(c.seedQuoteWei),
        seedTokenMin: BigInt(c.seedTokenMin), seedQuoteMin: BigInt(c.seedQuoteMin),
        lpTo: Recipient[c.lpTo], devBuyQuoteWei: BigInt(c.devBuyQuoteWei),
        devBuyMinTokensOut: BigInt(c.devBuyMinTokensOut),
        devBuySqrtPriceLimitX96: BigInt(c.devBuySqrtPriceLimitX96),
        devBuyTo: Recipient[c.devBuyTo], residualTo: Recipient[c.residualTo],
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const value = p.seedQuoteWei + p.devBuyQuoteWei;
      try {
        const tx = await pad.launch(p, { value });
        const rc = await tx.wait();
        totalGas += rc.gasUsed; totalValue += value;
        const ev = rc.logs.find((l) => { try { return pad.interface.parseLog(l)?.name === "Launched"; } catch { return false; } });
        if (!ev) throw new Error("no Launched event in receipt");
        const d = pad.interface.parseLog(ev).args;
        // `pool` lives inside the LaunchRecord struct, not at the top level of the event.
        const seededQ = d.record.seedAmount0 ?? 0n, seededT = d.record.seedAmount1 ?? 0n;
        ok++;
        console.log(`  r${r}: OK  token ${d.token.slice(0, 10)}.. pool ${d.record.pool.slice(0, 10)}.. ` +
          `gas ${String(rc.gasUsed).padStart(8)}  sent ${ethers.formatEther(value).padStart(6)}  ` +
          `seeded[0]=${ethers.formatEther(seededQ)} seeded[1]=${ethers.formatEther(seededT)}`);
      } catch (e) {
        fail++;
        console.log(`  r${r}: FAILED  ${String(e.shortMessage || e.message).slice(0, 130)}`);
      }
    }
    console.log();
  }
  const gp = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  console.log(`REHEARSAL: ${ok} launched, ${fail} failed`);
  console.log(`  quote deployed : ${ethers.formatEther(totalValue)} WETH-equivalent`);
  console.log(`  total gas      : ${totalGas}  (~${ethers.formatEther(totalGas * gp)} at ${ethers.formatUnits(gp, "gwei")} gwei)`);
  console.log(`\n  this was a FORK. nothing was spent and no token exists on the real chain.`);
})();

// deploy-fork.js — deploy the NEW (rebalanced + buffered) V3 set to a running
// anvil Monad-mainnet fork, using a freshly funded account. Prints the factory
// address so curve-analysis.js can be pointed at it:
//
//   anvil --fork-url <rpc> --hardfork cancun --port 8545
//   node scripts/deploy-fork.js                 # prints FACTORY=0x...
//   FACTORY_ADDR=0x... node scripts/curve-analysis.js
//
// Mainnet infra used live from the fork.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = "http://127.0.0.1:8545";
const PLATFORM = "0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16";
const TREASURY = "0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5";
const BUYBACK  = "0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5";
const WMON     = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const NPM      = "0xa9f6B6656e32F223d778b01642F32D00F5310526";
const MONSHI   = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";

function art(name, file) {
  const p = path.join(__dirname, "..", "artifacts", "contracts", "v3", file, name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const dev = new ethers.NonceManager(ethers.Wallet.createRandom().connect(provider));
  const addr = await dev.getAddress();
  await provider.send("anvil_setBalance", [addr, "0x" + (10_000n * 10n ** 18n).toString(16)]);

  const Factory = art("MonPadFactoryV3", "MonPadFactoryV3.sol");
  const Grad = art("MonPadGraduatorV3", "MonPadGraduatorV3.sol");

  const fFactory = new ethers.ContractFactory(Factory.abi, Factory.bytecode, dev);
  const factory = await fFactory.deploy(PLATFORM, TREASURY, BUYBACK, WMON, MONSHI);
  await factory.waitForDeployment();

  const fGrad = new ethers.ContractFactory(Grad.abi, Grad.bytecode, dev);
  const grad = await fGrad.deploy(factory.target, NPM, WMON);
  await grad.waitForDeployment();

  await (await factory.bootstrapInit(grad.target, BUYBACK)).wait();

  console.error(`deployed factory=${factory.target} graduator=${grad.target}`);
  console.error(`vm at 260k target: ${ethers.formatEther(await (new ethers.Contract(await factory.curveImpl(), ["function virtualMonReserve() view returns (uint256)"], provider)).virtualMonReserve().catch(() => 0n))} (impl is uninit; check via a launch)`);
  // stdout: just the factory address, for easy capture
  console.log(factory.target);
})().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });

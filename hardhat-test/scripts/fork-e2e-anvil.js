// fork-e2e-anvil.js — Full V3 lifecycle against the REAL deployed contracts on
// an anvil Monad-mainnet fork. Zero real MON (synthetic balance via anvil RPC).
//
//   anvil --fork-url <monad-rpc> --hardfork cancun --port 8545   # in another shell
//   node scripts/fork-e2e-anvil.js
//
// Drives the live factory + curve-clone bytecode: create → dev buy → buys to the
// graduation target → sell → graduate, asserting state + events at each step.

const { ethers } = require("ethers");

const RPC = process.env.ANVIL_RPC || "http://127.0.0.1:8545";
// Live mainnet factory (rebalanced curve + buffer). Override via FACTORY_ADDR.
const FACTORY = process.env.FACTORY_ADDR || "0x9ae8376ef5F22e02e217b1A4081686ea9e488E9C";
// anvil default account #0 (well-known dev key; fork-only)
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const FACTORY_ABI = [
  "function creationFee() view returns (uint256)",
  "function graduationTarget() view returns (uint256)",
  "function bootstrapped() view returns (bool)",
  "function pauseNewLaunches() view returns (bool)",
  "function allCounts() view returns (uint256,uint256)",
  "function allTokens(uint256) view returns (address)",
  "function allCurves(uint256) view returns (address)",
  "function createLaunch(string name, string symbol, (uint16 cfBurnTokenBps,uint16 cfLpBps,uint16 taxBurnTokenBps,uint16 taxLpBps) cfg) payable",
  "event Launch(address indexed token,address indexed curve,address indexed creator,string name,string symbol,address quoteToken,uint256 totalSupply,uint256 virtualMonReserve,uint256 virtualTokenReserve,uint256 createdAt)",
];
const CURVE_ABI = [
  "function buy(uint256 minTokensOut) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minMonOut) returns (uint256)",
  "function graduate()",
  "function monRaisedNet() view returns (uint256)",
  "function gradTarget() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function getCurveReserves() view returns (uint256,uint256,uint256,uint256)",
  "function priceWeiPerToken() view returns (uint256)",
  "function creator() view returns (address)",
  "function creatorPending() view returns (uint256)",
  "event Trade(address indexed token,address indexed trader,bool isBuy,uint256 monAmount,uint256 tokenAmount,uint256 virtualMonReserve,uint256 virtualTokenReserve,uint256 realMonReserve,uint256 realTokenReserve,uint256 priceX18,uint256 tradedAt)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const E = (n) => ethers.parseEther(String(n));
const F = (x) => Number(ethers.formatEther(x)).toLocaleString(undefined, { maximumFractionDigits: 4 });
let pass = 0, fail = 0;
function check(cond, label) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ FAIL: ${label}`); } }

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  const head = await provider.getBlockNumber();
  console.log(`\nFork: chainId=${net.chainId} block=${head}`);

  // Fresh random account (nonce 0 on the fork — avoids well-known-key nonce
  // clashes) wrapped in a NonceManager so the buy loop sequences cleanly.
  const base = ethers.Wallet.createRandom().connect(provider);
  const dev = new ethers.NonceManager(base);
  const devAddr = base.address;
  await provider.send("anvil_setBalance", [devAddr, "0x" + (2_000_000n * 10n ** 18n).toString(16)]);
  console.log(`Dev ${devAddr} balance=${F(await provider.getBalance(devAddr))} MON\n`);

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, dev);

  // --- read live config ---
  const fee = await factory.creationFee();
  const target = await factory.graduationTarget();
  const counts = await factory.allCounts();
  console.log(`Live factory: creationFee=${F(fee)} MON  gradTarget=${F(target)} MON  existingLaunches=${counts[0]}`);
  check((await factory.bootstrapped()) === true, "factory bootstrapped");
  check((await factory.pauseNewLaunches()) === false, "new launches not paused");

  // --- 1) CREATE (+ dev buy) ---
  const devBuy = E(1000);
  const cfg = { cfBurnTokenBps: 0, cfLpBps: 100, taxBurnTokenBps: 100, taxLpBps: 0 }; // 1% creator-fee→LP, 1% trade-tax→burn
  const rcC = await (await factory.createLaunch("Fork Test", "FORK", cfg, { value: fee + devBuy })).wait();
  const iface = new ethers.Interface(FACTORY_ABI);
  let token, curveAddr;
  for (const lg of rcC.logs) { try { const p = iface.parseLog(lg); if (p && p.name === "Launch") { token = p.args.token; curveAddr = p.args.curve; break; } } catch {} }
  // Fallback: resolve from factory storage (newest index) if event parse missed.
  if (!token || !curveAddr) {
    const c = await factory.allCounts();
    const i = c[0] - 1n;
    token = await factory.allTokens(i);
    curveAddr = await factory.allCurves(i);
  }
  check(!!token && !!curveAddr && token !== ethers.ZeroAddress, `createLaunch -> token=${token}`);
  console.log(`         curve=${curveAddr}  gas=${rcC.gasUsed}`);

  const curve = new ethers.Contract(curveAddr, CURVE_ABI, dev);
  const erc20 = new ethers.Contract(token, ERC20_ABI, dev);
  const devTok = await erc20.balanceOf(devAddr);
  check(devTok > 0n, `dev buy delivered tokens (${F(devTok)})`);
  console.log(`         monRaisedNet after dev buy=${F(await curve.monRaisedNet())} MON  price=${F(await curve.priceWeiPerToken())} MON/token`);

  // --- 2) SELL a slice DURING bonding (proves sell path + proceeds) ---
  // NOTE: read balances at explicit block tags — ethers v6 dedupes "latest"
  // getBalance calls right after instant-mined txs, which yields stale values.
  const bal = await erc20.balanceOf(devAddr);
  const sellAmt = bal / 10n;
  await (await erc20.approve(curveAddr, sellAmt)).wait();
  const curveBefore = await provider.getBalance(curveAddr);
  const rcS = await (await curve.sell(sellAmt, 0)).wait();
  const blk = rcS.blockNumber;
  const monBefore = await provider.getBalance(devAddr, blk - 1);
  const monAfter = await provider.getBalance(devAddr, blk);
  const curveAfter = await provider.getBalance(curveAddr, blk);
  const gasCost = rcS.gasUsed * (rcS.gasPrice ?? 0n);
  const proceeds = monAfter - monBefore + gasCost; // add gas back to isolate MON received
  check(proceeds > 0n && curveBefore - curveAfter > 0n, `sell paid seller +${F(proceeds)} MON (curve -${F(curveBefore - curveAfter)})`);
  console.log(`         sold ${F(sellAmt)} tokens; monRaisedNet now=${F(await curve.monRaisedNet())} MON; creatorPending=${F(await curve.creatorPending())} MON`);

  // --- 3) BUYS to graduation target (with margin so a prior sell can't block) ---
  let raised = await curve.monRaisedNet();
  const chunk = E(30000);
  let n = 0;
  while (raised < target && n < 40) { await (await curve.buy(0, { value: chunk })).wait(); raised = await curve.monRaisedNet(); n++; }
  console.log(`After ${n} buys: monRaisedNet=${F(raised)} MON  price=${F(await curve.priceWeiPerToken())} MON/token`);
  check(raised >= target, `reached graduation target (${F(raised)} >= ${F(target)})`);

  // --- 4) GRADUATE (creates the WMON/token DEX pool) ---
  check((await curve.graduated()) === false, "not graduated before graduate()");
  try {
    const rcG = await (await curve.graduate()).wait();
    const grad = await curve.graduated();
    check(grad === true, `graduate() succeeded (gas=${rcG.gasUsed})`);
  } catch (e) {
    fail++; console.log(`  ✗ FAIL: graduate() reverted — ${(e.shortMessage || e.message || "").slice(0, 160)}`);
  }

  // --- 5) Trade events (chart/feed source) ---
  const evs = await curve.queryFilter(curve.filters.Trade(), rcC.blockNumber, "latest");
  check(evs.length > 0, `emitted ${evs.length} Trade events (chart/feed data source)`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

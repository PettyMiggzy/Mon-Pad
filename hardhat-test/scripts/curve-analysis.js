// curve-analysis.js — measure the V3 curve's economics against the REAL deployed
// contracts on an anvil fork. Answers: how much supply does an early buyer get,
// what's the price multiple, how much supply is sold on the curve vs left for LP,
// and what price does the DEX open at vs the curve's final price.
//
//   anvil --fork-url <rpc> --hardfork cancun --port 8545
//   node scripts/curve-analysis.js
//
// MON≈$0.0192 (260,000 MON graduation ≈ $5,000).

const { ethers } = require("ethers");
const RPC = "http://127.0.0.1:8545";
const FACTORY = process.env.FACTORY_ADDR || "0x9007E499EdafBEC87Cc363fbE8Fd2B31142F4C01";
const USD_PER_MON = 5000 / 260000;

const FA = ["function creationFee() view returns (uint256)","function allCounts() view returns (uint256,uint256)","function allTokens(uint256) view returns (address)","function allCurves(uint256) view returns (address)","function createLaunch(string,string,(uint16,uint16,uint16,uint16)) payable"];
const CA = ["function buy(uint256) payable returns (uint256)","function sell(uint256,uint256) returns (uint256)","function monRaisedNet() view returns (uint256)","function graduated() view returns (bool)","function graduate()","function priceWeiPerToken() view returns (uint256)","function getCurveReserves() view returns (uint256,uint256,uint256,uint256)"];
const TA = ["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function totalSupply() view returns (uint256)"];

const E = (n) => ethers.parseEther(String(n));
const N = (x) => Number(ethers.formatEther(x));
const pct = (part, whole) => (100 * Number(part) / Number(whole));
const f2 = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const f4 = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

let provider, fee;
async function freshDev(mon = 2_000_000) {
  const w = new ethers.NonceManager(ethers.Wallet.createRandom().connect(provider));
  await provider.send("anvil_setBalance", [await w.getAddress(), "0x" + E(mon).toString(16)]);
  return w;
}
async function newToken(dev, devBuyMon = 0) {
  const factory = new ethers.Contract(FACTORY, FA, dev);
  await (await factory.createLaunch("CA", "CA", [0,0,0,0], { value: fee + E(devBuyMon) })).wait();
  const c = await factory.allCounts(); const i = c[0] - 1n;
  return { token: await factory.allTokens(i), curve: await factory.allCurves(i) };
}

async function main() {
  provider = new ethers.JsonRpcProvider(RPC);
  const f = new ethers.Contract(FACTORY, FA, provider);
  fee = await f.creationFee();

  console.log(`\n================ MON-PAD CURVE ANALYSIS (live deployed contracts) ================`);
  console.log(`graduation target = 260,000 MON ≈ $5,000   (MON ≈ $${USD_PER_MON.toFixed(4)})\n`);

  // --- 1) FIRST-BUYER SUPPLY TABLE (each on a fresh, dev-buy-free token) ---
  console.log(`FIRST-BUYER GRAB — one buyer, no prior buys, no dev buy:`);
  console.log(`  ${"MON in".padStart(9)} ${"$ in".padStart(8)}  ${"tokens out".padStart(14)}  ${"% of supply".padStart(11)}  ${"avg $/token".padStart(12)}`);
  const amounts = [1, 10, 50, 100, 500, 1000, 2600, 5000, 10000, 26000];
  for (const amt of amounts) {
    const dev = await freshDev();
    const { token, curve } = await newToken(dev);
    const c = new ethers.Contract(curve, CA, dev);
    const t = new ethers.Contract(token, TA, dev);
    const supply = await t.totalSupply();
    await (await c.buy(0, { value: E(amt) })).wait();
    const got = await t.balanceOf(await dev.getAddress());
    const share = pct(got, supply);
    const avgUsd = (amt * USD_PER_MON) / N(got);
    console.log(`  ${String(amt).padStart(9)} ${("$"+f2(amt*USD_PER_MON)).padStart(8)}  ${f2(N(got)).padStart(14)}  ${(f2(share)+"%").padStart(11)}  ${("$"+avgUsd.toFixed(8)).padStart(12)}`);
  }

  // --- 2) PRICE MULTIPLE + SUPPLY SOLD ON CURVE vs LEFT FOR LP (one token to graduation) ---
  console.log(`\nFULL CURVE → GRADUATION (single token, buy to target):`);
  const dev = await freshDev(2_000_000);
  const { token, curve } = await newToken(dev);
  const c = new ethers.Contract(curve, CA, dev);
  const t = new ethers.Contract(token, TA, dev);
  const supply = await t.totalSupply();
  const p0 = await c.priceWeiPerToken();
  let raised = 0n;
  const target = E(260000);
  let k = 0;
  while ((raised = await c.monRaisedNet()) < target && k < 30) { await (await c.buy(0, { value: E(30000) })).wait(); k++; }
  const pG = await c.priceWeiPerToken();
  const res = await c.getCurveReserves(); // vm, vt, rm, rt
  const soldOnCurve = supply - res[3]; // SUPPLY - realTokenReserve
  const leftForLp = res[3];
  console.log(`  start price   : $${(N(p0)*USD_PER_MON).toFixed(8)} /token`);
  console.log(`  grad price    : $${(N(pG)*USD_PER_MON).toFixed(8)} /token`);
  console.log(`  price multiple: ${f2(N(pG)/N(p0))}x  (launch → graduation)`);
  console.log(`  supply SOLD on curve : ${f2(pct(soldOnCurve, supply))}%`);
  console.log(`  supply LEFT for LP   : ${f2(pct(leftForLp, supply))}%  (${f2(N(leftForLp))} tokens)`);

  // --- 3) GRADUATION LP COMPOSITION + DEX OPENING PRICE vs CURVE FINAL ---
  const curveMonBefore = await provider.getBalance(curve);
  const rcG = await (await c.graduate()).wait();
  // decode graduator Graduated(token,pool,nftId,amountToken,amountWmon,liquidity,sqrtPriceX96)
  const gradIface = new ethers.Interface(["event Graduated(address indexed token,address indexed pool,uint256 nftId,uint256 amountToken,uint256 amountWmon,uint128 liquidity,uint160 sqrtPriceX96)"]);
  let lp;
  for (const lg of rcG.logs) { try { const p = gradIface.parseLog(lg); if (p && p.name === "Graduated") lp = p.args; } catch {} }
  if (lp) {
    const dexPrice = N(lp.amountWmon) / N(lp.amountToken); // MON per token at open (full-range ⇒ = ratio)
    console.log(`\nGRADUATION LP (DEX pool seeded):`);
    console.log(`  pool token : ${f2(N(lp.amountToken))} tokens`);
    console.log(`  pool MON   : ${f2(N(lp.amountWmon))} MON`);
    console.log(`  DEX open price : $${(dexPrice*USD_PER_MON).toFixed(8)} /token`);
    console.log(`  curve final    : $${(N(pG)*USD_PER_MON).toFixed(8)} /token`);
    console.log(`  DEX/curve gap  : ${f2(dexPrice/N(pG))}x  ${dexPrice/N(pG) > 1.2 ? "⚠️ DISCONTINUITY" : "✓ continuous"}`);
  }

  // --- 4) BUY → IMMEDIATE SELL ROUNDTRIP (must lose to fees, never extract value) ---
  console.log(`\nROUNDTRIP SAFETY (buy then instantly sell back):`);
  const d2 = await freshDev();
  const { token: tk2, curve: cv2 } = await newToken(d2);
  const c2 = new ethers.Contract(cv2, CA, d2); const t2 = new ethers.Contract(tk2, TA, d2);
  const a2 = await d2.getAddress();
  const spend = E(1000);
  const b0 = await provider.getBalance(a2, await provider.getBlockNumber());
  const rb = await (await c2.buy(0, { value: spend })).wait();
  const got2 = await t2.balanceOf(a2);
  const sellBack = (got2 * 99n) / 100n; // 99% — selling 100% as sole holder hits the 1-wei rounding floor
  await (await t2.approve(cv2, sellBack)).wait();
  const rs = await (await c2.sell(sellBack, 0)).wait();
  const blk = rs.blockNumber;
  const before = await provider.getBalance(a2, rb.blockNumber - 1);
  const after = await provider.getBalance(a2, blk);
  const gas = (rb.gasUsed * rb.gasPrice) + (rs.gasUsed * rs.gasPrice);
  const netExGas = N(after) - N(before) + N(gas); // MON delta excluding gas
  console.log(`  bought with 1000 MON, sold 100% back → net (ex-gas): ${f4(netExGas)} MON`);
  console.log(`  ${netExGas < 0 ? "✓ buyer loses to fees (no free value)" : "⚠️ buyer EXTRACTED value!"}`);

  console.log(`\n================================================================================\n`);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });

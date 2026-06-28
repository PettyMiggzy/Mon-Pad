// grad-deep.js — deep graduation test against the LIVE new contracts on a fork.
// Verifies: graduate() creates a real Uniswap V3 WMON/token pool, the pool is
// initialized + funded + has liquidity, the LP NFT is burned (dEaD), treasury +
// creator graduation payouts land, and the curve is locked afterwards.
const { ethers } = require("ethers");
const RPC = "http://127.0.0.1:8545";
const FACTORY = process.env.FACTORY_ADDR || "0x9ae8376ef5F22e02e217b1A4081686ea9e488E9C";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const NPM  = "0xa9f6B6656e32F223d778b01642F32D00F5310526";

const FA = ["function creationFee() view returns (uint256)","function graduator() view returns (address)","function treasuryWallet() view returns (address)","function allCounts() view returns (uint256,uint256)","function allTokens(uint256) view returns (address)","function allCurves(uint256) view returns (address)","function createLaunch(string,string,(uint16,uint16,uint16,uint16)) payable"];
const CA = ["function buy(uint256) payable returns (uint256)","function graduate()","function monRaisedNet() view returns (uint256)","function graduated() view returns (bool)","function creatorGraduationPending() view returns (uint256)","function creator() view returns (address)","function gradTreasuryCut() view returns (uint256)","function gradCreatorReward() view returns (uint256)"];
const TA = ["function balanceOf(address) view returns (uint256)"];
const GA = ["event Graduated(address indexed token,address indexed pool,uint256 nftId,uint256 amountToken,uint256 amountWmon,uint128 liquidity,uint160 sqrtPriceX96)"];
const POOL = ["function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)","function liquidity() view returns (uint128)","function token0() view returns (address)","function token1() view returns (address)","function fee() view returns (uint24)"];
const NPMA = ["function ownerOf(uint256) view returns (address)"];

const E = (n) => ethers.parseEther(String(n));
const F = (x) => Number(ethers.formatEther(x)).toLocaleString(undefined,{maximumFractionDigits:2});
let pass=0, fail=0;
const ck=(c,l)=>{ if(c){pass++;console.log("  ✓ "+l);} else {fail++;console.log("  ✗ FAIL: "+l);} };

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const dev = new ethers.NonceManager(ethers.Wallet.createRandom().connect(p));
  const addr = await dev.getAddress();
  await p.send("anvil_setBalance",[addr,"0x"+E(2_000_000).toString(16)]);
  const factory = new ethers.Contract(FACTORY, FA, dev);
  const fee = await factory.creationFee();
  const gradAddr = await factory.graduator();
  const treasury = await factory.treasuryWallet();
  console.log(`graduator=${gradAddr}\ntreasury=${treasury}\n`);

  // create + buy to target
  await (await factory.createLaunch("Grad","GRAD",[0,0,0,0],{value: fee + E(1000)})).wait();
  const c = await factory.allCounts(); const i = c[0]-1n;
  const token = await factory.allTokens(i), curveAddr = await factory.allCurves(i);
  const curve = new ethers.Contract(curveAddr, CA, dev);
  let raised=0n, n=0;
  while ((raised = await curve.monRaisedNet()) < E(260000) && n<40) { await (await curve.buy(0,{value:E(30000)})).wait(); n++; }
  console.log(`reached ${F(raised)} MON in ${n} buys\n`);

  const expTreasuryCut = await curve.gradTreasuryCut();
  const expCreatorReward = await curve.gradCreatorReward();

  // graduate
  const rc = await (await curve.graduate()).wait();
  // Read balances at explicit block tags around the graduate tx (ethers v6 caches
  // "latest" getBlockNumber/getBalance right after mining -> stale deltas).
  const treBefore = await p.getBalance(treasury, rc.blockNumber - 1);
  const gi = new ethers.Interface(GA);
  let ev;
  for (const lg of rc.logs) { try { const x=gi.parseLog(lg); if (x&&x.name==="Graduated") ev=x.args; } catch {} }

  console.log("GRADUATION:");
  ck(await curve.graduated(), "curve marked graduated");
  ck(!!ev, "Graduator emitted Graduated event");
  if (ev) {
    const pool = new ethers.Contract(ev.pool, POOL, p);
    const code = await p.getCode(ev.pool);
    ck(code !== "0x", `DEX pool deployed (${ev.pool})`);
    const slot0 = await pool.slot0();
    ck(slot0[0] > 0n, `pool initialized (sqrtPriceX96=${slot0[0]})`);
    ck((await pool.liquidity()) > 0n, `pool has liquidity (${await pool.liquidity()})`);
    ck((await pool.fee()) === 10000n, "pool fee tier = 1%");
    // pool token balances
    const wmonC = new ethers.Contract(WMON, TA, p);
    const tokC = new ethers.Contract(token, TA, p);
    const poolWmon = await wmonC.balanceOf(ev.pool), poolTok = await tokC.balanceOf(ev.pool);
    ck(poolWmon > 0n && poolTok > 0n, `pool funded: ${F(poolWmon)} WMON + ${F(poolTok)} tokens`);
    // LP NFT burned
    const npm = new ethers.Contract(NPM, NPMA, p);
    const owner = await npm.ownerOf(ev.nftId).catch(()=>"err");
    ck(owner.toLowerCase() === DEAD.toLowerCase(), `LP NFT #${ev.nftId} burned to dEaD (owner=${owner})`);
    console.log(`     event amounts: ${F(ev.amountToken)} tokens + ${F(ev.amountWmon)} WMON`);
  }

  // payouts
  const treAfter = await p.getBalance(treasury, rc.blockNumber);
  ck(treAfter - treBefore === expTreasuryCut, `treasury got graduation cut (+${F(treAfter-treBefore)} MON, expected ${F(expTreasuryCut)})`);
  ck((await curve.creatorGraduationPending()) === expCreatorReward, `creator graduation reward pending (${F(await curve.creatorGraduationPending())} MON, expected ${F(expCreatorReward)})`);

  // curve locked
  let locked=false;
  try { await (await curve.buy(0,{value:E(10)})).wait(); } catch { locked=true; }
  ck(locked, "curve buys blocked after graduation");

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e.shortMessage||e.message||e);process.exit(1)});

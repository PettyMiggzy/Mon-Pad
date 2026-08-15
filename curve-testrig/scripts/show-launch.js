/*
 * show-launch — run ONE launch on a fork and narrate every on-chain event in plain English.
 *
 * Exists because "the pad seeds it in" is not obvious from reading Solidity. This prints the actual
 * event sequence so the difference between SEEDING (a Mint — what bots watch) and a DEV BUY (a Swap —
 * what they ignore) is visible rather than asserted.
 *
 *   FORK_RPC=https://api.robinlab.io/rpc FORK_CHAINID=4663 npx hardhat run scripts/show-launch.js
 */
// Run ONE launch on a fork and narrate every on-chain event in plain English.
const { ethers } = require("hardhat");
const PadTokenArtifact = require("../artifacts/contracts/pads/PadToken.sol/PadToken.json");
const FACTORY="0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const NPM="0x73991a25c818bf1f1128deaab1492d45638de0d3";
const WETH="0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const HASH="0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";
const PROBE="0x479a1d0d9aec941382d9cab3ba69dd3914d981e9";
const abi=ethers.AbiCoder.defaultAbiCoder();
const NAMES={
 [ethers.id("Transfer(address,address,uint256)")]:"Transfer",
 [ethers.id("PoolCreated(address,address,uint24,int24,address)")]:"PoolCreated",
 [ethers.id("Initialize(uint160,int24)")]:"Initialize",
 [ethers.id("Mint(address,address,int24,int24,uint128,uint256,uint256)")]:"Mint",
 [ethers.id("IncreaseLiquidity(uint256,uint128,uint256,uint256)")]:"IncreaseLiquidity",
 [ethers.id("Approval(address,address,uint256)")]:"Approval",
 [ethers.id("Deposit(address,uint256)")]:"Deposit",
};
(async()=>{
  const [op]=await ethers.getSigners();
  const {chainId}=await ethers.provider.getNetwork();
  const pad=await (await ethers.getContractFactory("RektPad")).deploy(
    op.address,op.address,op.address,FACTORY,NPM,WETH,chainId,1n,HASH,PROBE);
  await pad.waitForDeployment();
  const padAddr=await pad.getAddress();
  await (await pad.setOperator(op.address,true)).wait();
  const expId=ethers.id("show"); await (await pad.declareExperiment(expId,"show")).wait();

  const c={name:"Rekt",symbol:"REKT",decimals:18,totalSupply:10n**27n};
  const args=abi.encode(["string","string","uint8","uint256","address"],[c.name,c.symbol,c.decimals,c.totalSupply,padAddr]);
  const h=ethers.keccak256(ethers.concat([PadTokenArtifact.bytecode,args]));
  let salt,token;
  for(let i=0;i<500000;i++){const s=ethers.zeroPadValue(ethers.toBeHex(i),32);
    const t=ethers.getCreate2Address(padAddr,s,h);
    if(BigInt(t)>BigInt(WETH)){salt=s;token=t;break;}}

  const p={experimentId:expId,armId:ethers.id("free"),replicate:1,
    name:c.name,symbol:c.symbol,decimals:18,totalSupply:c.totalSupply,tokenSalt:salt,
    wantTokenIsToken0:false,fee:10000,openingTick:253000,tickLower:46000,tickUpper:253000,
    seedTokenAmount:98n*10n**25n,seedQuoteWei:0n,seedTokenMin:0n,seedQuoteMin:0n,
    lpTo:1,devBuyQuoteWei:0n,devBuyMinTokensOut:0n,devBuySqrtPriceLimitX96:0n,
    devBuyTo:0,residualTo:2,deadline:BigInt(Math.floor(Date.now()/1000)+3600)};

  console.log("YOU SEND: 0 ETH  (only gas)\n");
  const rc=await (await pad.launch(p,{value:0n})).wait();
  console.log(`ONE TRANSACTION -> ${rc.logs.length} things happened on-chain:\n`);
  let n=0;
  for(const l of rc.logs){
    const nm=NAMES[l.topics[0]]||l.topics[0].slice(0,12)+"…";
    let who=l.address.toLowerCase()===token.toLowerCase()?"REKT token"
          :l.address.toLowerCase()===WETH?"ETH contract"
          :l.address.toLowerCase()===FACTORY?"Uniswap factory"
          :l.address.toLowerCase()===NPM?"Uniswap position mgr"
          :l.address.toLowerCase()===padAddr.toLowerCase()?"the pad":"the POOL";
    let note="";
    if(nm==="Transfer"&&l.address.toLowerCase()===token.toLowerCase()){
      const from="0x"+l.topics[1].slice(26), to="0x"+l.topics[2].slice(26);
      const amt=Number(ethers.formatEther(BigInt(l.data)));
      note = from==="0x0000000000000000000000000000000000000000" ? `minted ${amt.toExponential(2)} REKT out of thin air`
           : to.toLowerCase()==="0x000000000000000000000000000000000000dead" ? `burned ${amt.toExponential(2)} REKT (leftover)`
           : `moved ${amt.toExponential(2)} REKT into the pool`;
    }
    if(nm==="PoolCreated") note="the REKT/ETH market now exists";
    if(nm==="Initialize") note="opening price set";
    if(nm==="Mint"){const d=abi.decode(["address","uint128","uint256","uint256"],l.data);
      note=`LIQUIDITY DEPOSITED — ${Number(ethers.formatEther(d[2])).toExponential(2)} / ${Number(ethers.formatEther(d[3])).toExponential(2)}   <<< THIS IS WHAT BOTS WATCH`;}
    if(nm==="IncreaseLiquidity") note="you got the LP receipt (an NFT)";
    console.log(`  ${String(++n).padStart(2)}. ${nm.padEnd(19)} ${who.padEnd(21)} ${note}`);
  }
  console.log(`\nAFTER: token ${token}`);
})();

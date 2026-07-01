// MonPadBoostMonshi — verify MONSHI pull, 70% burn / 30% treasury split, tiers.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
const DEAD = "0x000000000000000000000000000000000000dEaD";

describe("MonPadBoostMonshi", () => {
  async function fixture() {
    const [owner, treasury, project] = await ethers.getSigners();
    const M = await ethers.getContractFactory("MockERC20");
    const monshi = await M.deploy("Monshi", "MONSHI"); await monshi.waitForDeployment();
    // fund the project with MONSHI (MockERC20 mints to deployer; move some to project)
    await monshi.mint(project.address, 100_000_000n * E18).catch(async () => {
      // if no mint(), transfer from owner's initial supply
      await monshi.transfer(project.address, 100_000_000n * E18);
    });
    const B = await ethers.getContractFactory("MonPadBoostMonshi");
    const boost = await B.deploy(monshi.target, treasury.address); await boost.waitForDeployment();
    return { owner, treasury, project, monshi, boost };
  }

  it("seeds 5M/48h and 10M/5d tiers", async () => {
    const { boost } = await fixture();
    expect(await boost.tierCount()).to.equal(2n);
    const t0 = await boost.tiers(0); const t1 = await boost.tiers(1);
    expect(t0.amount).to.equal(5_000_000n * E18);
    expect(t0.durationSec).to.equal(48n * 3600n);
    expect(t1.amount).to.equal(10_000_000n * E18);
    expect(t1.durationSec).to.equal(5n * 86400n);
  });

  it("burns 70% and sends 30% to treasury on a tier-0 boost", async () => {
    const { treasury, project, monshi, boost } = await fixture();
    const token = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
    const amt = 5_000_000n * E18;
    await monshi.connect(project).approve(boost.target, amt);
    await expect(boost.connect(project).boost(token, 0)).to.emit(boost, "Boosted");
    expect(await monshi.balanceOf(DEAD)).to.equal((amt * 7000n) / 10000n);          // 70% burned
    expect(await monshi.balanceOf(treasury.address)).to.equal(amt - (amt * 7000n) / 10000n); // 30%
  });

  it("reverts without allowance and on a disabled/bad tier", async () => {
    const { project, monshi, boost } = await fixture();
    const token = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
    await expect(boost.connect(project).boost(token, 5)).to.be.revertedWith("bad tier");
    await expect(boost.connect(project).boost(token, 0)).to.be.reverted; // no approval
  });
});

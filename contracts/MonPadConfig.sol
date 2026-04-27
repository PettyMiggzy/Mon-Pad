// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonPadConfig
 * @notice Central tunable parameters for the MonPad ecosystem.
 *         All economics + wallets + fee splits live here.
 *         Owner can tune via setters; critical changes go through timelock.
 */
contract MonPadConfig {
    // ───────────────────── ROLES ─────────────────────
    address public owner;
    address public pendingOwner;
    address public timelock; // optional 2nd layer for critical changes

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyTimelockOrOwner() {
        require(msg.sender == owner || (timelock != address(0) && msg.sender == timelock), "not authorized");
        _;
    }

    // ─────────────────── WALLETS ─────────────────────
    address public platformWallet;       // receives 1% sell fee real-time + buy buffer at graduation
    address public treasuryWallet;       // legacy / future use
    address public buybackWallet;        // receives default sell-staking 0.5% (until rewardRouter set)
    address public monshiStakingPool;    // MONSHI's own staking pool, gets 40% of staking distributions
    address public rewardRouter;         // SET LATER: when staking hub deployed, sell tax routes here
    address public monshiToken;          // for free-pool eligibility check (1M+ MONSHI = free)
    address public swapWallet;           // receives the 0.3% swap wrapper fee

    // ─────────────────── ECONOMICS ───────────────────
    uint256 public graduationTarget   = 425_000 ether;  // total MON net to graduate
    uint256 public lpAtGraduation     = 400_000 ether;  // MON sent to LP at graduation
    uint256 public creatorReward      = 25_000 ether;   // MON sent to creator at graduation
    uint256 public creationFee        = 100 ether;      // MON to launch a token
    uint256 public maxDevBuyBps       = 200;            // 2.00% of supply max for atomic dev buy
    uint256 public minDevBuyMon       = 0;              // dev buy is optional, can be 0
    uint256 public maxSupplyTokens    = 1_000_000_000 ether; // 1B (with 18 decimals)

    // ─────────────────── BUY FEES (2% total) ─────────
    uint16 public buyCreatorBps      = 100;  // 1% real-time to creator
    uint16 public buyBufferBps       = 100;  // 1% held in curve, sent to platform at graduation

    // ─────────────────── SELL FEES (2% total) ────────
    uint16 public sellCreatorBps     = 50;   // 0.5% real-time to creator
    uint16 public sellStakingBps     = 50;   // 0.5% real-time to rewardRouter (or buyback if router unset)
    uint16 public sellPlatformBps    = 100;  // 1% real-time to platform

    // ─────────────────── STAKING ─────────────────────
    uint256 public poolCreationFee     = 200 ether; // MON to create a pool (waived if 1M+ MONSHI)
    uint256 public freePoolMonshiMin   = 1_000_000 ether; // 1M MONSHI to skip pool fee
    uint16 public earlyUnstakeFeeBps   = 1000; // 10% of unstaked amount kept in pool
    uint16 public monshiPoolShareBps   = 4000; // 40% of staking distributions go to MONSHI pool
    // Lock multipliers (BPS = 10000 = 1.00x)
    uint16 public lock30Mult  = 10000; // 1.00x
    uint16 public lock90Mult  = 15000; // 1.50x
    uint16 public lock180Mult = 25000; // 2.50x
    uint16 public lock365Mult = 40000; // 4.00x

    // ─────────────────── PAUSES ──────────────────────
    bool public globalPauseBuys;
    bool public globalPauseSells;
    bool public globalPauseLaunches;
    bool public globalPauseStaking;

    // ─────────────────── BLOCKLIST ───────────────────
    mapping(address => bool) public tokenBlocked;

    // ─────────────────── EVENTS ──────────────────────
    event OwnershipTransferStarted(address indexed previous, address indexed pending);
    event OwnershipTransferred(address indexed previous, address indexed newOwner);
    event TimelockSet(address indexed timelock);
    event WalletUpdated(string indexed key, address oldValue, address newValue);
    event ParamUpdated(string indexed key, uint256 oldValue, uint256 newValue);
    event PauseUpdated(string indexed key, bool value);
    event TokenBlocked(address indexed token, bool blocked);

    constructor(
        address _owner,
        address _platform,
        address _treasury,
        address _buyback,
        address _monshiToken
    ) {
        require(_owner != address(0), "owner=0");
        owner = _owner;
        platformWallet = _platform;
        treasuryWallet = _treasury;
        buybackWallet = _buyback;
        monshiToken = _monshiToken;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ─────────────────── OWNERSHIP ───────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
    function setTimelock(address _t) external onlyOwner {
        timelock = _t;
        emit TimelockSet(_t);
    }

    // ─────────────────── WALLET SETTERS ──────────────
    function setPlatformWallet(address w) external onlyOwner { emit WalletUpdated("platform", platformWallet, w); platformWallet = w; }
    function setTreasuryWallet(address w) external onlyOwner { emit WalletUpdated("treasury", treasuryWallet, w); treasuryWallet = w; }
    function setBuybackWallet(address w) external onlyOwner { emit WalletUpdated("buyback", buybackWallet, w); buybackWallet = w; }
    function setMonshiStakingPool(address w) external onlyOwner { emit WalletUpdated("monshiPool", monshiStakingPool, w); monshiStakingPool = w; }
    function setRewardRouter(address w) external onlyOwner { emit WalletUpdated("rewardRouter", rewardRouter, w); rewardRouter = w; }
    function setMonshiToken(address w) external onlyOwner { emit WalletUpdated("monshiToken", monshiToken, w); monshiToken = w; }
    function setSwapWallet(address w) external onlyOwner { emit WalletUpdated("swap", swapWallet, w); swapWallet = w; }

    // ─────────────────── ECONOMICS SETTERS (TIMELOCKABLE) ──
    function setGraduationTarget(uint256 v) external onlyTimelockOrOwner { emit ParamUpdated("gradTarget", graduationTarget, v); graduationTarget = v; }
    function setLpAtGraduation(uint256 v)   external onlyTimelockOrOwner { emit ParamUpdated("lpAtGrad", lpAtGraduation, v); lpAtGraduation = v; }
    function setCreatorReward(uint256 v)    external onlyTimelockOrOwner { emit ParamUpdated("creatorReward", creatorReward, v); creatorReward = v; }
    function setCreationFee(uint256 v)      external onlyOwner { emit ParamUpdated("creationFee", creationFee, v); creationFee = v; }
    function setMaxDevBuyBps(uint256 v)     external onlyOwner { require(v <= 1000, ">10%"); emit ParamUpdated("maxDevBuyBps", maxDevBuyBps, v); maxDevBuyBps = v; }
    function setMinDevBuyMon(uint256 v)     external onlyOwner { emit ParamUpdated("minDevBuy", minDevBuyMon, v); minDevBuyMon = v; }

    // ─────────────────── FEE SETTERS (TIMELOCKABLE) ───
    function setBuyFees(uint16 cBps, uint16 bBps) external onlyTimelockOrOwner {
        require(uint256(cBps) + uint256(bBps) <= 1000, "buy>10%");
        emit ParamUpdated("buyCreator", buyCreatorBps, cBps);
        emit ParamUpdated("buyBuffer", buyBufferBps, bBps);
        buyCreatorBps = cBps; buyBufferBps = bBps;
    }
    function setSellFees(uint16 cBps, uint16 sBps, uint16 pBps) external onlyTimelockOrOwner {
        require(uint256(cBps) + uint256(sBps) + uint256(pBps) <= 1000, "sell>10%");
        emit ParamUpdated("sellCreator", sellCreatorBps, cBps);
        emit ParamUpdated("sellStaking", sellStakingBps, sBps);
        emit ParamUpdated("sellPlatform", sellPlatformBps, pBps);
        sellCreatorBps = cBps; sellStakingBps = sBps; sellPlatformBps = pBps;
    }

    // ─────────────────── STAKING SETTERS ─────────────
    function setPoolCreationFee(uint256 v)   external onlyOwner { emit ParamUpdated("poolFee", poolCreationFee, v); poolCreationFee = v; }
    function setFreePoolMonshiMin(uint256 v) external onlyOwner { emit ParamUpdated("freePoolMin", freePoolMonshiMin, v); freePoolMonshiMin = v; }
    function setEarlyUnstakeFeeBps(uint16 v) external onlyOwner { require(v <= 5000, ">50%"); emit ParamUpdated("earlyFee", earlyUnstakeFeeBps, v); earlyUnstakeFeeBps = v; }
    function setMonshiPoolShareBps(uint16 v) external onlyOwner { require(v <= 10000, ">100%"); emit ParamUpdated("monshiShare", monshiPoolShareBps, v); monshiPoolShareBps = v; }
    function setLockMultipliers(uint16 m30, uint16 m90, uint16 m180, uint16 m365) external onlyOwner {
        require(m30 >= 10000 && m90 >= m30 && m180 >= m90 && m365 >= m180, "bad order");
        require(m365 <= 100000, ">10x cap");
        lock30Mult = m30; lock90Mult = m90; lock180Mult = m180; lock365Mult = m365;
    }

    // ─────────────────── PAUSES ──────────────────────
    function setPauseBuys(bool v)     external onlyOwner { globalPauseBuys = v; emit PauseUpdated("buys", v); }
    function setPauseSells(bool v)    external onlyOwner { globalPauseSells = v; emit PauseUpdated("sells", v); }
    function setPauseLaunches(bool v) external onlyOwner { globalPauseLaunches = v; emit PauseUpdated("launches", v); }
    function setPauseStaking(bool v)  external onlyOwner { globalPauseStaking = v; emit PauseUpdated("staking", v); }

    // ─────────────────── BLOCKLIST ───────────────────
    function setTokenBlocked(address token, bool blocked) external onlyOwner {
        tokenBlocked[token] = blocked;
        emit TokenBlocked(token, blocked);
    }
    function batchBlockTokens(address[] calldata tokens, bool blocked) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBlocked[tokens[i]] = blocked;
            emit TokenBlocked(tokens[i], blocked);
        }
    }

    // ─────────────────── HELPERS ─────────────────────
    /// @notice Returns true if this address holds enough MONSHI to skip pool creation fee
    function isMonshiWhale(address user) external view returns (bool) {
        if (monshiToken == address(0) || user == address(0)) return false;
        (bool ok, bytes memory data) = monshiToken.staticcall(abi.encodeWithSignature("balanceOf(address)", user));
        if (!ok || data.length < 32) return false;
        uint256 bal = abi.decode(data, (uint256));
        return bal >= freePoolMonshiMin;
    }

    /// @notice Returns the active reward router address (router if set, else buyback fallback)
    function activeRewardRouter() external view returns (address) {
        return rewardRouter == address(0) ? buybackWallet : rewardRouter;
    }
}

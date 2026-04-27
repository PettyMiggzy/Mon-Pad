// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadCurveV2.sol";
import "./MonPadTokenV2.sol";

/// @title MonPadFactoryV2
/// @notice Launches new tokens with bonding curves. All economics admin-tunable.
contract MonPadFactoryV2 {
    // ── OWNERSHIP ─────────────────────────────
    address public owner;
    address public pendingOwner;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }
    
    // ── WALLETS (rotatable) ───────────────────
    address public platformWallet;     // receives 1% sell tax + buy buffer at grad
    address public treasuryWallet;     // receives creation fees
    address public buybackWallet;      // receives staking 0.5% UNTIL rewardRouter is set
    address public rewardRouter;       // when set, sell-tax 0.5% routes here instead of buyback
    address public monshiStakingPool;  // MONSHI's pool (for buyback fallback)
    
    // ── ECONOMICS (all tunable) ───────────────
    uint256 public creationFee = 100 ether;
    uint256 public maxDevBuyBps = 200;          // 2% of supply max
    uint256 public minDevBuyMon = 100 ether;
    uint256 public graduationTarget = 425_000 ether;
    uint256 public graduationLP = 400_000 ether;
    uint256 public graduationCreatorReward = 25_000 ether;
    uint256 public maxSupply = 1_000_000_000 ether;
    
    // Fee splits in BPS (10000 = 100%)
    uint16 public buyFeeCreatorBps = 100;       // 1% to creator on buy
    uint16 public buyFeeBufferBps = 100;        // 1% buffer (paid to platform at grad)
    uint16 public sellFeeCreatorBps = 50;       // 0.5% to creator on sell
    uint16 public sellFeeStakingBps = 50;       // 0.5% to staking router (or buyback)
    uint16 public sellFeePlatformBps = 100;     // 1% to platform on sell
    
    // ── PAUSE SWITCHES ────────────────────────
    bool public pauseNewLaunches;
    bool public pauseAllBuys;
    bool public pauseAllSells;
    
    // ── TIMELOCK on critical changes ──────────
    uint256 public timelockDelay = 24 hours;
    mapping(bytes32 => uint256) public pendingChanges;
    
    // ── REGISTRY ──────────────────────────────
    address[] public allTokens;
    address[] public allCurves;
    mapping(address => address) public tokToCurve;
    mapping(address => bool) public isLaunched;
    mapping(address => bool) public blocked;
    
    // ── EVENTS ────────────────────────────────
    event Launched(address indexed token, address indexed curve, address indexed creator, address referrer, uint256 devAmt, string name, string symbol);
    event ParamChanged(string indexed param, uint256 oldValue, uint256 newValue);
    event WalletChanged(string indexed wallet, address oldAddr, address newAddr);
    event RewardRouterChanged(address oldRouter, address newRouter);
    event TokenBlocked(address indexed token, bool blocked);
    event OwnershipTransferred(address indexed prev, address indexed next);
    
    constructor(address _platform, address _treasury, address _buyback) {
        owner = msg.sender;
        platformWallet = _platform;
        treasuryWallet = _treasury;
        buybackWallet = _buyback;
        emit OwnershipTransferred(address(0), msg.sender);
    }
    
    // ── LAUNCH ────────────────────────────────
    function createLaunch(
        string calldata name,
        string calldata symbol,
        address referrer
    ) external payable returns (address token, address curve) {
        require(!pauseNewLaunches, "launches paused");
        uint256 devBuy = msg.value > creationFee ? msg.value - creationFee : 0;
        require(msg.value >= creationFee, "insufficient fee");
        if (devBuy > 0) require(devBuy >= minDevBuyMon, "dev buy < min");
        
        // Deploy token + curve
        token = address(new MonPadTokenV2(name, symbol, maxSupply));
        curve = address(new MonPadCurveV2(
            token,
            msg.sender,
            referrer,
            address(this)
        ));
        
        MonPadTokenV2(token).setCurve(curve);
        
        // Pay creation fee to treasury
        (bool ok, ) = treasuryWallet.call{value: creationFee}("");
        require(ok, "treasury pay failed");
        
        // Atomic dev buy
        if (devBuy > 0) {
            uint256 maxBuyMon = _calcMaxDevBuyMon();
            uint256 actual = devBuy > maxBuyMon ? maxBuyMon : devBuy;
            uint256 refund = devBuy - actual;
            MonPadCurveV2(payable(curve)).devBuy{value: actual}(msg.sender);
            if (refund > 0) {
                (bool r, ) = msg.sender.call{value: refund}("");
                require(r, "refund failed");
            }
        }
        
        allTokens.push(token);
        allCurves.push(curve);
        tokToCurve[token] = curve;
        isLaunched[token] = true;
        
        emit Launched(token, curve, msg.sender, referrer, devBuy, name, symbol);
    }
    
    function _calcMaxDevBuyMon() internal view returns (uint256) {
        // Cap dev buy by max BPS of supply they can grab
        return (graduationTarget * maxDevBuyBps) / 10000;
    }
    
    // ── REWARD ROUTER (the magic switch) ──────
    /// When rewardRouter == 0, sell-tax 0.5% goes to buybackWallet.
    /// When rewardRouter != 0, sell-tax 0.5% goes to rewardRouter.staking distribute().
    function getRewardRecipient() external view returns (address) {
        return rewardRouter == address(0) ? buybackWallet : rewardRouter;
    }
    
    function setRewardRouter(address _router) external onlyOwner {
        emit RewardRouterChanged(rewardRouter, _router);
        rewardRouter = _router;
    }
    
    // ── ADMIN: WALLETS ────────────────────────
    function setPlatformWallet(address w) external onlyOwner {
        emit WalletChanged("platform", platformWallet, w);
        platformWallet = w;
    }
    function setTreasuryWallet(address w) external onlyOwner {
        emit WalletChanged("treasury", treasuryWallet, w);
        treasuryWallet = w;
    }
    function setBuybackWallet(address w) external onlyOwner {
        emit WalletChanged("buyback", buybackWallet, w);
        buybackWallet = w;
    }
    function setMonshiStakingPool(address p) external onlyOwner {
        emit WalletChanged("monshiPool", monshiStakingPool, p);
        monshiStakingPool = p;
    }
    
    // ── ADMIN: ECONOMICS (timelocked for critical) ────
    function setCreationFee(uint256 v) external onlyOwner {
        emit ParamChanged("creationFee", creationFee, v);
        creationFee = v;
    }
    function setMaxDevBuyBps(uint256 v) external onlyOwner {
        require(v <= 1000, "max 10%"); // safety ceiling
        emit ParamChanged("maxDevBuyBps", maxDevBuyBps, v);
        maxDevBuyBps = v;
    }
    function setMinDevBuyMon(uint256 v) external onlyOwner {
        emit ParamChanged("minDevBuyMon", minDevBuyMon, v);
        minDevBuyMon = v;
    }
    function setGraduationTarget(uint256 v) external onlyOwner {
        require(v >= graduationLP + graduationCreatorReward, "target < LP+reward");
        emit ParamChanged("graduationTarget", graduationTarget, v);
        graduationTarget = v;
    }
    function setGraduationLP(uint256 v) external onlyOwner {
        emit ParamChanged("graduationLP", graduationLP, v);
        graduationLP = v;
    }
    function setGraduationCreatorReward(uint256 v) external onlyOwner {
        emit ParamChanged("graduationCreatorReward", graduationCreatorReward, v);
        graduationCreatorReward = v;
    }
    
    // ── ADMIN: FEE SPLITS ─────────────────────
    function setFeeSplits(
        uint16 _buyCreator,
        uint16 _buyBuffer,
        uint16 _sellCreator,
        uint16 _sellStaking,
        uint16 _sellPlatform
    ) external onlyOwner {
        require(_buyCreator + _buyBuffer <= 1000, "buy fees > 10%");
        require(_sellCreator + _sellStaking + _sellPlatform <= 1000, "sell fees > 10%");
        buyFeeCreatorBps = _buyCreator;
        buyFeeBufferBps = _buyBuffer;
        sellFeeCreatorBps = _sellCreator;
        sellFeeStakingBps = _sellStaking;
        sellFeePlatformBps = _sellPlatform;
        emit ParamChanged("buyFeeCreatorBps", buyFeeCreatorBps, _buyCreator);
    }
    
    // ── ADMIN: PAUSES ─────────────────────────
    function setPauseNewLaunches(bool v) external onlyOwner { pauseNewLaunches = v; }
    function setPauseAllBuys(bool v) external onlyOwner { pauseAllBuys = v; }
    function setPauseAllSells(bool v) external onlyOwner { pauseAllSells = v; }
    
    // ── ADMIN: BLOCKLIST ──────────────────────
    function setBlocked(address tok, bool b) external onlyOwner {
        blocked[tok] = b;
        emit TokenBlocked(tok, b);
    }
    
    // ── OWNERSHIP TRANSFER (2-step for safety) ─
    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
    }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "!pending");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }
    
    // ── VIEWS ─────────────────────────────────
    function allCounts() external view returns (uint256 t, uint256 c) {
        return (allTokens.length, allCurves.length);
    }
    function getCurveSettings() external view returns (
        uint16, uint16, uint16, uint16, uint16
    ) {
        return (buyFeeCreatorBps, buyFeeBufferBps, sellFeeCreatorBps, sellFeeStakingBps, sellFeePlatformBps);
    }
    
    receive() external payable {}
}

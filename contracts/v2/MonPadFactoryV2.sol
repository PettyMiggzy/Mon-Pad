// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadCurveV2.sol";
import "./MonPadTokenV2.sol";

/// @notice Minimal interface for MonPadStakingHub.setCurveAuthorized.
///         Match Hub.setCurveAuthorized(address,bool) signature exactly.
interface IStakingHub {
    function setCurveAuthorized(address curve, bool authorized) external;
}

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
    address public poolFactory;        // authoritative source for Hub.onlyPoolFactory check
    bool    public bootstrapped;        // one-shot flag for bootstrapInit
    address public monshiStakingPool;  // MONSHI's pool (for buyback fallback)
    
    // ── ECONOMICS (all tunable) ───────────────
    uint256 public creationFee = 100 ether;
    uint256 public maxDevBuyBps = 200;          // 2% of supply max
    // V2.1-3 fix: default to 0. The previous default of 100 ether was mathematically
    // incompatible with maxDevBuyBps=200 at launch reserves (Vm=30, Vt=1.073B): 100 MON
    // buys ~82.5% of supply, far above the 2% cap, so any non-zero devBuy reverted.
    // Setting min to 0 means the only constraint is the 2% supply cap (~0.6 MON ceiling
    // at launch reserves). Owner can raise via timelocked queueSetMinDevBuyMon if desired.
    uint256 public minDevBuyMon = 0;
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
        
    // ── REGISTRY ──────────────────────────────
    address[] public allTokens;
    address[] public allCurves;
    mapping(address => address) public tokToCurve;
    mapping(address => bool) public isLaunched;
    mapping(address => bool) public blocked;

    // Graduator address (read by curves at graduation; set post-deploy)
    address public graduator;
    
    // ── EVENTS ────────────────────────────────
    event Launched(address indexed token, address indexed curve, address indexed creator, address referrer, uint256 devAmt, string name, string symbol);
    event ParamChanged(string indexed param, uint256 oldValue, uint256 newValue);
    event WalletChanged(string indexed wallet, address oldAddr, address newAddr);
    event Bootstrapped(address graduator, address rewardRouter, address poolFactory);
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

        // V2.1-1 fix: authorize this curve in the staking hub so its sell-tax notifyReward calls
        // are accepted. Skipped when rewardRouter is unset (pre-bootstrapInit) or is an EOA
        // (e.g. buyback wallet during pre-staking phase) — in those cases sell-tax goes to a
        // wallet via a plain transfer and no Hub authorization is needed.
        if (rewardRouter != address(0) && rewardRouter.code.length > 0) {
            IStakingHub(rewardRouter).setCurveAuthorized(curve, true);
        }

        // Pay creation fee to treasury
        (bool ok, ) = treasuryWallet.call{value: creationFee}("");
        require(ok, "treasury pay failed");
        
        // Atomic dev buy (curve enforces 2% supply cap, will revert if exceeds)
        if (devBuy > 0) {
            MonPadCurveV2(payable(curve)).devBuy{value: devBuy}(msg.sender);
        }
        
        allTokens.push(token);
        allCurves.push(curve);
        tokToCurve[token] = curve;
        isLaunched[token] = true;
        
        emit Launched(token, curve, msg.sender, referrer, devBuy, name, symbol);
    }
    
    // ── REWARD ROUTER (the magic switch) ──────
    /// When rewardRouter == 0, sell-tax 0.5% goes to buybackWallet.
    /// When rewardRouter != 0, sell-tax 0.5% goes to rewardRouter.staking distribute().
    function getRewardRecipient() external view returns (address) {
        return rewardRouter == address(0) ? buybackWallet : rewardRouter;
    }
    
    function _applySetRewardRouter(address _router) internal {
        emit RewardRouterChanged(rewardRouter, _router);
        rewardRouter = _router;
    }
    
    // ── ADMIN: WALLETS ────────────────────────
    function _applySetPlatformWallet(address w) internal {
        emit WalletChanged("platform", platformWallet, w);
        platformWallet = w;
    }
    function _applySetTreasuryWallet(address w) internal {
        emit WalletChanged("treasury", treasuryWallet, w);
        treasuryWallet = w;
    }
    function _applySetBuybackWallet(address w) internal {
        emit WalletChanged("buyback", buybackWallet, w);
        buybackWallet = w;
    }

    function _applySetGraduator(address g) internal {
        require(g != address(0), "!graduator");
        address old = graduator;
        graduator = g;
        emit WalletChanged("graduator", old, g);
    }

    function _applySetPoolFactory(address pf) internal {
        require(pf != address(0), "!poolFactory");
        address old = poolFactory;
        poolFactory = pf;
        emit WalletChanged("poolFactory", old, pf);
    }
    function _applySetMonshiStakingPool(address p) internal {
        emit WalletChanged("monshiPool", monshiStakingPool, p);
        monshiStakingPool = p;
    }
    
    // ── ADMIN: ECONOMICS (timelocked for critical) ────
    function _applySetCreationFee(uint256 v) internal {
        emit ParamChanged("creationFee", creationFee, v);
        creationFee = v;
    }
    function _applySetMaxDevBuyBps(uint256 v) internal {
        require(v <= 1000, "max 10%"); // safety ceiling
        emit ParamChanged("maxDevBuyBps", maxDevBuyBps, v);
        maxDevBuyBps = v;
    }
    function _applySetMinDevBuyMon(uint256 v) internal {
        emit ParamChanged("minDevBuyMon", minDevBuyMon, v);
        minDevBuyMon = v;
    }
    function _applySetGraduationTarget(uint256 v) internal {
        require(v >= graduationLP + graduationCreatorReward, "target < LP+reward");
        emit ParamChanged("graduationTarget", graduationTarget, v);
        graduationTarget = v;
    }
    function _applySetGraduationLP(uint256 v) internal {
        emit ParamChanged("graduationLP", graduationLP, v);
        graduationLP = v;
    }
    function _applySetGraduationCreatorReward(uint256 v) internal {
        emit ParamChanged("graduationCreatorReward", graduationCreatorReward, v);
        graduationCreatorReward = v;
    }
    
    // ── ADMIN: FEE SPLITS ─────────────────────
    function _applySetFeeSplits(
        uint16 _buyCreator,
        uint16 _buyBuffer,
        uint16 _sellCreator,
        uint16 _sellStaking,
        uint16 _sellPlatform
    ) internal {
        require(_buyCreator + _buyBuffer <= 1000, "buy fees > 10%");
        require(_sellCreator + _sellStaking + _sellPlatform <= 1000, "sell fees > 10%");
        emit ParamChanged("buyFeeCreatorBps",   buyFeeCreatorBps,   _buyCreator);
        emit ParamChanged("buyFeeBufferBps",    buyFeeBufferBps,    _buyBuffer);
        emit ParamChanged("sellFeeCreatorBps",  sellFeeCreatorBps,  _sellCreator);
        emit ParamChanged("sellFeeStakingBps",  sellFeeStakingBps,  _sellStaking);
        emit ParamChanged("sellFeePlatformBps", sellFeePlatformBps, _sellPlatform);
        buyFeeCreatorBps = _buyCreator;
        buyFeeBufferBps = _buyBuffer;
        sellFeeCreatorBps = _sellCreator;
        sellFeeStakingBps = _sellStaking;
        sellFeePlatformBps = _sellPlatform;
    }
    
    // ── ADMIN: BACK-FILL CURVE AUTHORIZATION (V2.1-1 companion) ──
    /// @notice Bulk authorize existing curves in the current rewardRouter (Hub).
    ///         Use after a rewardRouter rotation, or for any curves that were launched before
    ///         bootstrapInit set rewardRouter for the first time.
    /// @dev    Hub.setCurveAuthorized's onlyFactory modifier means only this contract can
    ///         perform the call; this exposes that capability behind onlyOwner.
    function backfillCurveAuthorization(address[] calldata curves) external onlyOwner {
        require(rewardRouter != address(0), "!rewardRouter");
        require(rewardRouter.code.length > 0, "!hub contract");
        IStakingHub hub = IStakingHub(rewardRouter);
        for (uint256 i = 0; i < curves.length; i++) {
            hub.setCurveAuthorized(curves[i], true);
        }
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

    /// @notice Read original creator of a launched token by walking through tokToCurve registry.
    /// @dev Returns address(0) if token has no curve. Used by MonPadPoolFactory for creator determination.
    function creatorOf(address token) external view returns (address) {
        address curve = tokToCurve[token];
        if (curve == address(0)) return address(0);
        return MonPadCurveV2(payable(curve)).creator();
    }

    // ============================================================
    //                 TIMELOCK INFRASTRUCTURE (V2.1)
    // 24h queue/execute on 12 critical setters. One pending op per
    // setter (overwrite-on-propose). cancelOp(key) zeros the slot.
    // Excluded: setBlocked (emergency), transferOwnership (2-step).
    // ============================================================

    struct Pending {
        uint64 readyAt;
        bytes  encodedValue;
    }

    mapping(bytes32 => Pending) public pendingOps;

    // Op keys (one per timelocked setter)
    bytes32 public constant OP_REWARD_ROUTER       = keccak256("setRewardRouter");
    bytes32 public constant OP_PLATFORM_WALLET     = keccak256("setPlatformWallet");
    bytes32 public constant OP_TREASURY_WALLET     = keccak256("setTreasuryWallet");
    bytes32 public constant OP_BUYBACK_WALLET      = keccak256("setBuybackWallet");
    bytes32 public constant OP_GRADUATOR           = keccak256("setGraduator");
    bytes32 public constant OP_POOL_FACTORY      = keccak256("setPoolFactory");
    bytes32 public constant OP_MONSHI_STAKING_POOL = keccak256("setMonshiStakingPool");
    bytes32 public constant OP_CREATION_FEE        = keccak256("setCreationFee");
    bytes32 public constant OP_MAX_DEV_BUY_BPS     = keccak256("setMaxDevBuyBps");
    bytes32 public constant OP_MIN_DEV_BUY_MON     = keccak256("setMinDevBuyMon");
    bytes32 public constant OP_GRADUATION_TARGET   = keccak256("setGraduationTarget");
    bytes32 public constant OP_GRADUATION_LP       = keccak256("setGraduationLP");
    bytes32 public constant OP_GRADUATION_CR       = keccak256("setGraduationCreatorReward");
    bytes32 public constant OP_FEE_SPLITS          = keccak256("setFeeSplits");

    event OpQueued(bytes32 indexed key, uint64 readyAt, bytes encodedValue);
    event OpExecuted(bytes32 indexed key);
    event OpCancelled(bytes32 indexed key);

    error OpNotReady(bytes32 key, uint64 readyAt, uint64 nowTs);
    error OpNotFound(bytes32 key);
    error OpValueMismatch(bytes32 key);

    /// @notice Owner cancels a queued op by key, zeroing the pending slot.
    function cancelOp(bytes32 key) external onlyOwner {
        if (pendingOps[key].readyAt == 0) revert OpNotFound(key);
        delete pendingOps[key];
        emit OpCancelled(key);
    }

    function _queue(bytes32 key, bytes memory encoded) internal {
        uint64 ra = uint64(block.timestamp) + uint64(timelockDelay);
        pendingOps[key] = Pending({ readyAt: ra, encodedValue: encoded });
        emit OpQueued(key, ra, encoded);
    }

    function _consume(bytes32 key, bytes memory expected) internal {
        Pending memory p = pendingOps[key];
        if (p.readyAt == 0) revert OpNotFound(key);
        if (uint64(block.timestamp) < p.readyAt) revert OpNotReady(key, p.readyAt, uint64(block.timestamp));
        if (keccak256(p.encodedValue) != keccak256(expected)) revert OpValueMismatch(key);
        delete pendingOps[key];
        emit OpExecuted(key);
    }

    // ─── address setters ─────────────────────────────────────
    function queueSetRewardRouter(address v) external onlyOwner { _queue(OP_REWARD_ROUTER, abi.encode(v)); }
    function executeSetRewardRouter(address v) external onlyOwner { _consume(OP_REWARD_ROUTER, abi.encode(v)); _applySetRewardRouter(v); }

    function queueSetPlatformWallet(address v) external onlyOwner { _queue(OP_PLATFORM_WALLET, abi.encode(v)); }
    function executeSetPlatformWallet(address v) external onlyOwner { _consume(OP_PLATFORM_WALLET, abi.encode(v)); _applySetPlatformWallet(v); }

    function queueSetTreasuryWallet(address v) external onlyOwner { _queue(OP_TREASURY_WALLET, abi.encode(v)); }
    function executeSetTreasuryWallet(address v) external onlyOwner { _consume(OP_TREASURY_WALLET, abi.encode(v)); _applySetTreasuryWallet(v); }

    function queueSetBuybackWallet(address v) external onlyOwner { _queue(OP_BUYBACK_WALLET, abi.encode(v)); }
    function executeSetBuybackWallet(address v) external onlyOwner { _consume(OP_BUYBACK_WALLET, abi.encode(v)); _applySetBuybackWallet(v); }

    function queueSetGraduator(address v) external onlyOwner { _queue(OP_GRADUATOR, abi.encode(v)); }
    function executeSetGraduator(address v) external onlyOwner { _consume(OP_GRADUATOR, abi.encode(v)); _applySetGraduator(v); }
    function queueSetPoolFactory(address v) external onlyOwner { _queue(OP_POOL_FACTORY, abi.encode(v)); }
    function executeSetPoolFactory(address v) external onlyOwner { _consume(OP_POOL_FACTORY, abi.encode(v)); _applySetPoolFactory(v); }

    function queueSetMonshiStakingPool(address v) external onlyOwner { _queue(OP_MONSHI_STAKING_POOL, abi.encode(v)); }
    function executeSetMonshiStakingPool(address v) external onlyOwner { _consume(OP_MONSHI_STAKING_POOL, abi.encode(v)); _applySetMonshiStakingPool(v); }

    // ─── uint256 setters ─────────────────────────────────────
    function queueSetCreationFee(uint256 v) external onlyOwner { _queue(OP_CREATION_FEE, abi.encode(v)); }
    function executeSetCreationFee(uint256 v) external onlyOwner { _consume(OP_CREATION_FEE, abi.encode(v)); _applySetCreationFee(v); }

    function queueSetMaxDevBuyBps(uint256 v) external onlyOwner { _queue(OP_MAX_DEV_BUY_BPS, abi.encode(v)); }
    function executeSetMaxDevBuyBps(uint256 v) external onlyOwner { _consume(OP_MAX_DEV_BUY_BPS, abi.encode(v)); _applySetMaxDevBuyBps(v); }

    function queueSetMinDevBuyMon(uint256 v) external onlyOwner { _queue(OP_MIN_DEV_BUY_MON, abi.encode(v)); }
    function executeSetMinDevBuyMon(uint256 v) external onlyOwner { _consume(OP_MIN_DEV_BUY_MON, abi.encode(v)); _applySetMinDevBuyMon(v); }

    function queueSetGraduationTarget(uint256 v) external onlyOwner { _queue(OP_GRADUATION_TARGET, abi.encode(v)); }
    function executeSetGraduationTarget(uint256 v) external onlyOwner { _consume(OP_GRADUATION_TARGET, abi.encode(v)); _applySetGraduationTarget(v); }

    function queueSetGraduationLP(uint256 v) external onlyOwner { _queue(OP_GRADUATION_LP, abi.encode(v)); }
    function executeSetGraduationLP(uint256 v) external onlyOwner { _consume(OP_GRADUATION_LP, abi.encode(v)); _applySetGraduationLP(v); }

    function queueSetGraduationCreatorReward(uint256 v) external onlyOwner { _queue(OP_GRADUATION_CR, abi.encode(v)); }
    function executeSetGraduationCreatorReward(uint256 v) external onlyOwner { _consume(OP_GRADUATION_CR, abi.encode(v)); _applySetGraduationCreatorReward(v); }

    // ─── 5-tuple atomic fee splits ───────────────────────────
    function queueSetFeeSplits(
        uint16 _buyCreator,
        uint16 _buyBuffer,
        uint16 _sellCreator,
        uint16 _sellStaking,
        uint16 _sellPlatform
    ) external onlyOwner {
        _queue(OP_FEE_SPLITS, abi.encode(_buyCreator, _buyBuffer, _sellCreator, _sellStaking, _sellPlatform));
    }
    function executeSetFeeSplits(
        uint16 _buyCreator,
        uint16 _buyBuffer,
        uint16 _sellCreator,
        uint16 _sellStaking,
        uint16 _sellPlatform
    ) external onlyOwner {
        _consume(OP_FEE_SPLITS, abi.encode(_buyCreator, _buyBuffer, _sellCreator, _sellStaking, _sellPlatform));
        _applySetFeeSplits(_buyCreator, _buyBuffer, _sellCreator, _sellStaking, _sellPlatform);
    }


    // ─── ONE-SHOT BOOTSTRAP (skips 24h timelock for initial wiring) ───────
    /// @notice Sets graduator, rewardRouter, poolFactory in one transaction. Callable exactly once.
    /// @dev    After bootstrapInit runs, all three addresses are governed by the standard timelock.
    function bootstrapInit(
        address _graduator,
        address _rewardRouter,
        address _poolFactory
    ) external onlyOwner {
        require(!bootstrapped, "already bootstrapped");
        require(_graduator    != address(0), "!graduator");
        require(_rewardRouter != address(0), "!rewardRouter");
        require(_poolFactory  != address(0), "!poolFactory");
        graduator    = _graduator;
        rewardRouter = _rewardRouter;
        poolFactory  = _poolFactory;
        bootstrapped = true;
        emit Bootstrapped(_graduator, _rewardRouter, _poolFactory);
    }
}

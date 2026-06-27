// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadCurveV2Monshi.sol";
import "../MonPadTokenV2.sol";

// ============================================================================
//  MonPadFactoryV2Monshi — MONSHI-denominated launch factory
// ----------------------------------------------------------------------------
//  MONSHI-native rebuild of MonPadFactoryV2. createLaunch is NO LONGER payable:
//  the creation fee and the optional dev buy are paid in MONSHI, pulled from the
//  creator via transferFrom (the creator must approve this factory first).
//
//  All other logic (timelock, fee splits, ownership, registry) is unchanged.
//  creationFee / graduationTarget / graduationCreatorReward are denominated in
//  MONSHI here.
//
//  NOT YET DEPLOYED. Draft for review + audit. See MONSHI-REBUILD.md.
// ============================================================================

interface IStakingHub {
    function setCurveAuthorized(address curve, bool authorized) external;
}

interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library Clones {
    function clone(address impl) internal returns (address result) {
        bytes20 implBytes = bytes20(impl);
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), implBytes)
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            result := create(0, ptr, 0x37)
        }
        require(result != address(0), "clone failed");
    }
}

contract MonPadFactoryV2Monshi {
    // ── OWNERSHIP ─────────────────────────────
    address public owner;
    address public pendingOwner;

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    // ── QUOTE ASSET (MONSHI) ──────────────────
    /// @notice MONSHI ERC20 — the base currency for creation fees, dev buys, and all curve trades.
    address public immutable quoteToken;

    // ── WALLETS (rotatable) ───────────────────
    address public platformWallet;
    address public treasuryWallet;
    address public buybackWallet;
    address public rewardRouter;
    address public poolFactory;
    bool    public bootstrapped;

    // ── ECONOMICS (all tunable, MONSHI units) ─
    uint256 public creationFee = 100 ether;
    uint256 public maxDevBuyBps = 200;          // 2% of supply max
    uint256 public minDevBuyMon = 0;
    uint256 public graduationTarget = 425_000 ether;
    uint256 public graduationCreatorReward = 25_000 ether;

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

    // ── TIMELOCK ──────────────────────────────
    uint256 public timelockDelay = 24 hours;

    // ── REGISTRY ──────────────────────────────
    address[] public allTokens;
    address[] public allCurves;
    mapping(address => address) public tokToCurve;
    mapping(address => bool) public isLaunched;
    mapping(address => bool) public blocked;

    address public graduator;

    address public immutable curveImpl;
    address public immutable tokenImpl;

    // ── EVENTS ────────────────────────────────
    event Launched(address indexed token, address indexed curve, address indexed creator, uint256 devAmt, string name, string symbol);
    event ParamChanged(string indexed param, uint256 oldValue, uint256 newValue);
    event WalletChanged(string indexed wallet, address oldAddr, address newAddr);
    event Bootstrapped(address graduator, address rewardRouter, address poolFactory);
    event RewardRouterChanged(address oldRouter, address newRouter);
    event TokenBlocked(address indexed token, bool blocked);
    event OwnershipTransferred(address indexed prev, address indexed next);

    constructor(address _platform, address _treasury, address _buyback, address _quoteToken) {
        require(_quoteToken != address(0), "!quote");
        owner = msg.sender;
        platformWallet = _platform;
        treasuryWallet = _treasury;
        buybackWallet = _buyback;
        quoteToken = _quoteToken;

        curveImpl = address(new MonPadCurveV2Monshi());
        tokenImpl = address(new MonPadTokenV2());

        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── LAUNCH ────────────────────────────────
    /// @notice Launch a new token paying in MONSHI. Creator must approve this factory for
    ///         at least `quoteAmount` MONSHI. `quoteAmount` = creationFee + optional dev buy.
    /// @param cfg Per-launch creator tokenomics (fee routing + per-trade tax). Editable later
    ///            by the creator via MonPadCurveV2Monshi.setFeeConfig.
    function createLaunch(
        string calldata name,
        string calldata symbol,
        uint256 quoteAmount,
        FeeConfig calldata cfg
    ) external returns (address token, address curve) {
        require(!pauseNewLaunches, "launches paused");
        require(quoteAmount >= creationFee, "insufficient fee");
        uint256 devBuy = quoteAmount - creationFee;
        if (devBuy > 0) require(devBuy >= minDevBuyMon, "dev buy < min");

        // Clone token + curve.
        token = Clones.clone(tokenImpl);
        MonPadTokenV2(token).initialize(name, symbol, 1_000_000_000 ether);

        curve = Clones.clone(curveImpl);
        MonPadCurveV2Monshi(curve).initialize(token, msg.sender, address(this), quoteToken, cfg);

        MonPadTokenV2(token).setCurve(curve);

        if (rewardRouter != address(0) && rewardRouter.code.length > 0) {
            IStakingHub(rewardRouter).setCurveAuthorized(curve, true);
        }

        // Pay creation fee to treasury in MONSHI (pulled from creator).
        _safeTransferFrom(quoteToken, msg.sender, treasuryWallet, creationFee);

        // Atomic dev buy: push MONSHI into the curve, then trigger devBuy.
        if (devBuy > 0) {
            _safeTransferFrom(quoteToken, msg.sender, curve, devBuy);
            MonPadCurveV2Monshi(curve).devBuy(msg.sender, devBuy);
        }

        allTokens.push(token);
        allCurves.push(curve);
        tokToCurve[token] = curve;
        isLaunched[token] = true;

        emit Launched(token, curve, msg.sender, devBuy, name, symbol);
    }

    // ── REWARD ROUTER ─────────────────────────
    function getRewardRecipient() external view returns (address) {
        return rewardRouter == address(0) ? buybackWallet : rewardRouter;
    }

    function _applySetRewardRouter(address _router) internal {
        emit RewardRouterChanged(rewardRouter, _router);
        rewardRouter = _router;
        uint256 n = allCurves.length;
        if (_router != address(0) && _router.code.length > 0 && n > 0) {
            if (n > 200) revert TooManyCurvesForAtomicRotation(n);
            IStakingHub hub = IStakingHub(_router);
            for (uint256 i = 0; i < n; i++) {
                hub.setCurveAuthorized(allCurves[i], true);
            }
        }
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

    // ── ADMIN: ECONOMICS ──────────────────────
    function _applySetCreationFee(uint256 v) internal {
        emit ParamChanged("creationFee", creationFee, v);
        creationFee = v;
    }
    function _applySetMaxDevBuyBps(uint256 v) internal {
        require(v <= 1000, "max 10%");
        emit ParamChanged("maxDevBuyBps", maxDevBuyBps, v);
        maxDevBuyBps = v;
    }
    function _applySetMinDevBuyMon(uint256 v) internal {
        emit ParamChanged("minDevBuyMon", minDevBuyMon, v);
        minDevBuyMon = v;
    }
    function _applySetGraduationTarget(uint256 v) internal {
        require(v >= 400_000 ether + graduationCreatorReward, "target < LP+reward");
        emit ParamChanged("graduationTarget", graduationTarget, v);
        graduationTarget = v;
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

    // ── OWNERSHIP TRANSFER (2-step) ───────────
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
    function getCurveSettings() external view returns (uint16, uint16, uint16, uint16, uint16) {
        return (buyFeeCreatorBps, buyFeeBufferBps, sellFeeCreatorBps, sellFeeStakingBps, sellFeePlatformBps);
    }

    function creatorOf(address token) external view returns (address) {
        address curve = tokToCurve[token];
        if (curve == address(0)) return address(0);
        return MonPadCurveV2Monshi(curve).creator();
    }

    // ── TIMELOCK ──────────────────────────────
    struct Pending {
        uint64 readyAt;
        bytes  encodedValue;
    }
    mapping(bytes32 => Pending) public pendingOps;

    bytes32 public constant OP_REWARD_ROUTER       = keccak256("setRewardRouter");
    bytes32 public constant OP_PLATFORM_WALLET     = keccak256("setPlatformWallet");
    bytes32 public constant OP_TREASURY_WALLET     = keccak256("setTreasuryWallet");
    bytes32 public constant OP_BUYBACK_WALLET      = keccak256("setBuybackWallet");
    bytes32 public constant OP_GRADUATOR           = keccak256("setGraduator");
    bytes32 public constant OP_POOL_FACTORY        = keccak256("setPoolFactory");
    bytes32 public constant OP_CREATION_FEE        = keccak256("setCreationFee");
    bytes32 public constant OP_MAX_DEV_BUY_BPS     = keccak256("setMaxDevBuyBps");
    bytes32 public constant OP_MIN_DEV_BUY_MON     = keccak256("setMinDevBuyMon");
    bytes32 public constant OP_GRADUATION_TARGET   = keccak256("setGraduationTarget");
    bytes32 public constant OP_GRADUATION_CR       = keccak256("setGraduationCreatorReward");
    bytes32 public constant OP_FEE_SPLITS          = keccak256("setFeeSplits");

    event OpQueued(bytes32 indexed key, uint64 readyAt, bytes encodedValue);
    event OpExecuted(bytes32 indexed key);
    event OpCancelled(bytes32 indexed key);

    error OpNotReady(bytes32 key, uint64 readyAt, uint64 nowTs);
    error OpNotFound(bytes32 key);
    error OpValueMismatch(bytes32 key);
    error TooManyCurvesForAtomicRotation(uint256 count);

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

    function queueSetCreationFee(uint256 v) external onlyOwner { _queue(OP_CREATION_FEE, abi.encode(v)); }
    function executeSetCreationFee(uint256 v) external onlyOwner { _consume(OP_CREATION_FEE, abi.encode(v)); _applySetCreationFee(v); }

    function queueSetMaxDevBuyBps(uint256 v) external onlyOwner { _queue(OP_MAX_DEV_BUY_BPS, abi.encode(v)); }
    function executeSetMaxDevBuyBps(uint256 v) external onlyOwner { _consume(OP_MAX_DEV_BUY_BPS, abi.encode(v)); _applySetMaxDevBuyBps(v); }

    function queueSetMinDevBuyMon(uint256 v) external onlyOwner { _queue(OP_MIN_DEV_BUY_MON, abi.encode(v)); }
    function executeSetMinDevBuyMon(uint256 v) external onlyOwner { _consume(OP_MIN_DEV_BUY_MON, abi.encode(v)); _applySetMinDevBuyMon(v); }

    function queueSetGraduationTarget(uint256 v) external onlyOwner { _queue(OP_GRADUATION_TARGET, abi.encode(v)); }
    function executeSetGraduationTarget(uint256 v) external onlyOwner { _consume(OP_GRADUATION_TARGET, abi.encode(v)); _applySetGraduationTarget(v); }

    function queueSetGraduationCreatorReward(uint256 v) external onlyOwner { _queue(OP_GRADUATION_CR, abi.encode(v)); }
    function executeSetGraduationCreatorReward(uint256 v) external onlyOwner { _consume(OP_GRADUATION_CR, abi.encode(v)); _applySetGraduationCreatorReward(v); }

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

    // ── ONE-SHOT BOOTSTRAP ────────────────────
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
        _applySetRewardRouter(_rewardRouter);
        poolFactory  = _poolFactory;
        bootstrapped = true;
        emit Bootstrapped(_graduator, _rewardRouter, _poolFactory);
    }

    // ── MONSHI pull helper ────────────────────
    function _safeTransferFrom(address tok, address from, address to, uint256 amt) internal {
        (bool ok, bytes memory data) = tok.call(
            abi.encodeWithSelector(IERC20Min.transferFrom.selector, from, to, amt)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "safeTransferFrom fail");
    }
}

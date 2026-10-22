// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadCurveV3.sol";
import "../MonPadTokenV2.sol";

// ============================================================================
//  MonPadFactoryV3 — native-MON launch factory
// ----------------------------------------------------------------------------
//  createLaunch is payable: msg.value = creationFee + optional dev buy (native
//  MON). Clones a token + curve (EIP-1167) and initializes them atomically in
//  this tx (closes the curve's init front-run window). Emits a DexScreener-grade
//  `Launch` event so an indexer can discover each curve clone.
//
//  MONSHI utility: holders of >= monshiDiscountThreshold MONSHI get a discounted
//  creation fee. (The per-curve sell "buyback" slice -> MONSHI buyback wallet is
//  handled in the curve.)
//
//  NOT YET DEPLOYED. Draft for review + self-audit.
// ============================================================================

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
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

contract MonPadFactoryV3 {
    // ── OWNERSHIP ─────────────────────────────
    address public owner;
    address public pendingOwner;
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ── IMMUTABLES ────────────────────────────
    address public immutable wmon;          // wrapped MON (graduation LP quote + read-shim ref)
    address public immutable monshiToken;   // MONSHI (creation-fee discount perk)
    address public immutable curveImpl;
    address public immutable tokenImpl;

    // ── WALLETS ───────────────────────────────
    address public platformWallet;   // platform fee buffer
    address public treasuryWallet;   // creation fees + graduation treasury cut
    address public buybackWallet;    // MONSHI buyback recipient (default reward recipient)
    address public rewardRouter;     // optional: overrides buyback as reward recipient
    bool    public bootstrapped;
    uint256 public treasuryPending;  // accrued creation fees, pulled to treasuryWallet (audit H-1)

    // ── ECONOMICS (native MON; tunable, $5k-pegged defaults) ──
    // ⚠️ TEST ECONOMICS (low-fee end-to-end test deploy). Production values were
    //    500 / 260_000 / 41_700 / 10_400 — restore those before the real launch.
    uint256 public creationFee = 1 ether;                // TEST: 1 MON to create
    /// @dev Slice of the creation fee seeded into each new curve as a real-MON buffer
    ///      (immediate exit liquidity + removes the sole-holder full-sell rounding edge).
    ///      The remainder of the fee accrues to treasuryPending. Must be <= creationFee
    ///      or NO buffer is seeded (the `fee >= CREATION_BUFFER_MON` gate in createLaunch).
    ///      TEST: 0.2 MON (fits the 1 MON creation fee). PRODUCTION: restore to 100 ether.
    uint256 public constant CREATION_BUFFER_MON = 0.2 ether;
    uint256 public maxDevBuyBps = 200;                   // 2% supply cap on dev buy
    uint256 public minDevBuyMon = 0;
    uint256 public graduationTarget = 20 ether;          // TEST: graduate at 20 MON
    uint256 public graduationCreatorReward = 10 ether;   // TEST
    uint256 public graduationTreasuryCut = 2 ether;      // TEST

    // MONSHI discount
    uint256 public monshiDiscountThreshold = 1_000_000 ether; // hold >= this MONSHI
    uint16  public monshiDiscountBps = 5000;                  // 50% off creation fee

    // Fee splits (bps). buyFee* + MAX_TRADE_TAX + protocol skims <= 10000.
    // Monpad protocol (Minta-port spec): on every trade, curve also applies
    //   10% burn traded token + 10% MONSHI buyback-burn + 10% platform (quote-only on sells).
    // Creator tax (FeeConfig) stays independent / creator-set.
    // Sale-layer creator share target: 80% (CREATOR_SALE_SHARE_BPS in frontend fees.ts).
    uint16 public buyFeeCreatorBps = 100;     // base creator fee (creator tax stacks on top)
    uint16 public buyFeeBufferBps = 0;        // retired — platform taken via protocolPlatformBps on curve
    uint16 public sellFeeCreatorBps = 50;     // base creator fee on sells
    uint16 public sellFeeStakingBps = 1000;   // 10% -> MONSHI buyback-and-burn (quote)
    uint16 public sellFeePlatformBps = 1000;  // 10% platform (MON only — never project tokens)
    uint16 public protocolBurnTokenBps = 1000; // 10% burn traded token (curve-enforced)
    uint16 public constant MAX_TRADE_TAX_BPS = 1000; // mirror of curve cap (headroom reserve)
    /// @dev Buyback skim on the creator's per-trade tax ABOVE the 2% free threshold:
    ///      the MONSHI buyback takes `taxSkimRateBps`/10000 of the excess tax (default 25%).
    ///      Snapshotted per-curve at launch. 0 = creator keeps the whole tax.
    uint256 public taxSkimRateBps = 2500;

    // ── PAUSES / TIMELOCK ─────────────────────
    bool public pauseNewLaunches;
    bool public pauseAllBuys;
    bool public pauseAllSells;
    uint256 public timelockDelay = 24 hours;

    // ── REGISTRY ──────────────────────────────
    address[] public allTokens;
    address[] public allCurves;
    mapping(address => address) public tokToCurve;
    mapping(address => bool) public isLaunched;
    mapping(address => bool) public blocked;
    address public graduator;

    // ── EVENTS ────────────────────────────────
    /// @notice DexScreener-grade per-launch creation event (watch this to discover curve clones).
    event Launch(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string  name,
        string  symbol,
        address quoteToken,            // WMON (USD reference)
        uint256 totalSupply,
        uint256 virtualMonReserve,
        uint256 virtualTokenReserve,
        uint256 createdAt
    );
    event ParamChanged(string indexed param, uint256 oldValue, uint256 newValue);
    event WalletChanged(string indexed wallet, address oldAddr, address newAddr);
    event Bootstrapped(address graduator, address rewardRouter);
    event TokenBlocked(address indexed token, bool blocked);
    event OwnershipTransferred(address indexed prev, address indexed next);

    constructor(address _platform, address _treasury, address _buyback, address _wmon, address _monshi) {
        require(_wmon != address(0), "!wmon");
        owner = msg.sender;
        platformWallet = _platform;
        treasuryWallet = _treasury;
        buybackWallet = _buyback;
        wmon = _wmon;
        monshiToken = _monshi; // may be address(0) to disable the discount
        curveImpl = address(new MonPadCurveV3());
        tokenImpl = address(new MonPadTokenV2());
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ── LAUNCH ────────────────────────────────
    /// @notice Launch a token. msg.value = creationFee (after any MONSHI discount) + optional dev buy.
    function createLaunch(
        string calldata name,
        string calldata symbol,
        FeeConfig calldata cfg
    ) external payable nonReentrant returns (address token, address curve) {
        require(!pauseNewLaunches, "launches paused");
        require(bootstrapped, "not bootstrapped"); // graduator/reward recipient wired (audit L-4)
        uint256 fee = creationFeeFor(msg.sender);
        require(msg.value >= fee, "insufficient fee");
        uint256 devBuy = msg.value - fee;
        if (devBuy > 0) require(devBuy >= minDevBuyMon, "dev buy < min");

        // Carve a real-MON buffer out of the fee; the rest accrues to treasury (pull).
        uint256 buffer = fee >= CREATION_BUFFER_MON ? CREATION_BUFFER_MON : 0;

        token = Clones.clone(tokenImpl);
        MonPadTokenV2(token).initialize(name, symbol, 1_000_000_000 ether);

        curve = Clones.clone(curveImpl);
        // Curve reads economics + wmon from this factory (msg.sender) and binds factory=this.
        // Forward the buffer as msg.value -> seeds the curve's realMonReserve.
        MonPadCurveV3(payable(curve)).initialize{value: buffer}(token, msg.sender, cfg);

        MonPadTokenV2(token).setCurve(curve);

        treasuryPending += fee - buffer; // pull pattern — claimable via claimTreasury() (audit H-1)

        if (devBuy > 0) {
            MonPadCurveV3(payable(curve)).devBuy{value: devBuy}(msg.sender);
        }

        allTokens.push(token);
        allCurves.push(curve);
        tokToCurve[token] = curve;
        isLaunched[token] = true;

        emit Launch(
            token, curve, msg.sender, name, symbol, wmon, 1_000_000_000 ether,
            MonPadCurveV3(payable(curve)).virtualMonReserve(),
            MonPadCurveV3(payable(curve)).virtualTokenReserve(),
            block.timestamp
        );
    }

    /// @notice Effective creation fee for an account (applies the MONSHI holder discount).
    function creationFeeFor(address account) public view returns (uint256) {
        if (
            monshiToken != address(0) &&
            monshiDiscountBps > 0 &&
            IERC20Min(monshiToken).balanceOf(account) >= monshiDiscountThreshold
        ) {
            return (creationFee * (10000 - monshiDiscountBps)) / 10000;
        }
        return creationFee;
    }

    // ── REWARD RECIPIENT (MONSHI buyback) ─────
    function getRewardRecipient() external view returns (address) {
        return rewardRouter == address(0) ? buybackWallet : rewardRouter;
    }

    // ── TREASURY PULL (creation fees) ─────────
    event TreasuryClaimed(uint256 amount, address to);
    /// @notice Pull accrued creation fees to the treasury wallet. Permissionless (audit H-1).
    function claimTreasury() external nonReentrant {
        uint256 amt = treasuryPending;
        require(amt > 0, "nothing");
        treasuryPending = 0;
        address t = treasuryWallet;
        require(t != address(0), "treasury=0");
        (bool ok, ) = t.call{value: amt}("");
        require(ok, "treasury pay failed");
        emit TreasuryClaimed(amt, t);
    }

    // ── VIEWS used by the curve ───────────────
    function allCounts() external view returns (uint256 t, uint256 c) { return (allTokens.length, allCurves.length); }
    function creatorOf(address token) external view returns (address) {
        address curve = tokToCurve[token];
        if (curve == address(0)) return address(0);
        return MonPadCurveV3(payable(curve)).creator();
    }

    // ── ADMIN APPLY ───────────────────────────
    function _applySetPlatformWallet(address w) internal { emit WalletChanged("platform", platformWallet, w); platformWallet = w; }
    function _applySetTreasuryWallet(address w) internal { emit WalletChanged("treasury", treasuryWallet, w); treasuryWallet = w; }
    function _applySetBuybackWallet(address w) internal { emit WalletChanged("buyback", buybackWallet, w); buybackWallet = w; }
    function _applySetRewardRouter(address w) internal { emit WalletChanged("rewardRouter", rewardRouter, w); rewardRouter = w; }
    function _applySetGraduator(address g) internal { require(g != address(0), "!graduator"); emit WalletChanged("graduator", graduator, g); graduator = g; }

    function _applySetCreationFee(uint256 v) internal { emit ParamChanged("creationFee", creationFee, v); creationFee = v; }
    function _applySetMaxDevBuyBps(uint256 v) internal { require(v <= 1000, "max 10%"); emit ParamChanged("maxDevBuyBps", maxDevBuyBps, v); maxDevBuyBps = v; }
    function _applySetTaxSkimRate(uint256 v) internal { require(v <= 10000, "max 100%"); emit ParamChanged("taxSkimRateBps", taxSkimRateBps, v); taxSkimRateBps = v; }
    function _applySetMinDevBuyMon(uint256 v) internal { emit ParamChanged("minDevBuyMon", minDevBuyMon, v); minDevBuyMon = v; }
    function _applySetGraduationTarget(uint256 v) internal {
        require(v > graduationCreatorReward + graduationTreasuryCut, "target < payouts");
        emit ParamChanged("graduationTarget", graduationTarget, v); graduationTarget = v;
    }
    function _applySetGraduationCreatorReward(uint256 v) internal {
        require(v + graduationTreasuryCut <= graduationTarget, "reward+cut > target"); // audit L-1
        emit ParamChanged("graduationCreatorReward", graduationCreatorReward, v); graduationCreatorReward = v;
    }
    function _applySetGraduationTreasuryCut(uint256 v) internal {
        require(graduationCreatorReward + v <= graduationTarget, "reward+cut > target"); // audit L-1
        emit ParamChanged("graduationTreasuryCut", graduationTreasuryCut, v); graduationTreasuryCut = v;
    }
    function _applySetMonshiDiscount(uint256 threshold, uint16 bps) internal {
        require(bps <= 9000, "bps>90%"); // never fully zero the anti-spam fee (audit L-2)
        emit ParamChanged("monshiDiscountThreshold", monshiDiscountThreshold, threshold);
        emit ParamChanged("monshiDiscountBps", monshiDiscountBps, bps);
        monshiDiscountThreshold = threshold; monshiDiscountBps = bps;
    }

    /// @dev Caps reserve MAX_TRADE_TAX_BPS of headroom so curve trade math can never underflow (audit L-1).
    function _applySetFeeSplits(uint16 _bc, uint16 _bb, uint16 _sc, uint16 _ss, uint16 _sp) internal {
        require(uint256(_bc) + _bb + MAX_TRADE_TAX_BPS <= 10000, "buy fees+tax > 100%");
        require(uint256(_sc) + _ss + _sp + MAX_TRADE_TAX_BPS <= 10000, "sell fees+tax > 100%");
        buyFeeCreatorBps = _bc; buyFeeBufferBps = _bb;
        sellFeeCreatorBps = _sc; sellFeeStakingBps = _ss; sellFeePlatformBps = _sp;
        emit ParamChanged("feeSplits", 0, 0);
    }

    // ── PAUSES / BLOCKLIST ────────────────────
    function setPauseNewLaunches(bool v) external onlyOwner { pauseNewLaunches = v; }
    function setPauseAllBuys(bool v) external onlyOwner { pauseAllBuys = v; }
    function setPauseAllSells(bool v) external onlyOwner { pauseAllSells = v; }
    function setBlocked(address tok, bool b) external onlyOwner { blocked[tok] = b; emit TokenBlocked(tok, b); }

    // ── OWNERSHIP (2-step) ────────────────────
    function transferOwnership(address next) external onlyOwner { pendingOwner = next; }
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "!pending");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner; pendingOwner = address(0);
    }

    // ── BOOTSTRAP (one-shot) ──────────────────
    function bootstrapInit(address _graduator, address _rewardRouter) external onlyOwner {
        require(!bootstrapped, "already bootstrapped");
        require(_graduator != address(0), "!graduator");
        graduator = _graduator;
        if (_rewardRouter != address(0)) _applySetRewardRouter(_rewardRouter);
        bootstrapped = true;
        emit Bootstrapped(_graduator, _rewardRouter);
    }

    // ── TIMELOCK ──────────────────────────────
    struct Pending { uint64 readyAt; bytes encodedValue; }
    mapping(bytes32 => Pending) public pendingOps;

    bytes32 public constant OP_PLATFORM_WALLET   = keccak256("setPlatformWallet");
    bytes32 public constant OP_TREASURY_WALLET   = keccak256("setTreasuryWallet");
    bytes32 public constant OP_BUYBACK_WALLET    = keccak256("setBuybackWallet");
    bytes32 public constant OP_REWARD_ROUTER     = keccak256("setRewardRouter");
    bytes32 public constant OP_GRADUATOR         = keccak256("setGraduator");
    bytes32 public constant OP_CREATION_FEE      = keccak256("setCreationFee");
    bytes32 public constant OP_MAX_DEV_BUY_BPS   = keccak256("setMaxDevBuyBps");
    bytes32 public constant OP_MIN_DEV_BUY_MON   = keccak256("setMinDevBuyMon");
    bytes32 public constant OP_GRAD_TARGET       = keccak256("setGraduationTarget");
    bytes32 public constant OP_GRAD_CREATOR      = keccak256("setGraduationCreatorReward");
    bytes32 public constant OP_GRAD_TREASURY     = keccak256("setGraduationTreasuryCut");
    bytes32 public constant OP_MONSHI_DISCOUNT   = keccak256("setMonshiDiscount");
    bytes32 public constant OP_FEE_SPLITS        = keccak256("setFeeSplits");
    bytes32 public constant OP_TAX_SKIM          = keccak256("setTaxSkimRate");

    event OpQueued(bytes32 indexed key, uint64 readyAt, bytes encodedValue);
    event OpExecuted(bytes32 indexed key);
    event OpCancelled(bytes32 indexed key);
    error OpNotReady(bytes32 key, uint64 readyAt, uint64 nowTs);
    error OpNotFound(bytes32 key);
    error OpValueMismatch(bytes32 key);

    function cancelOp(bytes32 key) external onlyOwner {
        if (pendingOps[key].readyAt == 0) revert OpNotFound(key);
        delete pendingOps[key]; emit OpCancelled(key);
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
        delete pendingOps[key]; emit OpExecuted(key);
    }

    function queueSetPlatformWallet(address v) external onlyOwner { _queue(OP_PLATFORM_WALLET, abi.encode(v)); }
    function executeSetPlatformWallet(address v) external onlyOwner { _consume(OP_PLATFORM_WALLET, abi.encode(v)); _applySetPlatformWallet(v); }
    function queueSetTreasuryWallet(address v) external onlyOwner { _queue(OP_TREASURY_WALLET, abi.encode(v)); }
    function executeSetTreasuryWallet(address v) external onlyOwner { _consume(OP_TREASURY_WALLET, abi.encode(v)); _applySetTreasuryWallet(v); }
    function queueSetBuybackWallet(address v) external onlyOwner { _queue(OP_BUYBACK_WALLET, abi.encode(v)); }
    function executeSetBuybackWallet(address v) external onlyOwner { _consume(OP_BUYBACK_WALLET, abi.encode(v)); _applySetBuybackWallet(v); }
    function queueSetRewardRouter(address v) external onlyOwner { _queue(OP_REWARD_ROUTER, abi.encode(v)); }
    function executeSetRewardRouter(address v) external onlyOwner { _consume(OP_REWARD_ROUTER, abi.encode(v)); _applySetRewardRouter(v); }
    function queueSetGraduator(address v) external onlyOwner { _queue(OP_GRADUATOR, abi.encode(v)); }
    function executeSetGraduator(address v) external onlyOwner { _consume(OP_GRADUATOR, abi.encode(v)); _applySetGraduator(v); }

    function queueSetCreationFee(uint256 v) external onlyOwner { _queue(OP_CREATION_FEE, abi.encode(v)); }
    function executeSetCreationFee(uint256 v) external onlyOwner { _consume(OP_CREATION_FEE, abi.encode(v)); _applySetCreationFee(v); }
    function queueSetMaxDevBuyBps(uint256 v) external onlyOwner { _queue(OP_MAX_DEV_BUY_BPS, abi.encode(v)); }
    function executeSetMaxDevBuyBps(uint256 v) external onlyOwner { _consume(OP_MAX_DEV_BUY_BPS, abi.encode(v)); _applySetMaxDevBuyBps(v); }
    function queueSetTaxSkimRate(uint256 v) external onlyOwner { _queue(OP_TAX_SKIM, abi.encode(v)); }
    function executeSetTaxSkimRate(uint256 v) external onlyOwner { _consume(OP_TAX_SKIM, abi.encode(v)); _applySetTaxSkimRate(v); }
    function queueSetMinDevBuyMon(uint256 v) external onlyOwner { _queue(OP_MIN_DEV_BUY_MON, abi.encode(v)); }
    function executeSetMinDevBuyMon(uint256 v) external onlyOwner { _consume(OP_MIN_DEV_BUY_MON, abi.encode(v)); _applySetMinDevBuyMon(v); }
    function queueSetGraduationTarget(uint256 v) external onlyOwner { _queue(OP_GRAD_TARGET, abi.encode(v)); }
    function executeSetGraduationTarget(uint256 v) external onlyOwner { _consume(OP_GRAD_TARGET, abi.encode(v)); _applySetGraduationTarget(v); }
    function queueSetGraduationCreatorReward(uint256 v) external onlyOwner { _queue(OP_GRAD_CREATOR, abi.encode(v)); }
    function executeSetGraduationCreatorReward(uint256 v) external onlyOwner { _consume(OP_GRAD_CREATOR, abi.encode(v)); _applySetGraduationCreatorReward(v); }
    function queueSetGraduationTreasuryCut(uint256 v) external onlyOwner { _queue(OP_GRAD_TREASURY, abi.encode(v)); }
    function executeSetGraduationTreasuryCut(uint256 v) external onlyOwner { _consume(OP_GRAD_TREASURY, abi.encode(v)); _applySetGraduationTreasuryCut(v); }

    function queueSetMonshiDiscount(uint256 threshold, uint16 bps) external onlyOwner { _queue(OP_MONSHI_DISCOUNT, abi.encode(threshold, bps)); }
    function executeSetMonshiDiscount(uint256 threshold, uint16 bps) external onlyOwner { _consume(OP_MONSHI_DISCOUNT, abi.encode(threshold, bps)); _applySetMonshiDiscount(threshold, bps); }

    function queueSetFeeSplits(uint16 _bc, uint16 _bb, uint16 _sc, uint16 _ss, uint16 _sp) external onlyOwner { _queue(OP_FEE_SPLITS, abi.encode(_bc, _bb, _sc, _ss, _sp)); }
    function executeSetFeeSplits(uint16 _bc, uint16 _bb, uint16 _sc, uint16 _ss, uint16 _sp) external onlyOwner { _consume(OP_FEE_SPLITS, abi.encode(_bc, _bb, _sc, _ss, _sp)); _applySetFeeSplits(_bc, _bb, _sc, _ss, _sp); }

    // No open receive(): the factory only takes MON via payable createLaunch, and creation fees
    // are held as treasuryPending until claimTreasury(). Stray sends revert (audit L-3).
}

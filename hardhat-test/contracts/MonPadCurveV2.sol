// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;


interface IFactoryExt {
    function maxDevBuyBps() external view returns (uint256);
}

interface IFactory {
    function platformWallet() external view returns (address);
    function getRewardRecipient() external view returns (address);
    function buyFeeCreatorBps() external view returns (uint16);
    function buyFeeBufferBps() external view returns (uint16);
    function sellFeeCreatorBps() external view returns (uint16);
    function sellFeeStakingBps() external view returns (uint16);
    function sellFeePlatformBps() external view returns (uint16);
    function graduationTarget() external view returns (uint256);
    function graduationLP() external view returns (uint256);
    function graduationCreatorReward() external view returns (uint256);
    function pauseAllBuys() external view returns (bool);
    function pauseAllSells() external view returns (bool);
    function blocked(address tok) external view returns (bool);
    function owner() external view returns (address);
    function graduator() external view returns (address);
}

interface IGraduator {
    function onGraduate(address token, uint256 lpTokens) external payable;
}

interface IToken {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IRewardRouter {
    function notifyReward(address token) external payable;
}

/// @title MonPadCurveV2
/// @notice Bonding curve with admin-tunable fees. One per token.
/// @dev EIP-1167 minimal-proxy design: this contract is deployed ONCE as an implementation
///      template. The factory then creates one clone (a tiny proxy that delegate-calls into
///      this code) per token launch. Cloning costs ~50K gas vs ~3M for `new MonPadCurveV2`,
///      and the factory's bytecode no longer embeds the curve's full creation code (which is
///      what was pushing factory over EIP-170's 24,576-byte limit).
///
///      Because clones don't run the implementation's constructor, all per-launch state is
///      set in `initialize(...)`. The implementation's own constructor sets `_initialized=true`
///      so the impl itself can never be initialized — only its clones can.
contract MonPadCurveV2 {
    // Was immutable. Moved to storage so each clone can populate them via `initialize`.
    address public token;
    address public creator;
    address public factory;
    
    uint256 public monRaised;          // gross MON in (before fees)
    uint256 public monRaisedNet;       // net MON in curve toward grad
    // V2.1 BATCH 3: pull accumulators (was: buyBuffer push at graduation)
    uint256 public platformPending;           // 1% buy + 1% sell, pulled via claimPlatformBuffer()
    uint256 public creatorGraduationPending;  // 25k MON reserved at graduation, pulled by creator
    bool    public creatorGraduationClaimed;  // single-use flag for claimGraduationReward()
    uint256 public ath;                // all-time-high mcap
    uint256 public launchedAt;
    uint256 public devTokenAmount;     // tokens dev got at launch
    
    // Fees collected — public for stats
    uint256 public totalCreatorFees;   // total MON earned by creator (paid + pending)
    uint256 public totalPlatformFees;  // total MON sent to platform
    uint256 public totalStakingFees;   // total MON sent to staking/buyback

    // V2.1-5: pull-pattern accumulator for creator buy/sell fees.
    // Eliminates the reentrancy surface where a malicious-creator contract reentered
    // buy/sell mid-flow (push happened before reserve state updates). Buy/sell now credit
    // creatorPending, which the creator withdraws via claimCreatorRewards().
    // Note: graduation reward (25k MON) is still pushed directly because graduated=true
    // is set before that push, blocking notGraduated reentry into buy/sell/_graduate.
    uint256 public creatorPending;
    
    bool public graduated;
    bool public pauseBuys;
    bool public pauseSells;
    /// @dev Init guard — once true, initialize() reverts. Set true on the impl by its
    ///      constructor; clones start with false and are initialized by the factory.
    bool private _initialized;
    
    // Bonding curve constants
    uint256 public constant CURVE_K = 1e36;  // virtual reserve constant
    uint256 public virtualMonReserve;
    uint256 public virtualTokenReserve;
    uint256 public realMonReserve;
    uint256 public realTokenReserve;
    
    event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut, uint256 newPrice);
    event Sell(address indexed seller, uint256 tokensIn, uint256 monOut, uint256 newPrice);
    event DevBuy(address indexed dev, uint256 monIn, uint256 tokensOut);
    event Graduated(uint256 lpMon, uint256 creatorReward, uint256 platformReward);
    event FeeCollected(string kind, address to, uint256 amount);
    
    modifier notGraduated() { require(!graduated, "grad"); _; }

    // --- V2.1 BATCH 4: REENTRANCY GUARD (inline, no inheritance) ---
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    /// @notice Lock the implementation. Clones start with _initialized=false and call
    ///         initialize() exactly once (factory does this atomically in createLaunch).
    constructor() {
        _initialized = true;
        _status = _NOT_ENTERED;
    }

    /// @notice Per-clone initializer. Called by MonPadFactoryV2.createLaunch right after cloning.
    ///         Idempotent guard prevents re-initialization or grief by an arbitrary caller
    ///         post-clone (factory calls this in the same tx as the clone, atomically).
    function initialize(
        address _token,
        address _creator,
        address _factory
    ) external {
        require(!_initialized, "init");
        require(_token != address(0) && _factory != address(0), "addr0");
        _initialized = true;
        _status = _NOT_ENTERED;

        token = _token;
        creator = _creator;
        factory = _factory;
        launchedAt = block.timestamp;

        // Virtual reserves calibrated so curve graduates near 425k MON target
        // with ~21x price multiple from launch to graduation (~6% capacity buffer).
        virtualMonReserve = 117_000 ether;
        virtualTokenReserve = 1_260_000_000 ether;
        realTokenReserve = 1_000_000_000 ether;
    }
    
    // ── PRICE / VIEWS ─────────────────────────
    function priceWeiPerToken() public view returns (uint256) {
        uint256 m = virtualMonReserve + realMonReserve;
        uint256 t = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
        if (t == 0) return 0;
        return (m * 1e18) / t;
    }
    
    function bondedBps() public view returns (uint256) {
        uint256 target = IFactory(factory).graduationTarget();
        if (target == 0) return 0;
        return (monRaisedNet * 10000) / target;
    }
    
    function canGrad() public view returns (bool) {
        return monRaisedNet >= IFactory(factory).graduationTarget() && !graduated;
    }
    
    function capMon() external view returns (uint256) {
        return IFactory(factory).graduationTarget();
    }
    
    function getReserves() external view returns (uint256 vm, uint256 vt, uint256 rm, uint256 rt) {
        return (virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve);
    }
    
    // ── CORE: BUY ─────────────────────────────
    function buy(uint256 minTokensOut) external payable notGraduated nonReentrant returns (uint256) {
        require(!IFactory(factory).pauseAllBuys(), "buys paused");
        require(!IFactory(factory).blocked(token), "blocked");
        require(!pauseBuys, "buys paused (token)");
        require(msg.value > 0, "0");
        
        return _buy(msg.sender, msg.value, minTokensOut, false);
    }
    
    function devBuy(address dev) external payable returns (uint256) {
        require(msg.sender == factory, "!factory");
        require(launchedAt == block.timestamp, "after launch");
        uint256 tokensOut = _buy(dev, msg.value, 0, true);
        // Enforce dev cap: tokens received <= maxDevBuyBps of total supply
        uint256 maxBps = uint256(IFactoryExt(factory).maxDevBuyBps());
        require(tokensOut <= (1_000_000_000 ether * maxBps) / 10000, "dev buy > max %");
        devTokenAmount = tokensOut;
        emit DevBuy(dev, msg.value, tokensOut);
        return tokensOut;
    }
    
    /// @dev Stack-too-deep avoidance: pack curve-math locals into a struct so the function
    ///      compiles cleanly without requiring `viaIR` on every consumer's toolchain.
    ///      Mirrors the SellLocals pattern already used by sell().
    struct BuyLocals {
        uint256 creatorFee;
        uint256 bufferFee;
        uint256 monForBuy;
        uint256 currentMon;
        uint256 currentTokens;
        uint256 newMonReserve;
        uint256 newTokenReserve;
        uint256 mcap;
    }

    function _buy(address buyer, uint256 monIn, uint256 minOut, bool isDev) internal returns (uint256 tokensOut) {
        IFactory f = IFactory(factory);
        BuyLocals memory L;

        // Take fees off the top
        L.creatorFee = isDev ? 0 : (monIn * f.buyFeeCreatorBps()) / 10000;
        L.bufferFee  = isDev ? 0 : (monIn * f.buyFeeBufferBps()) / 10000;
        L.monForBuy  = monIn - L.creatorFee - L.bufferFee;

        // V2.1-5: accrue creator fee to pull-payment accumulator instead of pushing.
        // Creator withdraws via claimCreatorRewards(). No external call here, no reentrancy.
        if (L.creatorFee > 0) {
            creatorPending   += L.creatorFee;
            totalCreatorFees += L.creatorFee;
            emit FeeCollected("creator-buy", creator, L.creatorFee);
        }

        // Buffer stays in curve until grad
        if (L.bufferFee > 0) platformPending += L.bufferFee;

        // Curve math: x*y=k constant product on virtual reserves
        L.currentMon      = virtualMonReserve + realMonReserve;
        L.currentTokens   = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
        L.newMonReserve   = L.currentMon + L.monForBuy;
        L.newTokenReserve = (L.currentMon * L.currentTokens) / L.newMonReserve;
        tokensOut         = L.currentTokens - L.newTokenReserve;

        require(tokensOut >= minOut, "slippage");
        require(tokensOut <= realTokenReserve, "no liquidity");

        realMonReserve   += L.monForBuy;
        realTokenReserve -= tokensOut;
        monRaised        += monIn;
        monRaisedNet     += L.monForBuy;

        // Update ATH
        L.mcap = (priceWeiPerToken() * 1_000_000_000 ether) / 1e18;
        if (L.mcap > ath) ath = L.mcap;

        // Send tokens to buyer
        IToken(token).transfer(buyer, tokensOut);

        emit Buy(buyer, monIn, tokensOut, priceWeiPerToken());

        // Auto-graduate
        if (monRaisedNet >= f.graduationTarget()) {
            _graduate();
        }
    }
    
    // ── CORE: SELL ────────────────────────────
    struct SellLocals {
        uint256 grossMonOut;
        uint256 creatorFee;
        uint256 stakingFee;
        uint256 platformFee;
    }
    
    function sell(uint256 tokensIn, uint256 minMonOut) external notGraduated nonReentrant returns (uint256 monOut) {
        require(!IFactory(factory).pauseAllSells(), "sells paused");
        require(!IFactory(factory).blocked(token), "blocked");
        require(!pauseSells, "sells paused (token)");
        require(tokensIn > 0, "0");
        
        IFactory f = IFactory(factory);
        require(IToken(token).transferFrom(msg.sender, address(this), tokensIn), "xfer");
        
        SellLocals memory L;
        L.grossMonOut = _calcSellOut(tokensIn);
        require(L.grossMonOut <= realMonReserve, "no MON liquidity");
        
        realMonReserve -= L.grossMonOut;
        realTokenReserve += tokensIn;
        if (monRaisedNet > L.grossMonOut) monRaisedNet -= L.grossMonOut; else monRaisedNet = 0;
        
        L.creatorFee = (L.grossMonOut * f.sellFeeCreatorBps()) / 10000;
        L.stakingFee = (L.grossMonOut * f.sellFeeStakingBps()) / 10000;
        L.platformFee = (L.grossMonOut * f.sellFeePlatformBps()) / 10000;
        monOut = L.grossMonOut - L.creatorFee - L.stakingFee - L.platformFee;
        
        require(monOut >= minMonOut, "slippage");
        
        _distributeSellFees(L.creatorFee, L.stakingFee, L.platformFee, f);
        
        (bool sellerOk, ) = msg.sender.call{value: monOut}("");
        require(sellerOk, "seller pay fail");
        
        emit Sell(msg.sender, tokensIn, monOut, priceWeiPerToken());
    }
    
    function _calcSellOut(uint256 tokensIn) internal view returns (uint256) {
        uint256 currentMon = virtualMonReserve + realMonReserve;
        uint256 currentTokens = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
        uint256 k = currentMon * currentTokens;
        uint256 newTokenReserve = currentTokens + tokensIn;
        uint256 newMonReserve = k / newTokenReserve;
        return currentMon - newMonReserve;
    }
    
    function _distributeSellFees(uint256 creatorFee, uint256 stakingFee, uint256 platformFee, IFactory f) internal {
        // V2.1-5: accrue creator fee to pull-payment accumulator (see _buy comment).
        if (creatorFee > 0) {
            creatorPending += creatorFee;
            totalCreatorFees += creatorFee;
            emit FeeCollected("creator-sell", creator, creatorFee);
        }
        if (stakingFee > 0) {
            address recipient = f.getRewardRecipient();
            (bool routed, ) = recipient.call{value: stakingFee}(
                abi.encodeWithSignature("notifyReward(address)", token)
            );
            if (!routed) {
                (bool ok, ) = recipient.call{value: stakingFee}("");
                require(ok, "staking fee fail");
            }
            totalStakingFees += stakingFee;
            emit FeeCollected("staking-sell", recipient, stakingFee);
        }
        if (platformFee > 0) {
            // V2.1 BATCH 3: accrue sell platform fee to platformPending (was push)
            platformPending += platformFee;
            emit FeeCollected("platform-sell-accrued", IFactory(factory).platformWallet(), platformFee);
        }
    }
    
    // ── GRADUATION ────────────────────────────
    /// @dev Sanity floor that the graduator's LP_MON_MIN must not exceed. Kept in sync with
    ///      MonPadGraduator.LP_MON_MIN (1 ether). If the graduator's floor is ever raised,
    ///      this constant must move with it.
    uint256 internal constant GRAD_LP_FLOOR = 1 ether;

    function _graduate() internal {
        require(!graduated, "already");
        IFactory f = IFactory(factory);

        uint256 creatorReward = f.graduationCreatorReward();
        // V2.1 BATCH 3: platform buffer flows via platformPending pull (was: platformGets = buyBuffer)

        // V2.1-14 defensive check: confirm the curve has enough MON to make all upcoming
        // payouts BEFORE we start pushing them out and BEFORE we set graduated=true.
        // Without this, a misconfigured graduationCreatorReward (raised above what the curve
        // has spare) would revert mid-flow and bounce the triggering buy with a confusing
        // error from creator.call or graduator.onGraduate. Now we fail upfront with a clear
        // message; owner can restore via timelocked queueSetGraduationCreatorReward.
        // We also reserve creatorPending (V2.1-5) so the creator can claim their accrued
        // buy/sell fees post-graduation, and require >= GRAD_LP_FLOOR for the graduator.
        uint256 minNeeded = creatorReward + platformPending + creatorPending + GRAD_LP_FLOOR;
        require(address(this).balance >= minNeeded, "insufficient for grad");

        graduated = true;
        
        // V2.1 BATCH 3: reserve creator graduation reward for pull (claimGraduationReward)
        if (creatorReward > 0 && creator != address(0)) {
            creatorGraduationPending = creatorReward;
        }
        
        
        // V2.1-6 fix: send the curve's *entire remaining balance* to the Graduator instead of a
        // hardcoded 400_000 ether. The hardcoded value (a) made graduationLP admin-tunable in name
        // only, (b) bricked graduation if creatorReward was raised above what the curve had spare,
        // and (c) permanently stranded any overshoot MON in the curve when monRaisedNet exceeded
        // graduationTarget on the triggering buy. Graduator now accepts any amount >= LP_MON_MIN.
        // Sequence: safeTransfer tokens FIRST, then onGraduate{value: lpMon}.
        address grad = f.graduator();
        require(grad != address(0), "!graduator");
        uint256 lpTokens = IToken(token).balanceOf(address(this));
        require(lpTokens > 0, "no lp tokens");
        // V2.1-5: subtract creatorPending so the creator's accrued buy/sell fees stay in
        // the curve for them to claim post-graduation. Without this, claimCreatorRewards()
        // would underflow / fail because the entire balance went to the graduator.
        uint256 lpMon = address(this).balance - creatorPending - platformPending - creatorGraduationPending;
        require(lpMon > 0, "no lp mon");
        _safeTransfer(token, grad, lpTokens);
        IGraduator(grad).onGraduate{value: lpMon}(token, lpTokens);

        emit Graduated(lpMon, creatorReward, 0);
    }
    
    // ── CREATOR PULL PAYMENT (V2.1-5) ─────────
    /// @notice Withdraw all accrued creator fees from buys and sells.
    ///         Callable any time, including post-graduation (creatorPending was excluded
    ///         from the LP transfer in _graduate so it stays available for the creator).
    function claimCreatorRewards() external nonReentrant {
        require(msg.sender == creator, "!creator");
        uint256 amt = creatorPending;
        require(amt > 0, "0");
        creatorPending = 0;
        (bool ok, ) = creator.call{value: amt}("");
        require(ok, "claim fail");
        emit FeeCollected("creator-claim", creator, amt);
    }

    // --- V2.1 BATCH 3: PLATFORM PULL PAYMENT ---
    event PlatformBufferClaimed(uint256 amount, address recipient);
    function claimPlatformBuffer() external nonReentrant {
        uint256 amt = platformPending;
        require(amt > 0, "nothing");
        platformPending = 0;
        address recipient = IFactory(factory).platformWallet();
        require(recipient != address(0), "platform=0");
        (bool ok, ) = recipient.call{value: amt}("");
        require(ok, "platform pull fail");
        totalPlatformFees += amt;
        emit PlatformBufferClaimed(amt, recipient);
    }
    function platformClaimable() external view returns (uint256) { return platformPending; }

    // --- V2.1 BATCH 3: CREATOR GRADUATION REWARD PULL (25k) ---
    event GraduationRewardClaimed(address indexed creator, uint256 amount);
    function claimGraduationReward() external nonReentrant {
        require(msg.sender == creator, "!creator");
        require(graduated, "!graduated");
        require(!creatorGraduationClaimed, "claimed");
        uint256 amt = creatorGraduationPending;
        require(amt > 0, "nothing");
        creatorGraduationClaimed = true;
        creatorGraduationPending = 0;
        (bool ok, ) = creator.call{value: amt}("");
        require(ok, "grad reward fail");
        totalCreatorFees += amt;
        emit GraduationRewardClaimed(creator, amt);
    }
    function graduationRewardClaimable() external view returns (uint256 amount, bool claimed) {
        return (creatorGraduationPending, creatorGraduationClaimed);
    }


    // ── ADMIN (owner of factory) ──────────────
    function setPauseBuys(bool v) external {
        require(msg.sender == IFactory(factory).owner(), "!owner");
        pauseBuys = v;
    }
    function setPauseSells(bool v) external {
        require(msg.sender == IFactory(factory).owner(), "!owner");
        pauseSells = v;
    }
    
    receive() external payable {}

    /// @dev Minimal SafeERC20-style transfer (OZ-free).
    function _safeTransfer(address tok, address to, uint256 amt) internal {
        (bool ok, bytes memory data) = tok.call(
            abi.encodeWithSelector(IToken.transfer.selector, to, amt)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "safeTransfer fail");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================================
//  MonPadCurveV2Monshi — MONSHI-denominated bonding curve w/ creator fee config
// ----------------------------------------------------------------------------
//  MONSHI-native rebuild of MonPadCurveV2 PLUS per-launch, creator-configurable
//  tokenomics:
//
//   1. Quote asset is MONSHI (ERC20). Everything that was native MON
//      (msg.value / call{value:}) now flows as MONSHI (transferFrom / transfer).
//
//   2. Creator-fee routing (FeeConfig.cf*): the creator's own MONSHI trade fee
//      (buyFeeCreatorBps on buys, sellFeeCreatorBps on sells) is split into:
//        - cfBurnTokenBps  → buyback-and-burn the PROJECT token (MONSHI buys the
//                            token off this curve, tokens sent to dEaD)
//        - cfBurnMonshiBps → burn MONSHI (MONSHI sent to dEaD)
//        - cfLpBps         → reserved for the graduation LP (lpPendingMonshi)
//        - remainder       → creator wallet (creatorPending, pull-payment)
//
//   3. Per-trade tax (FeeConfig.tax*): an EXTRA skim on every trade, paid by all
//      traders, taken off the trade notional and routed to burn/LP exactly like
//      the creator-fee buckets above. Capped at MAX_TRADE_TAX_BPS.
//
//   4. The whole FeeConfig is editable post-launch by the creator (setFeeConfig).
//      (Banner / pfp / socials are OFF-CHAIN metadata — handled by the backend,
//      not this contract.)
//
//  Value-conservation invariant (checked in tests): at all times the curve's
//  MONSHI balance >= realMonReserve + creatorPending + platformPending +
//  lpPendingMonshi + creatorGraduationPending.
//
//  Curve math is byte-for-byte identical to MonPadCurveV2 (constant product on
//  virtual reserves). Field names that say "mon" are denominated in MONSHI here.
//
//  NOT YET DEPLOYED. Draft for review + audit. See MONSHI-REBUILD.md.
// ============================================================================

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
    function graduationCreatorReward() external view returns (uint256);
    function pauseAllBuys() external view returns (bool);
    function pauseAllSells() external view returns (bool);
    function blocked(address tok) external view returns (bool);
    function owner() external view returns (address);
    function graduator() external view returns (address);
}

interface IGraduator {
    function onGraduate(address token, uint256 lpTokens, uint256 quoteAmount) external;
}

interface IToken {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @notice Per-launch creator tokenomics. All values in basis points (10000 = 100%).
struct FeeConfig {
    // Creator-fee routing: how the creator's OWN fee is split. Sum <= 10000; remainder → creator wallet.
    uint16 cfBurnTokenBps;
    uint16 cfBurnMonshiBps;
    uint16 cfLpBps;
    // Per-trade tax: EXTRA skim on every trade (all traders). Sum <= MAX_TRADE_TAX_BPS.
    uint16 taxBurnTokenBps;
    uint16 taxBurnMonshiBps;
    uint16 taxLpBps;
}

contract MonPadCurveV2Monshi {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @notice Hard ceiling on the total per-trade tax (sum of the three tax buckets). 10%.
    uint16 public constant MAX_TRADE_TAX_BPS = 1000;

    // Per-clone state (populated via initialize).
    address public token;
    address public creator;
    address public factory;
    address public quote; // MONSHI ERC20

    uint256 public monRaised;          // gross MONSHI in (before fees)
    uint256 public monRaisedNet;       // net MONSHI in curve toward grad
    uint256 public platformPending;
    uint256 public creatorGraduationPending;
    bool    public creatorGraduationClaimed;
    uint256 public ath;
    uint256 public launchedAt;
    uint256 public devTokenAmount;

    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    uint256 public totalStakingFees;
    uint256 public creatorPending;

    // ── Creator tokenomics ────────────────────
    FeeConfig public feeConfig;
    uint256 public lpPendingMonshi;     // MONSHI reserved for the graduation LP
    uint256 public totalBurnedTokens;   // project token sent to dEaD via buyback-burn
    uint256 public totalBurnedMonshi;   // MONSHI sent to dEaD

    bool public graduated;
    bool public pauseBuys;
    bool public pauseSells;
    bool private _initialized;

    uint256 public constant CURVE_K = 1e36;
    uint256 public virtualMonReserve;
    uint256 public virtualTokenReserve;
    uint256 public realMonReserve;
    uint256 public realTokenReserve;

    // Snapshotted from the factory at launch so later owner changes to these params can't
    // brick an in-flight curve or front-run its graduation economics (audit H-3 / M-3).
    uint256 public gradTarget;
    uint256 public gradCreatorReward;

    event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut, uint256 newPrice);
    event Sell(address indexed seller, uint256 tokensIn, uint256 monOut, uint256 newPrice);
    event DevBuy(address indexed dev, uint256 monIn, uint256 tokensOut);
    event Graduated(uint256 lpMon, uint256 creatorReward, uint256 platformReward);
    event FeeCollected(string kind, address to, uint256 amount);
    event BuybackBurn(uint256 monshiIn, uint256 tokensBurned);
    event MonshiBurned(uint256 amount);
    event LpReserved(uint256 amount);
    event FeeConfigChanged(
        uint16 cfBurnTokenBps, uint16 cfBurnMonshiBps, uint16 cfLpBps,
        uint16 taxBurnTokenBps, uint16 taxBurnMonshiBps, uint16 taxLpBps
    );

    modifier notGraduated() { require(!graduated, "grad"); _; }

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor() {
        _initialized = true;
        _status = _NOT_ENTERED;
    }

    function initialize(
        address _token,
        address _creator,
        address _factory,
        address _quote,
        FeeConfig calldata _cfg
    ) external {
        require(!_initialized, "init");
        require(_token != address(0) && _factory != address(0) && _quote != address(0), "addr0");
        _initialized = true;
        _status = _NOT_ENTERED;

        token = _token;
        creator = _creator;
        factory = _factory;
        quote = _quote;
        launchedAt = block.timestamp;

        _setFeeConfig(_cfg);

        virtualMonReserve = 117_000 ether;
        virtualTokenReserve = 1_260_000_000 ether;
        realTokenReserve = 1_000_000_000 ether;

        // Snapshot graduation economics for this launch (see storage comment).
        gradTarget = IFactory(_factory).graduationTarget();
        gradCreatorReward = IFactory(_factory).graduationCreatorReward();
    }

    // ── CREATOR TOKENOMICS CONFIG ─────────────
    /// @notice Creator updates their tokenomics post-launch. Validated + capped.
    function setFeeConfig(FeeConfig calldata _cfg) external {
        require(msg.sender == creator, "!creator");
        _setFeeConfig(_cfg);
    }

    function _setFeeConfig(FeeConfig calldata _cfg) internal {
        require(
            uint256(_cfg.cfBurnTokenBps) + _cfg.cfBurnMonshiBps + _cfg.cfLpBps <= 10000,
            "cf > 100%"
        );
        require(
            uint256(_cfg.taxBurnTokenBps) + _cfg.taxBurnMonshiBps + _cfg.taxLpBps <= MAX_TRADE_TAX_BPS,
            "tax > max"
        );
        feeConfig = _cfg;
        emit FeeConfigChanged(
            _cfg.cfBurnTokenBps, _cfg.cfBurnMonshiBps, _cfg.cfLpBps,
            _cfg.taxBurnTokenBps, _cfg.taxBurnMonshiBps, _cfg.taxLpBps
        );
    }

    function tradeTaxBps() public view returns (uint256) {
        return uint256(feeConfig.taxBurnTokenBps) + feeConfig.taxBurnMonshiBps + feeConfig.taxLpBps;
    }

    // ── PRICE / VIEWS ─────────────────────────
    function priceWeiPerToken() public view returns (uint256) {
        uint256 m = virtualMonReserve + realMonReserve;
        uint256 t = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
        if (t == 0) return 0;
        return (m * 1e18) / t;
    }

    function bondedBps() public view returns (uint256) {
        if (gradTarget == 0) return 0;
        return (monRaisedNet * 10000) / gradTarget;
    }

    function canGrad() public view returns (bool) {
        return monRaisedNet >= gradTarget && !graduated;
    }

    function capMon() external view returns (uint256) {
        return gradTarget;
    }

    /// @notice Rich 4-tuple curve reserves (used by the Mon-Pad frontend for quote previews).
    /// @dev Renamed from getReserves() so the plain getReserves() selector can be the
    ///      Uniswap-V2-compatible one below (DEX scanner / aggregator index-readiness).
    function getCurveReserves() external view returns (uint256 vm, uint256 vt, uint256 rm, uint256 rt) {
        return (virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve);
    }

    // ── Uniswap-V2-style read shim (DEX "day 1" index-readiness) ──────────────
    // Pre-graduation tokens live on this curve, not a real pool. Exposing the
    // curve's *effective* reserves (virtual + real) through the standard V2 pair
    // read interface lets DexScreener-style scanners and aggregators (e.g.
    // Monorail) display & route the token from day one, while it stays on the
    // curve. Trades still execute via buy()/sell(); this is read-only metadata.
    // No real pool, no parallel liquidity, no arbitrage surface.

    /// @notice Effective reserves: m = virtual+real MONSHI, t = effective tokens. price = m/t.
    function effectiveReserves() public view returns (uint256 monReserve, uint256 tokenReserve) {
        monReserve = virtualMonReserve + realMonReserve;
        tokenReserve = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
    }

    /// @notice V2-pair token0 (address-ordered: launched token vs MONSHI).
    function token0() external view returns (address) {
        return token < quote ? token : quote;
    }
    /// @notice V2-pair token1 (address-ordered).
    function token1() external view returns (address) {
        return token < quote ? quote : token;
    }

    /// @notice Uniswap-V2-compatible reserves. Same selector (0x0902f1ac) generic scanners read.
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        (uint256 m, uint256 t) = effectiveReserves();
        (uint256 r0, uint256 r1) = token < quote ? (t, m) : (m, t);
        require(r0 <= type(uint112).max && r1 <= type(uint112).max, "reserve overflow");
        reserve0 = uint112(r0);
        reserve1 = uint112(r1);
        blockTimestampLast = uint32(block.timestamp);
    }

    // ── CORE: BUY ─────────────────────────────
    /// @notice Buy curve tokens with MONSHI. Caller must approve `quoteIn` MONSHI to this curve.
    function buy(uint256 quoteIn, uint256 minTokensOut) external notGraduated nonReentrant returns (uint256) {
        require(!IFactory(factory).pauseAllBuys(), "buys paused");
        require(!IFactory(factory).blocked(token), "blocked");
        require(!pauseBuys, "buys paused (token)");
        require(quoteIn > 0, "0");

        // Balance-delta accounting: credit only what actually arrived, so a fee-on-transfer
        // or otherwise non-standard MONSHI can never make the curve over-credit (audit M-1).
        uint256 beforeBal = IERC20(quote).balanceOf(address(this));
        _safeTransferFrom(quote, msg.sender, address(this), quoteIn);
        uint256 received = IERC20(quote).balanceOf(address(this)) - beforeBal;
        require(received > 0, "0 received");
        return _buy(msg.sender, received, minTokensOut, false);
    }

    /// @notice Dev buy at launch (no fees, no tax). Factory pushes MONSHI to the curve first.
    function devBuy(address dev, uint256 quoteIn) external returns (uint256) {
        require(msg.sender == factory, "!factory");
        require(launchedAt == block.timestamp, "after launch");
        uint256 tokensOut = _buy(dev, quoteIn, 0, true);
        uint256 maxBps = uint256(IFactoryExt(factory).maxDevBuyBps());
        require(tokensOut <= (1_000_000_000 ether * maxBps) / 10000, "dev buy > max %");
        devTokenAmount = tokensOut;
        emit DevBuy(dev, quoteIn, tokensOut);
        return tokensOut;
    }

    struct BuyLocals {
        uint256 creatorFee;
        uint256 bufferFee;
        uint256 taxTotal;
        uint256 monForBuy;
        uint256 currentMon;
        uint256 currentTokens;
        uint256 newMonReserve;
        uint256 newTokenReserve;
        uint256 mcap;
    }

    /// @dev Assumes `monIn` MONSHI is ALREADY held by this contract.
    function _buy(address buyer, uint256 monIn, uint256 minOut, bool isDev) internal returns (uint256 tokensOut) {
        IFactory f = IFactory(factory);
        BuyLocals memory L;

        L.creatorFee = isDev ? 0 : (monIn * f.buyFeeCreatorBps()) / 10000;
        L.bufferFee  = isDev ? 0 : (monIn * f.buyFeeBufferBps()) / 10000;
        L.taxTotal   = isDev ? 0 : (monIn * tradeTaxBps()) / 10000;
        L.monForBuy  = monIn - L.creatorFee - L.bufferFee - L.taxTotal;

        if (L.bufferFee > 0) platformPending += L.bufferFee;

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

        _safeTransfer(token, buyer, tokensOut);

        // Route the creator fee + per-trade tax (burn/LP/creator). Order: after the buyer's fill.
        if (!isDev) {
            _routeCreatorFee(L.creatorFee);
            _routeTradeTax(monIn);
        }

        L.mcap = (priceWeiPerToken() * 1_000_000_000 ether) / 1e18;
        if (L.mcap > ath) ath = L.mcap;

        emit Buy(buyer, monIn, tokensOut, priceWeiPerToken());

        // Graduation is NOT auto-triggered here — it is finalized via the separate, retryable
        // graduate() so a griefed external pool can never brick buys (audit: graduation-DoS).
    }

    // ── CORE: SELL ────────────────────────────
    struct SellLocals {
        uint256 grossMonOut;
        uint256 creatorFee;
        uint256 stakingFee;
        uint256 platformFee;
        uint256 taxTotal;
    }

    /// @notice Sell curve tokens for MONSHI. Caller must approve `tokensIn` of the launched token.
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
        L.taxTotal = (L.grossMonOut * tradeTaxBps()) / 10000;
        monOut = L.grossMonOut - L.creatorFee - L.stakingFee - L.platformFee - L.taxTotal;

        require(monOut >= minMonOut, "slippage");

        // staking + platform fees
        if (L.stakingFee > 0) {
            address recipient = f.getRewardRecipient();
            _safeTransfer(quote, recipient, L.stakingFee);
            if (recipient.code.length > 0) {
                // Gas-capped + return-discarded so a malicious/buggy recipient can't brick or
                // return-bomb sells (audit D-1). The MONSHI is already delivered above.
                (bool notified, ) = recipient.call{gas: 50000}(abi.encodeWithSignature("notifyReward(address,uint256)", token, L.stakingFee));
                notified;
            }
            totalStakingFees += L.stakingFee;
            emit FeeCollected("staking-sell", recipient, L.stakingFee);
        }
        if (L.platformFee > 0) {
            platformPending += L.platformFee;
            emit FeeCollected("platform-sell-accrued", f.platformWallet(), L.platformFee);
        }

        // creator fee routing + per-trade tax routing
        _routeCreatorFee(L.creatorFee);
        _routeTradeTax(L.grossMonOut);

        // Pay the seller in MONSHI.
        _safeTransfer(quote, msg.sender, monOut);

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

    // ── FEE ROUTING ───────────────────────────
    /// @dev Split the creator's own fee per FeeConfig.cf*; remainder → creator wallet.
    function _routeCreatorFee(uint256 fee) internal {
        if (fee == 0) return;
        FeeConfig memory c = feeConfig;
        uint256 burnTok = (fee * c.cfBurnTokenBps) / 10000;
        uint256 burnMon = (fee * c.cfBurnMonshiBps) / 10000;
        uint256 lp      = (fee * c.cfLpBps) / 10000;
        uint256 toCreator = fee - burnTok - burnMon - lp;

        if (toCreator > 0) {
            creatorPending   += toCreator;
            totalCreatorFees += toCreator;
            emit FeeCollected("creator-fee", creator, toCreator);
        }
        _applyAllocation(burnTok, burnMon, lp);
    }

    /// @dev Per-trade tax taken off `notional` (MONSHI) and routed to burn/LP for all traders.
    function _routeTradeTax(uint256 notional) internal {
        FeeConfig memory c = feeConfig;
        uint256 burnTok = (notional * c.taxBurnTokenBps) / 10000;
        uint256 burnMon = (notional * c.taxBurnMonshiBps) / 10000;
        uint256 lp      = (notional * c.taxLpBps) / 10000;
        _applyAllocation(burnTok, burnMon, lp);
    }

    /// @dev Apply a (token-buyback-burn, monshi-burn, lp-reserve) allocation in MONSHI terms.
    function _applyAllocation(uint256 burnTokenMonshi, uint256 burnMonshiAmt, uint256 lpAmt) internal {
        if (burnMonshiAmt > 0) {
            totalBurnedMonshi += burnMonshiAmt;
            _safeTransfer(quote, DEAD, burnMonshiAmt);
            emit MonshiBurned(burnMonshiAmt);
        }
        if (lpAmt > 0) {
            lpPendingMonshi += lpAmt;
            emit LpReserved(lpAmt);
        }
        if (burnTokenMonshi > 0) {
            _buyAndBurn(burnTokenMonshi);
        }
    }

    /// @dev Buyback-and-burn: spend `monshiAmt` (already held) on the curve, send tokens to dEaD.
    ///      Internal micro-buy — no external/attacker call, runs inside nonReentrant trades.
    function _buyAndBurn(uint256 monshiAmt) internal {
        if (monshiAmt == 0) return;
        uint256 currentMon = virtualMonReserve + realMonReserve;
        uint256 currentTokens = virtualTokenReserve - (1_000_000_000 ether - realTokenReserve);
        if (currentTokens == 0 || realTokenReserve == 0) return;
        uint256 newMon = currentMon + monshiAmt;
        uint256 newTok = (currentMon * currentTokens) / newMon;
        uint256 tokensOut = currentTokens - newTok;
        if (tokensOut > realTokenReserve) tokensOut = realTokenReserve;
        if (tokensOut == 0) return;

        realMonReserve   += monshiAmt;
        realTokenReserve -= tokensOut;
        monRaised        += monshiAmt;
        monRaisedNet     += monshiAmt;
        totalBurnedTokens += tokensOut;

        _safeTransfer(token, DEAD, tokensOut);
        emit BuybackBurn(monshiAmt, tokensOut);
    }

    // ── GRADUATION ────────────────────────────
    uint256 internal constant GRAD_LP_FLOOR = 1 ether;

    /// @notice Finalize graduation once the target is reached. Permissionless + retryable.
    /// @dev Decoupled from buy() so a griefed/mispriced external pool can never brick trading
    ///      (audit: graduation-DoS). A failed call reverts atomically — no funds move — and can
    ///      be retried by anyone (a keeper, the frontend, or the next trader).
    function graduate() external nonReentrant {
        require(!graduated, "graduated");
        require(monRaisedNet >= gradTarget, "not ready");
        _graduate();
    }

    function _graduate() internal {
        require(!graduated, "already");
        IFactory f = IFactory(factory);

        uint256 creatorReward = gradCreatorReward;

        uint256 bal = IERC20(quote).balanceOf(address(this));
        uint256 minNeeded = creatorReward + platformPending + creatorPending + GRAD_LP_FLOOR;
        require(bal >= minNeeded, "insufficient for grad");

        graduated = true;

        if (creatorReward > 0 && creator != address(0)) {
            creatorGraduationPending = creatorReward;
        }

        address grad = f.graduator();
        require(grad != address(0), "!graduator");
        uint256 lpTokens = IToken(token).balanceOf(address(this));
        require(lpTokens > 0, "no lp tokens");

        // Everything not reserved for pull-claims seeds the LP (this naturally includes
        // lpPendingMonshi, which was never assigned to realMonReserve or any claim bucket).
        uint256 lpMon = bal - creatorPending - platformPending - creatorGraduationPending;
        require(lpMon > 0, "no lp mon");

        _safeTransfer(token, grad, lpTokens);
        _safeTransfer(quote, grad, lpMon);
        IGraduator(grad).onGraduate(token, lpTokens, lpMon);

        emit Graduated(lpMon, creatorReward, 0);
    }

    // ── CREATOR / PLATFORM PULL PAYMENTS (MONSHI) ─────────
    function claimCreatorRewards() external nonReentrant {
        require(msg.sender == creator, "!creator");
        uint256 amt = creatorPending;
        require(amt > 0, "0");
        creatorPending = 0;
        _safeTransfer(quote, creator, amt);
        emit FeeCollected("creator-claim", creator, amt);
    }

    event PlatformBufferClaimed(uint256 amount, address recipient);
    function claimPlatformBuffer() external nonReentrant {
        uint256 amt = platformPending;
        require(amt > 0, "nothing");
        platformPending = 0;
        address recipient = IFactory(factory).platformWallet();
        require(recipient != address(0), "platform=0");
        _safeTransfer(quote, recipient, amt);
        totalPlatformFees += amt;
        emit PlatformBufferClaimed(amt, recipient);
    }
    function platformClaimable() external view returns (uint256) { return platformPending; }

    event GraduationRewardClaimed(address indexed creator, uint256 amount);
    function claimGraduationReward() external nonReentrant {
        require(msg.sender == creator, "!creator");
        require(graduated, "!graduated");
        require(!creatorGraduationClaimed, "claimed");
        uint256 amt = creatorGraduationPending;
        require(amt > 0, "nothing");
        creatorGraduationClaimed = true;
        creatorGraduationPending = 0;
        _safeTransfer(quote, creator, amt);
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

    function _safeTransfer(address tok, address to, uint256 amt) internal {
        (bool ok, bytes memory data) = tok.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amt)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "safeTransfer fail");
    }

    function _safeTransferFrom(address tok, address from, address to, uint256 amt) internal {
        (bool ok, bytes memory data) = tok.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amt)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "safeTransferFrom fail");
    }
}

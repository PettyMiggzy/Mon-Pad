// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================================
//  MonPadCurveV3 — native-MON bonding curve, $5k-USD-calibrated, DEX-index-ready
// ----------------------------------------------------------------------------
//  Native MON is the base currency (msg.value / call{value:}). One curve clone
//  per launch (EIP-1167). Carries forward every audited property of the MONSHI
//  rebuild — value-conservation, decoupled retryable graduation, snapshotted
//  graduation params, checked transfers, gas-capped reward notify — plus:
//
//   * Curve self-calibrates to the graduation target: virtualMonReserve =
//     gradTarget * 117000/425000 (keeps the audited ~21x multiple / ~99% sold
//     shape at ANY target, e.g. ~260k MON ≈ $5,000).
//   * Creator FeeConfig (editable): route the creator's own fee, plus an
//     optional per-trade tax (all traders, <=10%), into project-token
//     buyback-burn and/or graduation-LP reserve.
//   * MONSHI utility: the sell "buyback" fee slice (MON) is routed to the
//     reward recipient = the MONSHI buyback wallet, which buys & burns MONSHI.
//   * Graduation distribution: creator reward + a treasury cut + everything else
//     (incl. all unsold tokens) into a locked WMON/token LP.
//   * pump.fun-grade `Trade` event (post-trade virtual+real reserves + priceX18)
//     so DexScreener can chart pre-bond. Uniswap-V2 read shim as a fallback.
//
//  NOT YET DEPLOYED. Draft for review + self-audit. See DEXSCREENER-INDEXING.md
//  and MONSHI-SPEC.md.
// ============================================================================

interface IFactoryExt {
    function maxDevBuyBps() external view returns (uint256);
}

interface IFactory {
    function platformWallet() external view returns (address);
    function getRewardRecipient() external view returns (address); // MONSHI buyback wallet (or staking hub)
    function treasuryWallet() external view returns (address);
    function wmon() external view returns (address);
    function buyFeeCreatorBps() external view returns (uint16);
    function buyFeeBufferBps() external view returns (uint16);
    function sellFeeCreatorBps() external view returns (uint16);
    function sellFeeStakingBps() external view returns (uint16);  // -> MONSHI buyback
    function sellFeePlatformBps() external view returns (uint16);
    function graduationTarget() external view returns (uint256);
    function graduationCreatorReward() external view returns (uint256);
    function graduationTreasuryCut() external view returns (uint256);
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

/// @notice Per-launch creator tokenomics (native-MON base). bps (10000 = 100%).
struct FeeConfig {
    // Creator-fee routing: splits the creator's OWN fee. Sum <= 10000; remainder -> creator wallet.
    uint16 cfBurnTokenBps;   // buyback-and-burn the project token
    uint16 cfLpBps;          // reserve MON for the graduation LP
    // Per-trade tax: EXTRA skim on every trade (all traders). Sum <= MAX_TRADE_TAX_BPS.
    uint16 taxBurnTokenBps;
    uint16 taxLpBps;
}

contract MonPadCurveV3 {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint16  public constant MAX_TRADE_TAX_BPS = 1000; // 10%
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant GRAD_LP_FLOOR = 1 ether;

    // Per-clone state.
    address public token;
    address public creator;
    address public factory;
    address public wmon; // quote reference for the V2 read shim (USD pricing)

    uint256 public monRaised;
    uint256 public monRaisedNet;
    uint256 public platformPending;          // 1% buy buffer + 1% sell, pulled by platform
    uint256 public creatorGraduationPending; // creator reward reserved at graduation
    bool    public creatorGraduationClaimed;
    uint256 public ath;
    uint256 public launchedAt;
    uint256 public devTokenAmount;

    uint256 public totalCreatorFees;
    uint256 public totalPlatformFees;
    uint256 public totalStakingFees;         // MON routed to MONSHI buyback
    uint256 public creatorPending;           // creator buy/sell fee, pull-claimed
    uint256 public monshiBuybackPending;     // MON accrued for MONSHI buyback, pull-claimed

    FeeConfig public feeConfig;
    uint256 public lpPendingMon;             // MON reserved for the graduation LP
    uint256 public totalBurnedTokens;

    // Snapshotted from the factory at launch (immutable economics for this curve).
    uint256 public gradTarget;
    uint256 public gradCreatorReward;
    uint256 public gradTreasuryCut;

    bool public graduated;
    bool public pauseBuys;
    bool public pauseSells;
    bool private _initialized;

    uint256 public virtualMonReserve;
    uint256 public virtualTokenReserve;
    uint256 public realMonReserve;
    uint256 public realTokenReserve;

    // pump.fun-grade trade event — price fully derivable from the log.
    event Trade(
        address indexed token,
        address indexed trader,
        bool    isBuy,
        uint256 monAmount,
        uint256 tokenAmount,
        uint256 virtualMonReserve,
        uint256 virtualTokenReserve,
        uint256 realMonReserve,
        uint256 realTokenReserve,
        uint256 priceX18,
        uint256 tradedAt
    );
    event Graduated(uint256 lpMon, uint256 creatorReward, uint256 treasuryCut);
    event FeeCollected(string kind, address to, uint256 amount);
    event BuybackBurn(uint256 monIn, uint256 tokensBurned);
    event LpReserved(uint256 amount);
    event FeeConfigChanged(uint16 cfBurnTokenBps, uint16 cfLpBps, uint16 taxBurnTokenBps, uint16 taxLpBps);

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

    /// @dev `factory = msg.sender` binds initialization to the cloning factory (audit M-1
    ///      defense-in-depth): even if a clone address leaked, only the factory that deploys it
    ///      can initialize it, and it can only point `factory` at itself.
    /// @dev Payable: the factory forwards a small slice of the creation fee as a real-MON
    ///      buffer (seeds `realMonReserve`), giving every launch immediate exit liquidity and
    ///      eliminating the 1-wei "no MON liquidity" edge on a sole-holder's full sell.
    function initialize(
        address _token,
        address _creator,
        FeeConfig calldata _cfg
    ) external payable {
        require(!_initialized, "init");
        require(_token != address(0) && _creator != address(0), "addr0");
        _initialized = true;
        _status = _NOT_ENTERED;

        token = _token;
        creator = _creator;
        factory = msg.sender;
        wmon = IFactory(msg.sender).wmon();
        launchedAt = block.timestamp;

        _setFeeConfig(_cfg);

        // Snapshot economics; self-calibrate the curve to the target. Vm = gradTarget * 9/13
        // ≈ 0.692× (≈180,000 MON at the 260k target) — matches the flatter nad.fun-style virtual
        // MON reserve so early buyers can't grab an outsized share and the curve sells ~74% on
        // the curve / leaves ~26% for the LP, opening the DEX at ≈ the curve's final price.
        gradTarget        = IFactory(msg.sender).graduationTarget();
        gradCreatorReward = IFactory(msg.sender).graduationCreatorReward();
        gradTreasuryCut   = IFactory(msg.sender).graduationTreasuryCut();
        require(gradTarget > 0, "target=0");

        virtualMonReserve   = (gradTarget * 9) / 13;
        virtualTokenReserve = 1_260_000_000 ether;
        realTokenReserve    = SUPPLY;
        realMonReserve      = msg.value; // creation-fee buffer (real exit liquidity)
        require(virtualMonReserve > 0, "vm=0");
    }

    // ── CREATOR TOKENOMICS CONFIG ─────────────
    function setFeeConfig(FeeConfig calldata _cfg) external {
        require(msg.sender == creator, "!creator");
        _setFeeConfig(_cfg);
    }

    function _setFeeConfig(FeeConfig calldata _cfg) internal {
        require(uint256(_cfg.cfBurnTokenBps) + _cfg.cfLpBps <= 10000, "cf > 100%");
        require(uint256(_cfg.taxBurnTokenBps) + _cfg.taxLpBps <= MAX_TRADE_TAX_BPS, "tax > max");
        feeConfig = _cfg;
        emit FeeConfigChanged(_cfg.cfBurnTokenBps, _cfg.cfLpBps, _cfg.taxBurnTokenBps, _cfg.taxLpBps);
    }

    function tradeTaxBps() public view returns (uint256) {
        return uint256(feeConfig.taxBurnTokenBps) + feeConfig.taxLpBps;
    }

    // ── PRICE / VIEWS ─────────────────────────
    function priceWeiPerToken() public view returns (uint256) {
        uint256 m = virtualMonReserve + realMonReserve;
        uint256 t = virtualTokenReserve - (SUPPLY - realTokenReserve);
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

    function capMon() external view returns (uint256) { return gradTarget; }

    function getCurveReserves() external view returns (uint256 vm, uint256 vt, uint256 rm, uint256 rt) {
        return (virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve);
    }

    // ── Uniswap-V2 read shim (fallback DEX index-readiness; quote = WMON) ──
    function effectiveReserves() public view returns (uint256 monReserve, uint256 tokenReserve) {
        monReserve = virtualMonReserve + realMonReserve;
        tokenReserve = virtualTokenReserve - (SUPPLY - realTokenReserve);
    }
    function token0() external view returns (address) { return token < wmon ? token : wmon; }
    function token1() external view returns (address) { return token < wmon ? wmon : token; }
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        (uint256 m, uint256 t) = effectiveReserves();
        (uint256 r0, uint256 r1) = token < wmon ? (t, m) : (m, t);
        // Saturate instead of reverting so the read shim never DoS's an indexer (audit L-3).
        uint256 cap = type(uint112).max;
        reserve0 = uint112(r0 > cap ? cap : r0);
        reserve1 = uint112(r1 > cap ? cap : r1);
        blockTimestampLast = uint32(block.timestamp);
    }

    // ── CORE: BUY ─────────────────────────────
    /// @notice Buy curve tokens with native MON (send MON as msg.value).
    function buy(uint256 minTokensOut) external payable notGraduated nonReentrant returns (uint256) {
        require(!IFactory(factory).pauseAllBuys(), "buys paused");
        require(!IFactory(factory).blocked(token), "blocked");
        require(!pauseBuys, "buys paused (token)");
        require(msg.value > 0, "0");
        return _buy(msg.sender, msg.value, minTokensOut, false);
    }

    /// @notice Dev buy at launch (no fee, no tax). Factory forwards MON via msg.value.
    function devBuy(address dev) external payable returns (uint256) {
        require(msg.sender == factory, "!factory");
        require(launchedAt == block.timestamp, "after launch");
        uint256 tokensOut = _buy(dev, msg.value, 0, true);
        uint256 maxBps = uint256(IFactoryExt(factory).maxDevBuyBps());
        require(tokensOut <= (SUPPLY * maxBps) / 10000, "dev buy > max %");
        devTokenAmount = tokensOut;
        return tokensOut;
    }

    struct BuyLocals {
        uint256 creatorFee;
        uint256 bufferFee;
        uint256 taxTotal;
        uint256 monForBuy;
        uint256 currentMon;
        uint256 currentTokens;
        uint256 newTokenReserve;
        uint256 mcap;
    }

    function _buy(address buyer, uint256 monIn, uint256 minOut, bool isDev) internal returns (uint256 tokensOut) {
        IFactory f = IFactory(factory);
        BuyLocals memory L;

        L.creatorFee = isDev ? 0 : (monIn * f.buyFeeCreatorBps()) / 10000;
        L.bufferFee  = isDev ? 0 : (monIn * f.buyFeeBufferBps()) / 10000;
        L.taxTotal   = isDev ? 0 : (monIn * tradeTaxBps()) / 10000;
        L.monForBuy  = monIn - L.creatorFee - L.bufferFee - L.taxTotal;

        if (L.bufferFee > 0) platformPending += L.bufferFee;

        L.currentMon      = virtualMonReserve + realMonReserve;
        L.currentTokens   = virtualTokenReserve - (SUPPLY - realTokenReserve);
        L.newTokenReserve = (L.currentMon * L.currentTokens) / (L.currentMon + L.monForBuy);
        tokensOut         = L.currentTokens - L.newTokenReserve;

        require(tokensOut >= minOut, "slippage");
        require(tokensOut <= realTokenReserve, "no liquidity");

        realMonReserve   += L.monForBuy;
        realTokenReserve -= tokensOut;
        monRaised        += monIn;
        monRaisedNet     += L.monForBuy;

        _safeTransfer(token, buyer, tokensOut);

        if (!isDev) {
            _routeCreatorFee(L.creatorFee);
            _routeTradeTax(monIn);
        }

        L.mcap = (priceWeiPerToken() * SUPPLY) / 1e18;
        if (L.mcap > ath) ath = L.mcap;

        emit Trade(token, buyer, true, monIn, tokensOut, virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve, priceWeiPerToken(), block.timestamp);
        // Graduation finalized via the separate retryable graduate() (never bricks buys).
    }

    // ── CORE: SELL ────────────────────────────
    struct SellLocals {
        uint256 grossMonOut;
        uint256 creatorFee;
        uint256 stakingFee;
        uint256 platformFee;
        uint256 taxTotal;
    }

    /// @notice Sell curve tokens for native MON. Approve `tokensIn` of the launched token first.
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

        L.creatorFee  = (L.grossMonOut * f.sellFeeCreatorBps()) / 10000;
        L.stakingFee  = (L.grossMonOut * f.sellFeeStakingBps()) / 10000; // -> MONSHI buyback
        L.platformFee = (L.grossMonOut * f.sellFeePlatformBps()) / 10000;
        L.taxTotal    = (L.grossMonOut * tradeTaxBps()) / 10000;
        monOut = L.grossMonOut - L.creatorFee - L.stakingFee - L.platformFee - L.taxTotal;

        require(monOut >= minMonOut, "slippage");

        // MONSHI buyback slice (native MON) accrues as a pull-claim so a non-receiving buyback
        // wallet can never brick sells. Claimed via claimMonshiBuyback() -> reward recipient.
        if (L.stakingFee > 0) {
            monshiBuybackPending += L.stakingFee;
            totalStakingFees += L.stakingFee;
            emit FeeCollected("monshi-buyback-accrued", f.getRewardRecipient(), L.stakingFee);
        }
        if (L.platformFee > 0) {
            platformPending += L.platformFee;
            emit FeeCollected("platform-sell-accrued", f.platformWallet(), L.platformFee);
        }

        _routeCreatorFee(L.creatorFee);
        _routeTradeTax(L.grossMonOut);

        (bool sellerOk, ) = msg.sender.call{value: monOut}("");
        require(sellerOk, "seller pay fail");

        // monAmount = gross curve-side MON (symmetric with buy's gross monIn) for consistent
        // indexer volume; priceX18 is the post-trade spot price (audit L-2).
        emit Trade(token, msg.sender, false, L.grossMonOut, tokensIn, virtualMonReserve, virtualTokenReserve, realMonReserve, realTokenReserve, priceWeiPerToken(), block.timestamp);
    }

    function _calcSellOut(uint256 tokensIn) internal view returns (uint256) {
        uint256 currentMon = virtualMonReserve + realMonReserve;
        uint256 currentTokens = virtualTokenReserve - (SUPPLY - realTokenReserve);
        uint256 k = currentMon * currentTokens;
        uint256 newTokenReserve = currentTokens + tokensIn;
        uint256 newMonReserve = k / newTokenReserve;
        return currentMon - newMonReserve;
    }

    // ── FEE ROUTING ───────────────────────────
    function _routeCreatorFee(uint256 fee) internal {
        if (fee == 0) return;
        FeeConfig memory c = feeConfig;
        uint256 burnTok = (fee * c.cfBurnTokenBps) / 10000;
        uint256 lp      = (fee * c.cfLpBps) / 10000;
        uint256 toCreator = fee - burnTok - lp;
        if (toCreator > 0) {
            creatorPending   += toCreator;
            totalCreatorFees += toCreator;
            emit FeeCollected("creator-fee", creator, toCreator);
        }
        _applyAllocation(burnTok, lp);
    }

    function _routeTradeTax(uint256 notional) internal {
        FeeConfig memory c = feeConfig;
        uint256 burnTok = (notional * c.taxBurnTokenBps) / 10000;
        uint256 lp      = (notional * c.taxLpBps) / 10000;
        _applyAllocation(burnTok, lp);
    }

    /// @dev burnTokenMon: MON used to buyback-and-burn the project token. lpMonAmt: MON reserved for LP.
    function _applyAllocation(uint256 burnTokenMon, uint256 lpMonAmt) internal {
        if (lpMonAmt > 0) {
            lpPendingMon += lpMonAmt;
            emit LpReserved(lpMonAmt);
        }
        if (burnTokenMon > 0) {
            _buyAndBurn(burnTokenMon);
        }
    }

    /// @dev Internal micro-buy with MON already held; tokens to dEaD. No external/attacker call.
    function _buyAndBurn(uint256 monAmt) internal {
        if (monAmt == 0) return;
        uint256 currentMon = virtualMonReserve + realMonReserve;
        uint256 currentTokens = virtualTokenReserve - (SUPPLY - realTokenReserve);
        if (currentTokens == 0 || realTokenReserve == 0) return;
        uint256 newTok = (currentMon * currentTokens) / (currentMon + monAmt);
        uint256 tokensOut = currentTokens - newTok;
        if (tokensOut > realTokenReserve) tokensOut = realTokenReserve;
        if (tokensOut == 0) return;

        realMonReserve   += monAmt;
        realTokenReserve -= tokensOut;
        monRaised        += monAmt;
        monRaisedNet     += monAmt;
        totalBurnedTokens += tokensOut;

        _safeTransfer(token, DEAD, tokensOut);
        emit BuybackBurn(monAmt, tokensOut);
    }

    // ── GRADUATION (decoupled, retryable) ─────
    function graduate() external nonReentrant {
        require(!graduated, "graduated");
        require(!IFactory(factory).blocked(token), "blocked"); // honor the admin kill-switch (audit Low)
        require(monRaisedNet >= gradTarget, "not ready");
        _graduate();
    }

    function _graduate() internal {
        require(!graduated, "already");
        IFactory f = IFactory(factory);

        uint256 bal = address(this).balance;
        uint256 minNeeded = gradCreatorReward + gradTreasuryCut + platformPending + creatorPending + monshiBuybackPending + GRAD_LP_FLOOR;
        require(bal >= minNeeded, "insufficient for grad");

        graduated = true;

        if (gradCreatorReward > 0 && creator != address(0)) {
            creatorGraduationPending = gradCreatorReward;
        }

        // Treasury cut (MON) at graduation.
        if (gradTreasuryCut > 0) {
            address tre = f.treasuryWallet();
            require(tre != address(0), "treasury=0");
            (bool tOk, ) = tre.call{value: gradTreasuryCut}("");
            require(tOk, "treasury pay fail");
            emit FeeCollected("graduation-treasury", tre, gradTreasuryCut);
        }

        address grad = f.graduator();
        require(grad != address(0), "!graduator");
        uint256 lpTokens = IToken(token).balanceOf(address(this));
        require(lpTokens > 0, "no lp tokens");

        // Everything not reserved for pull-claims (incl. lpPendingMon + all unsold tokens) seeds the LP.
        uint256 lpMon = address(this).balance - creatorPending - platformPending - creatorGraduationPending - monshiBuybackPending;
        require(lpMon > 0, "no lp mon");

        _safeTransfer(token, grad, lpTokens);
        IGraduator(grad).onGraduate{value: lpMon}(token, lpTokens);

        // Zero the now-migrated reserves so the value-conservation invariant stays exact
        // post-graduation (these are never read again — buy/sell are notGraduated-gated).
        realMonReserve = 0;
        lpPendingMon = 0;

        emit Graduated(lpMon, gradCreatorReward, gradTreasuryCut);
    }

    // ── PULL PAYMENTS (native MON) ────────────
    function claimCreatorRewards() external nonReentrant {
        require(msg.sender == creator, "!creator");
        uint256 amt = creatorPending;
        require(amt > 0, "0");
        creatorPending = 0;
        (bool ok, ) = creator.call{value: amt}("");
        require(ok, "claim fail");
        emit FeeCollected("creator-claim", creator, amt);
    }

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

    event MonshiBuybackClaimed(uint256 amount, address recipient);
    /// @notice Pull accrued MONSHI-buyback MON to the reward recipient (buyback wallet). Permissionless.
    function claimMonshiBuyback() external nonReentrant {
        uint256 amt = monshiBuybackPending;
        require(amt > 0, "nothing");
        monshiBuybackPending = 0;
        address recipient = IFactory(factory).getRewardRecipient();
        require(recipient != address(0), "recipient=0");
        (bool ok, ) = recipient.call{value: amt}("");
        require(ok, "buyback pull fail");
        emit MonshiBuybackClaimed(amt, recipient);
    }
    function monshiBuybackClaimable() external view returns (uint256) { return monshiBuybackPending; }

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

    // ── ADMIN (factory owner) ─────────────────
    function setPauseBuys(bool v) external { require(msg.sender == IFactory(factory).owner(), "!owner"); pauseBuys = v; }
    function setPauseSells(bool v) external { require(msg.sender == IFactory(factory).owner(), "!owner"); pauseSells = v; }

    function _safeTransfer(address tok, address to, uint256 amt) internal {
        (bool ok, bytes memory data) = tok.call(abi.encodeWithSelector(IToken.transfer.selector, to, amt));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "safeTransfer fail");
    }

    receive() external payable {}
}

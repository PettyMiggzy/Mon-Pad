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
    function onGraduate(address token) external payable;
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
contract MonPadCurveV2 {
    address public immutable token;
    address public immutable creator;
    address public immutable referrer;
    address public immutable factory;
    
    uint256 public monRaised;          // gross MON in (before fees)
    uint256 public monRaisedNet;       // net MON in curve toward grad
    uint256 public buyBuffer;          // 1% of buys held until grad
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
    bool public delisted;
    
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
    
    constructor(address _token, address _creator, address _ref, address _factory) {
        token = _token;
        creator = _creator;
        referrer = _ref;
        factory = _factory;
        launchedAt = block.timestamp;
        
        // Initialize virtual reserves for bonding curve
        // Standard pump.fun-ish: virtual MON = 30 (so curve starts cheap), virtual tokens = supply
        // priceWei = monReserve * 1e18 / tokenReserve
        virtualMonReserve = 30 ether;
        virtualTokenReserve = 1_073_000_191 ether; // adjusted so curve graduates near target
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
    function buy(uint256 minTokensOut) external payable notGraduated returns (uint256) {
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
    
    function _buy(address buyer, uint256 monIn, uint256 minOut, bool isDev) internal returns (uint256 tokensOut) {
        IFactory f = IFactory(factory);
        
        // Take fees off the top
        uint256 creatorFee = isDev ? 0 : (monIn * f.buyFeeCreatorBps()) / 10000;
        uint256 bufferFee = isDev ? 0 : (monIn * f.buyFeeBufferBps()) / 10000;
        uint256 monForBuy = monIn - creatorFee - bufferFee;
        
        // V2.1-5: accrue creator fee to pull-payment accumulator instead of pushing.
        // Creator withdraws via claimCreatorRewards(). No external call here, no reentrancy.
        if (creatorFee > 0) {
            creatorPending += creatorFee;
            totalCreatorFees += creatorFee;
            emit FeeCollected("creator-buy", creator, creatorFee);
        }
        
        // Buffer stays in curve until grad
        if (bufferFee > 0) buyBuffer += bufferFee;
        
        // Curve math: x*y=k constant product on virtual reserves
        uint256 newMonReserve = virtualMonReserve + realMonReserve + monForBuy;
        uint256 totalTokens = virtualTokenReserve;
        uint256 currentMon = virtualMonReserve + realMonReserve;
        uint256 currentTokens = totalTokens - (1_000_000_000 ether - realTokenReserve);
        uint256 k = currentMon * currentTokens;
        uint256 newTokenReserve = k / newMonReserve;
        tokensOut = currentTokens - newTokenReserve;
        
        require(tokensOut >= minOut, "slippage");
        require(tokensOut <= realTokenReserve, "no liquidity");
        
        realMonReserve += monForBuy;
        realTokenReserve -= tokensOut;
        monRaised += monIn;
        monRaisedNet += monForBuy;
        
        // Update ATH
        uint256 mcap = (priceWeiPerToken() * 1_000_000_000 ether) / 1e18;
        if (mcap > ath) ath = mcap;
        
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
    
    function sell(uint256 tokensIn, uint256 minMonOut) external notGraduated returns (uint256 monOut) {
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
            (bool ok, ) = f.platformWallet().call{value: platformFee}("");
            require(ok, "platform fee fail");
            totalPlatformFees += platformFee;
            emit FeeCollected("platform-sell", f.platformWallet(), platformFee);
        }
    }
    
    // ── GRADUATION ────────────────────────────
    function _graduate() internal {
        require(!graduated, "already");
        IFactory f = IFactory(factory);
        graduated = true;
        
        uint256 lpAmt = f.graduationLP();
        uint256 creatorReward = f.graduationCreatorReward();
        uint256 platformGets = buyBuffer; // accumulated buffer
        
        // Pay creator reward
        if (creatorReward > 0 && creator != address(0)) {
            (bool ok, ) = creator.call{value: creatorReward}("");
            require(ok, "creator reward fail");
            totalCreatorFees += creatorReward;
        }
        
        // Pay platform their buffer
        if (platformGets > 0) {
            (bool ok, ) = f.platformWallet().call{value: platformGets}("");
            require(ok, "platform buffer fail");
            totalPlatformFees += platformGets;
            buyBuffer = 0;
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
        uint256 lpMon = address(this).balance - creatorPending;
        require(lpMon > 0, "no lp mon");
        _safeTransfer(token, grad, lpTokens);
        IGraduator(grad).onGraduate{value: lpMon}(token);

        emit Graduated(lpMon, creatorReward, platformGets);
    }
    
    // ── CREATOR PULL PAYMENT (V2.1-5) ─────────
    /// @notice Withdraw all accrued creator fees from buys and sells.
    ///         Callable any time, including post-graduation (creatorPending was excluded
    ///         from the LP transfer in _graduate so it stays available for the creator).
    function claimCreatorRewards() external {
        require(msg.sender == creator, "!creator");
        uint256 amt = creatorPending;
        require(amt > 0, "0");
        creatorPending = 0;
        (bool ok, ) = creator.call{value: amt}("");
        require(ok, "claim fail");
        emit FeeCollected("creator-claim", creator, amt);
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
    function setDelisted(bool v) external {
        require(msg.sender == IFactory(factory).owner(), "!owner");
        delisted = v;
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

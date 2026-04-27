// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ FLATTENED FROM: MonPadFactoryV2.sol ============
// Compile with: solc 0.8.24, viaIR=true, optimizer=200, evmVersion=paris



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
    uint256 public totalCreatorFees;   // total MON sent to creator
    uint256 public totalPlatformFees;  // total MON sent to platform
    uint256 public totalStakingFees;   // total MON sent to staking/buyback
    
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
        
        // Pay creator fee instantly
        if (creatorFee > 0) {
            (bool ok, ) = creator.call{value: creatorFee}("");
            require(ok, "creator fee fail");
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
        if (creatorFee > 0) {
            (bool ok, ) = creator.call{value: creatorFee}("");
            require(ok, "creator fee fail");
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
        
        // Send LP MON + remaining tokens to platform wallet to handle LP creation
        // (Real implementation would call NPM directly; for upgradeability we let platform handle it)
        uint256 remainingMon = address(this).balance;
        uint256 remainingTokens = IToken(token).balanceOf(address(this));
        
        if (remainingMon > 0) {
            (bool ok, ) = f.platformWallet().call{value: remainingMon}("");
            require(ok, "lp mon fail");
        }
        if (remainingTokens > 0) {
            IToken(token).transfer(f.platformWallet(), remainingTokens);
        }
        
        emit Graduated(lpAmt, creatorReward, platformGets);
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
}



/// @title MonPadTokenV2
/// @notice ERC20 token launched by MonPad. All supply minted to curve at deploy.
contract MonPadTokenV2 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    
    address public curve;
    address public factory;
    bool private _curveSet;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint256 _supply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        factory = msg.sender;
        // Mint full supply to factory temporarily — factory transfers to curve in setCurve
        balanceOf[msg.sender] = _supply;
        emit Transfer(address(0), msg.sender, _supply);
    }
    
    function setCurve(address _curve) external {
        require(msg.sender == factory && !_curveSet, "set");
        curve = _curve;
        _curveSet = true;
        // Move all supply to curve
        uint256 bal = balanceOf[factory];
        balanceOf[factory] = 0;
        balanceOf[_curve] = bal;
        emit Transfer(factory, _curve, bal);
    }
    
    function transfer(address to, uint256 amt) external returns (bool) {
        return _transfer(msg.sender, to, amt);
    }
    
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amt, "!allowance");
            allowance[from][msg.sender] = a - amt;
        }
        return _transfer(from, to, amt);
    }
    
    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }
    
    function _transfer(address from, address to, uint256 amt) internal returns (bool) {
        require(to != address(0), "!to");
        require(balanceOf[from] >= amt, "!bal");
        unchecked {
            balanceOf[from] -= amt;
            balanceOf[to] += amt;
        }
        emit Transfer(from, to, amt);
        return true;
    }
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


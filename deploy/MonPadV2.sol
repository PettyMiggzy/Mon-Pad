// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* =========================================================
   MonPad V2 — Monad Mainnet
   pump.fun × nad.fun launchpad
   ========================================================= */

/* ── Interfaces ──────────────────────────────────────────── */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function allowance(address o, address s) external view returns (uint256);
    function approve(address s, uint256 a) external returns (bool);
    function transfer(address to, uint256 a) external returns (bool);
    function transferFrom(address f, address t, uint256 a) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IWETH9 is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(
        address token0, address token1, uint24 fee, uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/* ── Math ────────────────────────────────────────────────── */

library MathX {
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y == 0) return 0;
        uint256 x = y / 2 + 1;
        z = y;
        while (x < z) { z = x; x = (y / x + x) / 2; }
    }
}

/* =========================================================
   ERC20 Token
   ========================================================= */

contract MonPadToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public override totalSupply;

    address public immutable factory;
    address public curve;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    modifier onlyFactory() { require(msg.sender == factory, "NOT_FACTORY"); _; }

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
        factory = msg.sender;
    }

    function setCurve(address c) external onlyFactory {
        require(curve == address(0), "CURVE_SET");
        curve = c;
    }

    function mintToCurve(uint256 amount) external onlyFactory {
        require(curve != address(0), "NO_CURVE");
        totalSupply += amount;
        balanceOf[curve] += amount;
        emit Transfer(address(0), curve, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "ALLOW");
        if (a != type(uint256).max) {
            allowance[from][msg.sender] = a - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address f, address t, uint256 a) internal {
        require(t != address(0), "ZERO");
        uint256 b = balanceOf[f];
        require(b >= a, "BAL");
        unchecked { balanceOf[f] = b - a; balanceOf[t] += a; }
        emit Transfer(f, t, a);
    }
}

/* =========================================================
   Graduator — V3 LP mint to DEAD
   ========================================================= */

contract MonPadGraduatorV3 {
    address public immutable WMON;
    address public immutable NPM;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event LpBurnConfirmed(address indexed token, address indexed pool, uint256 indexed tokenId, address recipient);

    constructor(address wmon, address nonfungiblePositionManager) {
        WMON = wmon;
        NPM = nonfungiblePositionManager;
    }

    receive() external payable {}

    function graduateToV3(
        address token, uint24 feeTier, uint256 tokenAmount
    ) external payable returns (address pool, uint256 tokenId) {
        uint256 monAmount = msg.value;
        require(tokenAmount > 0 && monAmount > 0, "AMTS");

        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "TOKEN_PULL");
        IWETH9(WMON).deposit{value: monAmount}();

        (address token0, address token1, uint256 amt0, uint256 amt1, uint160 sqrtPriceX96) =
            _priceAndOrder(token, tokenAmount, monAmount);

        require(IERC20(token0).approve(NPM, amt0), "APP0");
        require(IERC20(token1).approve(NPM, amt1), "APP1");

        pool = INonfungiblePositionManager(NPM).createAndInitializePoolIfNecessary(
            token0, token1, feeTier, sqrtPriceX96
        );

        INonfungiblePositionManager.MintParams memory p = INonfungiblePositionManager.MintParams({
            token0: token0, token1: token1, fee: feeTier,
            tickLower: -887200, tickUpper: 887200,
            amount0Desired: amt0, amount1Desired: amt1,
            amount0Min: 0, amount1Min: 0,
            recipient: DEAD, deadline: block.timestamp + 300
        });

        uint256 used0; uint256 used1;
        (tokenId, , used0, used1) = INonfungiblePositionManager(NPM).mint(p);

        if (used0 < amt0) require(IERC20(token0).transfer(msg.sender, amt0 - used0), "REF0");
        if (used1 < amt1) require(IERC20(token1).transfer(msg.sender, amt1 - used1), "REF1");

        emit LpBurnConfirmed(token, pool, tokenId, DEAD);
    }

    function _priceAndOrder(address token, uint256 tokenAmt, uint256 monAmt)
        internal view
        returns (address token0, address token1, uint256 amt0, uint256 amt1, uint160 sqrtPriceX96)
    {
        address w = WMON;
        if (token < w) {
            token0 = token; token1 = w; amt0 = tokenAmt; amt1 = monAmt;
            sqrtPriceX96 = _sqrtPriceX96(amt1, amt0);
        } else {
            token0 = w; token1 = token; amt0 = monAmt; amt1 = tokenAmt;
            sqrtPriceX96 = _sqrtPriceX96(amt1, amt0);
        }
    }

    function _sqrtPriceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "RATIO");
        uint256 ratioX192 = (amount1 << 192) / amount0;
        uint256 r = MathX.sqrt(ratioX192);
        require(r <= type(uint160).max, "SQRT");
        return uint160(r);
    }
}

/* =========================================================
   Curve
   
   BUY fees (2% total):
     1% → creator (immediate)
     1% → stays in curve as buy buffer (paid to platform at graduation)
   
   SELL fees (2% total):
     1%   → platform (immediate)
     0.5% → creator  (immediate)
     0.5% → treasury (immediate)
   
   Graduation (425K MON raised):
     1. 25K MON → creator (marketing reward)
     2. buyBuffer → platform wallet
     3. creationFee → treasury wallet
     4. sellBuffer → platform wallet
     5. Remaining MON + tokens → V3 LP → burn
   ========================================================= */

contract MonPadCurve {
    address public immutable factory;
    address public immutable token;

    address public creator;
    address public platform;     // receives 1% sell real-time + buy buffer at grad
    address public treasury;     // receives 0.5% sell real-time + creation fee at grad
    address public graduator;

    // graduation
    uint256 public capMon;              // 425K MON total target
    uint256 public monRaisedNet;        // "raise" excluding fees
    uint256 public creatorGradReward;   // 25K MON to creator at graduation

    // token accounting
    uint256 public tokensSold;
    uint256 public maxSupply;

    // price curve (linear)
    uint256 public startPriceWeiPerToken;
    uint256 public slopeWeiPerTokenPerMon;

    // buy fee bps (total 200 = 2%)
    uint256 public buyFeeTotalBps;       // 200
    uint256 public buyFeeCreatorBps;     // 100 (immediate)
    uint256 public buyFeeBufferBps;      // 100 (stays in curve → platform at grad)

    // sell fee bps (total 200 = 2%)
    uint256 public sellFeeTotalBps;      // 200
    uint256 public sellFeePlatformBps;   // 100 (immediate)
    uint256 public sellFeeCreatorBps;    // 50  (immediate)
    uint256 public sellFeeTreasuryBps;   // 50  (immediate)

    // buffers accumulated
    uint256 public buyBufferAccrued;
    uint256 public sellBufferAccrued;    // tracking only (stays for sell liquidity)
    uint256 public creationFeeAccrued;

    bool public graduated;

    // dev freeze: creator tokens locked until graduation
    bool public devFrozen;
    uint256 public devFreezeUntil;       // block timestamp
    uint256 public devTokenAmount;       // how many tokens creator got at launch

    bool public pauseBuys;
    bool public pauseSells;
    bool public delisted;

    // bot limits
    bool public botProtect;
    uint256 public maxBuyBps;
    uint256 public cooldownBlocks;
    mapping(address => uint256) public lastBuyBlock;

    // referrer tracking
    address public referrer;

    // launch timestamp
    uint256 public launchedAt;

    // ATH tracking
    uint256 public ath;

    event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut);
    event Sell(address indexed seller, uint256 tokensIn, uint256 monOut);
    event DevBuy(address indexed dev, uint256 monIn, uint256 tokensOut);
    event DevFrozen(address indexed dev, uint256 until, uint256 bps);
    event Graduated(address pool, uint256 tokenId);
    event Delisted(bool delisted, bool buysPaused, bool sellsPaused);
    event PauseSet(bool pauseBuys, bool pauseSells);
    event ConfigUpdated(uint256 capMon);
    event WalletsUpdated(address creator, address platform, address treasury, address graduator);
    event FeesUpdated(
        uint256 buyFeeTotalBps, uint256 buyFeeCreatorBps, uint256 buyFeeBufferBps,
        uint256 sellFeeTotalBps, uint256 sellFeePlatformBps, uint256 sellFeeCreatorBps, uint256 sellFeeTreasuryBps
    );

    modifier onlyFactory() { require(msg.sender == factory, "NOT_FACTORY"); _; }
    modifier buyActive()  { require(!graduated && !pauseBuys && !delisted, "INACTIVE"); _; }
    modifier sellActive() { require(!graduated && !pauseSells, "INACTIVE"); _; }

    constructor(
        address _token,
        uint256 _maxSupply,
        address _creator,
        address _platform,
        address _treasury,
        address _graduator,
        address _referrer,
        uint256 _capMon,
        uint256 _creatorGradReward,
        uint256 _startPriceWeiPerToken,
        uint256 _slopeWeiPerTokenPerMon
    ) payable {
        factory = msg.sender;
        token = _token;
        maxSupply = _maxSupply;

        creator = _creator;
        platform = _platform;
        treasury = _treasury;
        graduator = _graduator;
        referrer = _referrer;

        capMon = _capMon;
        creatorGradReward = _creatorGradReward;
        startPriceWeiPerToken = _startPriceWeiPerToken;
        slopeWeiPerTokenPerMon = _slopeWeiPerTokenPerMon;

        launchedAt = block.timestamp;

        // Buy fees: 2% total
        buyFeeTotalBps = 200;
        buyFeeCreatorBps = 100;   // 1% immediate to creator
        buyFeeBufferBps = 100;    // 1% stays in curve → platform at graduation

        // Sell fees: 2% total
        sellFeeTotalBps = 200;
        sellFeePlatformBps = 100; // 1% immediate to platform
        sellFeeCreatorBps = 50;   // 0.5% immediate to creator
        sellFeeTreasuryBps = 50;  // 0.5% immediate to treasury

        botProtect = true;
        maxBuyBps = 250;          // 2.5% max buy
        cooldownBlocks = 1;

        // creation fee stays in curve
        if (msg.value > 0) {
            creationFeeAccrued += msg.value;
        }
    }

    receive() external payable {}

    /* ── Views ────────────────────────────────────────────── */

    function priceWeiPerToken() public view returns (uint256) {
        return startPriceWeiPerToken + (slopeWeiPerTokenPerMon * monRaisedNet) / 1e18;
    }

    /// @dev Alias for frontend compat
    function price() external view returns (uint256) {
        return priceWeiPerToken();
    }

    function bondedBps() public view returns (uint256) {
        if (capMon == 0) return 0;
        return (monRaisedNet * 10_000) / capMon;
    }

    function canGraduate() public view returns (bool) {
        return monRaisedNet >= capMon;
    }

    /* ── Admin via Factory ────────────────────────────────── */

    function setPaused(bool _pauseBuys, bool _pauseSells) external onlyFactory {
        pauseBuys = _pauseBuys;
        pauseSells = _pauseSells;
        emit PauseSet(_pauseBuys, _pauseSells);
    }

    function setDelisted(bool _delisted, bool _pauseBuys, bool _pauseSells) external onlyFactory {
        delisted = _delisted;
        pauseBuys = _pauseBuys;
        pauseSells = _pauseSells;
        emit Delisted(_delisted, _pauseBuys, _pauseSells);
    }

    function setBot(bool on, uint256 _maxBuyBps, uint256 _cooldownBlocks) external onlyFactory {
        botProtect = on;
        maxBuyBps = _maxBuyBps;
        cooldownBlocks = _cooldownBlocks;
    }

    function updateConfig(uint256 _capMon) external onlyFactory {
        capMon = _capMon;
        emit ConfigUpdated(_capMon);
    }

    function updateWallets(address _creator, address _platform, address _treasury, address _graduator) external onlyFactory {
        creator = _creator;
        platform = _platform;
        treasury = _treasury;
        graduator = _graduator;
        emit WalletsUpdated(_creator, _platform, _treasury, _graduator);
    }

    function updateFees(
        uint256 _buyFeeTotalBps,
        uint256 _buyFeeCreatorBps,
        uint256 _buyFeeBufferBps,
        uint256 _sellFeeTotalBps,
        uint256 _sellFeePlatformBps,
        uint256 _sellFeeCreatorBps,
        uint256 _sellFeeTreasuryBps
    ) external onlyFactory {
        require(_buyFeeCreatorBps + _buyFeeBufferBps == _buyFeeTotalBps, "BUY_SPLIT");
        require(_sellFeePlatformBps + _sellFeeCreatorBps + _sellFeeTreasuryBps == _sellFeeTotalBps, "SELL_SPLIT");
        
        buyFeeTotalBps = _buyFeeTotalBps;
        buyFeeCreatorBps = _buyFeeCreatorBps;
        buyFeeBufferBps = _buyFeeBufferBps;
        sellFeeTotalBps = _sellFeeTotalBps;
        sellFeePlatformBps = _sellFeePlatformBps;
        sellFeeCreatorBps = _sellFeeCreatorBps;
        sellFeeTreasuryBps = _sellFeeTreasuryBps;

        emit FeesUpdated(
            _buyFeeTotalBps, _buyFeeCreatorBps, _buyFeeBufferBps,
            _sellFeeTotalBps, _sellFeePlatformBps, _sellFeeCreatorBps, _sellFeeTreasuryBps
        );
    }

    function setCreatorGradReward(uint256 _reward) external onlyFactory {
        creatorGradReward = _reward;
    }

    function forceGraduate() external onlyFactory {
        require(!graduated, "GRAD");
        _graduate();
    }

    function unfreezeDevWallet() external onlyFactory {
        devFrozen = false;
        devFreezeUntil = 0;
    }

    /* ── Dev Buy (called by factory at launch) ────────────── */

    function devBuy() external payable onlyFactory returns (uint256 tokensOut) {
        require(msg.value > 0, "ZERO");
        require(!graduated, "GRADUATED");

        uint256 p = priceWeiPerToken();
        tokensOut = (msg.value * 1e18) / p;
        require(tokensOut > 0, "SMALL");

        uint256 remaining = IERC20(token).balanceOf(address(this));
        require(remaining >= tokensOut, "SOLD_OUT");

        // Dev buy counts toward raise (no fees on dev buy — they already paid creation fee)
        monRaisedNet += msg.value;
        tokensSold += tokensOut;
        devTokenAmount = tokensOut;

        require(IERC20(token).transfer(creator, tokensOut), "T_OUT");

        // Freeze dev tokens for 48h or until graduation
        devFrozen = true;
        devFreezeUntil = block.timestamp + 48 hours;

        // Update ATH
        uint256 newPrice = priceWeiPerToken();
        if (newPrice > ath) ath = newPrice;

        emit DevBuy(creator, msg.value, tokensOut);
        emit DevFrozen(creator, devFreezeUntil, 0);
    }

    /* ── Trading ──────────────────────────────────────────── */

    function buy(uint256 minTokensOut) external payable buyActive returns (uint256 tokensOut) {
        require(msg.value > 0, "ZERO");

        if (botProtect) {
            require(block.number >= lastBuyBlock[msg.sender] + cooldownBlocks, "COOLDOWN");
            lastBuyBlock[msg.sender] = block.number;
        }

        // Buy fees (2%): 1% creator (immediate) + 1% buffer (stays)
        uint256 feeCreator = (msg.value * buyFeeCreatorBps) / 10_000;
        uint256 feeBuffer  = (msg.value * buyFeeBufferBps) / 10_000;

        // Net raise excludes fees
        uint256 raiseNet = msg.value - feeCreator - feeBuffer;

        if (feeCreator > 0) payable(creator).transfer(feeCreator);
        if (feeBuffer > 0) buyBufferAccrued += feeBuffer;

        uint256 p = priceWeiPerToken();
        tokensOut = (raiseNet * 1e18) / p;
        require(tokensOut > 0, "SMALL");

        uint256 remaining = IERC20(token).balanceOf(address(this));
        require(remaining >= tokensOut, "SOLD_OUT");

        if (botProtect && maxBuyBps > 0) {
            uint256 max = (remaining * maxBuyBps) / 10_000;
            require(tokensOut <= max, "MAX_BUY");
        }

        require(tokensOut >= minTokensOut, "SLIP");

        monRaisedNet += raiseNet;
        tokensSold += tokensOut;

        // Update ATH
        uint256 newPrice = priceWeiPerToken();
        if (newPrice > ath) ath = newPrice;

        require(IERC20(token).transfer(msg.sender, tokensOut), "T_OUT");
        emit Buy(msg.sender, msg.value, tokensOut);

        if (canGraduate()) _graduate();
    }

    function sell(uint256 tokenAmount, uint256 minMonOut) external sellActive returns (uint256 monOut) {
        require(tokenAmount > 0, "ZERO");

        // Dev freeze check
        if (msg.sender == creator && devFrozen) {
            require(block.timestamp >= devFreezeUntil || graduated, "DEV_FROZEN");
            devFrozen = false;
        }

        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "T_IN");

        uint256 p = priceWeiPerToken();
        uint256 gross = (tokenAmount * p) / 1e18;
        uint256 bal = address(this).balance;

        if (bal == 0) {
            require(IERC20(token).transfer(msg.sender, tokenAmount), "REF_T");
            revert("NO_LIQ");
        }

        uint256 tokenUsed = tokenAmount;

        // Partial fill if not enough MON
        if (bal < gross) {
            gross = bal;
            tokenUsed = (gross * 1e18) / p;
            if (tokenUsed > tokenAmount) tokenUsed = tokenAmount;
            uint256 refund = tokenAmount - tokenUsed;
            if (refund > 0) require(IERC20(token).transfer(msg.sender, refund), "REF_T");
        }

        // Sell fees (2%): 1% platform + 0.5% creator + 0.5% treasury
        uint256 feePlatform = (gross * sellFeePlatformBps) / 10_000;
        uint256 feeCreator  = (gross * sellFeeCreatorBps) / 10_000;
        uint256 feeTreasury = (gross * sellFeeTreasuryBps) / 10_000;
        uint256 net = gross - feePlatform - feeCreator - feeTreasury;

        require(net >= minMonOut, "SLIP");

        if (feePlatform > 0) payable(platform).transfer(feePlatform);
        if (feeCreator > 0) payable(creator).transfer(feeCreator);
        if (feeTreasury > 0) payable(treasury).transfer(feeTreasury);

        payable(msg.sender).transfer(net);
        monOut = net;

        emit Sell(msg.sender, tokenUsed, net);
    }

    /* ── Graduation ───────────────────────────────────────── */

    function _graduate() internal {
        if (graduated) return;
        graduated = true;

        // Unfreeze dev on graduation
        devFrozen = false;

        uint256 monBal = address(this).balance;
        uint256 tokenBal = IERC20(token).balanceOf(address(this));
        require(monBal > 0 && tokenBal > 0, "EMPTY");

        // 1. Creator marketing reward (25K MON)
        if (creatorGradReward > 0 && monBal >= creatorGradReward) {
            uint256 reward = creatorGradReward;
            payable(creator).transfer(reward);
            monBal = address(this).balance;
        }

        // 2. Buy buffer → platform
        if (buyBufferAccrued > 0 && monBal >= buyBufferAccrued) {
            uint256 amt = buyBufferAccrued;
            buyBufferAccrued = 0;
            payable(platform).transfer(amt);
            monBal = address(this).balance;
        }

        // 3. Creation fee → treasury
        if (creationFeeAccrued > 0 && monBal >= creationFeeAccrued) {
            uint256 amt2 = creationFeeAccrued;
            creationFeeAccrued = 0;
            payable(treasury).transfer(amt2);
            monBal = address(this).balance;
        }

        // 4. Sell buffer → platform
        if (sellBufferAccrued > 0 && monBal >= sellBufferAccrued) {
            uint256 amt3 = sellBufferAccrued;
            sellBufferAccrued = 0;
            payable(platform).transfer(amt3);
            monBal = address(this).balance;
        }

        // 5. ALL remaining MON + tokens → V3 LP → burn
        uint256 finalMon = address(this).balance;
        uint256 finalToken = IERC20(token).balanceOf(address(this));

        require(IERC20(token).approve(graduator, finalToken), "APP_G");

        (address pool, uint256 tokenId) = MonPadGraduatorV3(payable(graduator)).graduateToV3{value: finalMon}(
            token, 10_000, finalToken
        );

        emit Graduated(pool, tokenId);
    }
}

/* =========================================================
   Factory
   ========================================================= */

contract MonPadFactory {
    address public owner;

    address public platform;
    address public treasury;
    address public wmon;
    address public npm;

    uint256 public capMon;
    uint256 public creationFee;
    uint256 public minDevBuy;
    uint256 public creatorGradReward;

    uint256 public startPriceWeiPerToken;
    uint256 public slopeWeiPerTokenPerMon;

    bool public emergencyPaused;

    address[] public allTokens;
    address[] public allCurves;
    address[] public allGraduators;

    mapping(address => address) public tokToCurve;

    event Launched(
        address indexed token,
        address indexed curve,
        address indexed graduator,
        address creator,
        address referrer,
        uint256 devAmt
    );
    event EmergencyPaused(bool paused);
    event OwnershipTransferred(address indexed prev, address indexed next);
    event WalletsUpdated(address platform, address treasury, address wmon, address npm);
    event DefaultsUpdated(uint256 capMon, uint256 creationFee, uint256 minDevBuy, uint256 creatorGradReward, uint256 startPriceWeiPerToken, uint256 slopeWeiPerTokenPerMon);

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }
    modifier notPaused() { require(!emergencyPaused, "FACTORY_PAUSED"); _; }

    constructor(address _platform, address _treasury, address _wmon, address _npm) {
        owner = msg.sender;
        platform = _platform;
        treasury = _treasury;
        wmon = _wmon;
        npm = _npm;

        capMon = 425_000 ether;
        creationFee = 100 ether;
        minDevBuy = 100 ether;
        creatorGradReward = 25_000 ether;

        // default pricing
        startPriceWeiPerToken = 150_000_000_000_000;  // 1.5e14 wei per token
        slopeWeiPerTokenPerMon = 2_500_000_000;
    }

    /* ── Ownership ────────────────────────────────────────── */

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "ZERO");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    /* ── Admin config ─────────────────────────────────────── */

    function setEmergencyPaused(bool p) external onlyOwner {
        emergencyPaused = p;
        emit EmergencyPaused(p);
    }

    function setWallets(address _platform, address _treasury, address _wmon, address _npm) external onlyOwner {
        platform = _platform;
        treasury = _treasury;
        wmon = _wmon;
        npm = _npm;
        emit WalletsUpdated(_platform, _treasury, _wmon, _npm);
    }

    function setDefaults(
        uint256 _capMon,
        uint256 _creationFee,
        uint256 _minDevBuy,
        uint256 _creatorGradReward,
        uint256 _startPriceWeiPerToken,
        uint256 _slopeWeiPerTokenPerMon
    ) external onlyOwner {
        capMon = _capMon;
        creationFee = _creationFee;
        minDevBuy = _minDevBuy;
        creatorGradReward = _creatorGradReward;
        startPriceWeiPerToken = _startPriceWeiPerToken;
        slopeWeiPerTokenPerMon = _slopeWeiPerTokenPerMon;

        emit DefaultsUpdated(_capMon, _creationFee, _minDevBuy, _creatorGradReward, _startPriceWeiPerToken, _slopeWeiPerTokenPerMon);
    }

    function allCounts() external view returns (uint256 t, uint256 c, uint256 g) {
        return (allTokens.length, allCurves.length, allGraduators.length);
    }

    /* ── Curve admin pass-throughs ────────────────────────── */

    function setCurvePaused(address payable curve, bool pauseBuys, bool pauseSells) external onlyOwner {
        MonPadCurve(curve).setPaused(pauseBuys, pauseSells);
    }

    function delistCurve(address payable curve, bool _delisted, bool _pauseBuys, bool _pauseSells) external onlyOwner {
        MonPadCurve(curve).setDelisted(_delisted, _pauseBuys, _pauseSells);
    }

    function setBot(address payable curve, bool on, uint256 _maxBuyBps, uint256 _cooldownBlocks) external onlyOwner {
        MonPadCurve(curve).setBot(on, _maxBuyBps, _cooldownBlocks);
    }

    function updateCurveConfig(address payable curve, uint256 _capMon) external onlyOwner {
        MonPadCurve(curve).updateConfig(_capMon);
    }

    function updateCurveWallets(
        address payable curve, address _creator, address _platform, address _treasury, address _graduator
    ) external onlyOwner {
        MonPadCurve(curve).updateWallets(_creator, _platform, _treasury, _graduator);
    }

    function updateCurveFees(
        address payable curve,
        uint256 buyFeeTotalBps, uint256 buyFeeCreatorBps, uint256 buyFeeBufferBps,
        uint256 sellFeeTotalBps, uint256 sellFeePlatformBps, uint256 sellFeeCreatorBps, uint256 sellFeeTreasuryBps
    ) external onlyOwner {
        MonPadCurve(curve).updateFees(
            buyFeeTotalBps, buyFeeCreatorBps, buyFeeBufferBps,
            sellFeeTotalBps, sellFeePlatformBps, sellFeeCreatorBps, sellFeeTreasuryBps
        );
    }

    function setCurveCreatorGradReward(address payable curve, uint256 _reward) external onlyOwner {
        MonPadCurve(curve).setCreatorGradReward(_reward);
    }

    function forceGraduate(address payable curve) external onlyOwner {
        MonPadCurve(curve).forceGraduate();
    }

    function unfreezeDevWallet(address payable curve) external onlyOwner {
        MonPadCurve(curve).unfreezeDevWallet();
    }

    /* ── Launch ───────────────────────────────────────────── */

    function createLaunch(
        string calldata name,
        string calldata symbol,
        uint256 maxSupply,
        address referrer
    ) external payable notPaused returns (address tokenAddr, address curveAddr, address gradAddr) {
        require(platform != address(0) && treasury != address(0), "WALLETS");
        require(wmon != address(0) && npm != address(0), "V3_ADDR");
        require(maxSupply > 0, "SUPPLY");

        // msg.value = creationFee + devBuyAmount
        uint256 devBuyAmt = msg.value - creationFee;
        require(msg.value >= creationFee + minDevBuy, "MIN_VALUE");
        require(devBuyAmt >= minDevBuy, "MIN_DEV_BUY");

        address tokenCreator = msg.sender;

        MonPadGraduatorV3 grad = new MonPadGraduatorV3(wmon, npm);
        MonPadToken t = new MonPadToken(name, symbol);

        // Send ONLY creation fee into curve constructor
        MonPadCurve c = (new MonPadCurve){value: creationFee}(
            address(t),
            maxSupply,
            tokenCreator,
            platform,
            treasury,
            address(grad),
            referrer,
            capMon,
            creatorGradReward,
            startPriceWeiPerToken,
            slopeWeiPerTokenPerMon
        );

        t.setCurve(address(c));
        t.mintToCurve(maxSupply);

        // Atomic dev buy — tokens go to creator, no frontrunning possible
        MonPadCurve(payable(address(c))).devBuy{value: devBuyAmt}();

        tokenAddr = address(t);
        curveAddr = address(c);
        gradAddr = address(grad);

        allTokens.push(tokenAddr);
        allCurves.push(curveAddr);
        allGraduators.push(gradAddr);

        tokToCurve[tokenAddr] = curveAddr;

        emit Launched(tokenAddr, curveAddr, gradAddr, tokenCreator, referrer, devBuyAmt);
    }
}

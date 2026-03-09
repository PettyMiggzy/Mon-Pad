// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* =========================================================
   Minimal Interfaces
   ========================================================= */

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
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/* =========================================================
   Math
   ========================================================= */

library MathX {
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y == 0) return 0;
        uint256 x = y / 2 + 1;
        z = y;
        while (x < z) {
            z = x;
            x = (y / x + x) / 2;
        }
    }
}

/* =========================================================
   ERC20 Token (minted to curve)
   - no owner, no mint after factory mintToCurve
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

    modifier onlyFactory() {
        require(msg.sender == factory, "NOT_FACTORY");
        _;
    }

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
        unchecked {
            balanceOf[f] = b - a;
            balanceOf[t] += a;
        }
        emit Transfer(f, t, a);
    }
}
/* =========================================================
   Graduator (V3 mint to DEAD)
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
        address token,
        uint24 feeTier,
        uint256 tokenAmount
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
            token0: token0,
            token1: token1,
            fee: feeTier,
            tickLower: -887200,
            tickUpper: 887200,
            amount0Desired: amt0,
            amount1Desired: amt1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: DEAD,
            deadline: block.timestamp + 300
        });

        uint256 used0;
        uint256 used1;
        (tokenId, , used0, used1) = INonfungiblePositionManager(NPM).mint(p);

        // refund leftovers to caller
        if (used0 < amt0) require(IERC20(token0).transfer(msg.sender, amt0 - used0), "REF0");
        if (used1 < amt1) require(IERC20(token1).transfer(msg.sender, amt1 - used1), "REF1");

        emit LpBurnConfirmed(token, pool, tokenId, DEAD);
    }

    function _priceAndOrder(address token, uint256 tokenAmt, uint256 monAmt)
        internal
        view
        returns (address token0, address token1, uint256 amt0, uint256 amt1, uint160 sqrtPriceX96)
    {
        address w = WMON;

        if (token < w) {
            token0 = token;
            token1 = w;
            amt0 = tokenAmt;
            amt1 = monAmt;
            sqrtPriceX96 = _sqrtPriceX96(amt1, amt0);
        } else {
            token0 = w;
            token1 = token;
            amt0 = monAmt;
            amt1 = tokenAmt;
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
   - linear price
   - BUY total fee = 2%:
        1.0% -> platform (immediate)
        0.5% -> creator  (immediate)
        0.5% -> stays in curve as BUY_BUFFER, paid to creator at graduation
     capMon counts ONLY "raise" (excludes all fees/buffers)
   - SELL total fee = 2%:
        1.0% -> stays in curve as SELL_BUFFER (helps sells)
        0.5% -> buyback (immediate)
        0.5% -> creator (immediate)
     SELL is partial-fill safe (won’t revert unless curve balance is 0)
   - creationFee (paid into curve) stays in curve; sent to buyback at graduation
   ========================================================= */

contract MonPadCurve {
    address public immutable factory;
    address public immutable token;

    address public creator;
    address public platform;
    address public buyback;
    address public graduator;

    // targets
    uint256 public capMon;          // graduation target (wei) EXCLUDES fees
    uint256 public monRaisedNet;    // "raise" amount excluding fees (wei)

    // accounting
    uint256 public tokensSold;
    uint256 public maxSupply;

    // price
    uint256 public startPriceWeiPerToken;       // wei per 1 token (1e18)
    uint256 public slopeWeiPerTokenPerMon;      // added wei/token per 1 MON raised (scaled by 1e18)

    // fee bps (all changeable)
    uint256 public buyFeeTotalBps;      // default 200
    uint256 public buyFeePlatformBps;   // default 100
    uint256 public buyFeeCreatorBps;    // default 50
    uint256 public buyFeeBufferBps;     // default 50  (stays)

    uint256 public sellFeeTotalBps;     // default 200
    uint256 public sellFeeBufferBps;    // default 100 (stays)
    uint256 public sellFeeBuybackBps;   // default 50
    uint256 public sellFeeCreatorBps;   // default 50

    // buffers accumulated (paid out at graduation)
    uint256 public buyBufferAccrued;    // wei
    uint256 public sellBufferAccrued;   // wei (optional tracking; stays for sells)
    uint256 public creationFeeAccrued;  // wei (stays; paid to buyback at grad)

    bool public graduated;

    bool public pauseBuys;
    bool public pauseSells;
    bool public delisted;

    // bot limits
    bool public botProtect;
    uint256 public maxBuyBps;
    uint256 public cooldownBlocks;
    mapping(address => uint256) public lastBuyBlock;

    event Buy(address indexed buyer, uint256 monIn, uint256 tokensOut);
    event Sell(address indexed seller, uint256 tokensIn, uint256 monOut);
    event Graduated(address pool, uint256 tokenId);

    event Delisted(bool delisted, bool buysPaused, bool sellsPaused);
    event PauseSet(bool pauseBuys, bool pauseSells);

    event ConfigUpdated(uint256 capMon);
    event WalletsUpdated(address creator, address platform, address buyback, address graduator);

    event FeesUpdated(
        uint256 buyFeeTotalBps,
        uint256 buyFeePlatformBps,
        uint256 buyFeeCreatorBps,
        uint256 buyFeeBufferBps,
        uint256 sellFeeTotalBps,
        uint256 sellFeeBufferBps,
        uint256 sellFeeBuybackBps,
        uint256 sellFeeCreatorBps
    );

    modifier onlyFactory() {
        require(msg.sender == factory, "NOT_FACTORY");
        _;
    }

    modifier buyActive() {
        require(!graduated, "GRADUATED");
        require(!pauseBuys, "BUYS_PAUSED");
        require(!delisted, "DELISTED");
        _;
    }

    modifier sellActive() {
        require(!graduated, "GRADUATED");
        require(!pauseSells, "SELLS_PAUSED");
        _;
    }

    constructor(
        address _token,
        uint256 _maxSupply,
        address _creator,
        address _platform,
        address _buyback,
        address _graduator,
        uint256 _capMon,
        uint256 _startPriceWeiPerToken,
        uint256 _slopeWeiPerTokenPerMon
    ) payable {
        factory = msg.sender;
        token = _token;
        maxSupply = _maxSupply;

        creator = _creator;
        platform = _platform;
        buyback = _buyback;
        graduator = _graduator;

        capMon = _capMon;
        startPriceWeiPerToken = _startPriceWeiPerToken;
        slopeWeiPerTokenPerMon = _slopeWeiPerTokenPerMon;

        // defaults: 2% buy / 2% sell
        buyFeeTotalBps = 200;
        buyFeePlatformBps = 100;
        buyFeeCreatorBps = 50;
        buyFeeBufferBps = 50;

        sellFeeTotalBps = 200;
        sellFeeBufferBps = 100;
        sellFeeBuybackBps = 50;
        sellFeeCreatorBps = 50;

        botProtect = true;
        maxBuyBps = 250; // 2.5% of remaining
        cooldownBlocks = 1;

        // msg.value here is creation fee sent from factory
        if (msg.value > 0) {
            creationFeeAccrued += msg.value;
        }
    }

    receive() external payable {}

    /* ---------- Views ---------- */

    function priceWeiPerToken() public view returns (uint256) {
        // slope is per 1 MON, so scale monRaisedNet (wei) by 1e18
        return startPriceWeiPerToken + (slopeWeiPerTokenPerMon * monRaisedNet) / 1e18;
    }

    function bondedBps() public view returns (uint256) {
        if (capMon == 0) return 0;
        return (monRaisedNet * 10_000) / capMon;
    }

    function canGraduate() public view returns (bool) {
        return monRaisedNet >= capMon;
    }

    /* ---------- Admin via Factory ---------- */

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

    function updateWallets(address _creator, address _platform, address _buyback, address _graduator) external onlyFactory {
        creator = _creator;
        platform = _platform;
        buyback = _buyback;
        graduator = _graduator;
        emit WalletsUpdated(_creator, _platform, _buyback, _graduator);
    }

    function updateFees(
        uint256 _buyFeeTotalBps,
        uint256 _buyFeePlatformBps,
        uint256 _buyFeeCreatorBps,
        uint256 _buyFeeBufferBps,
        uint256 _sellFeeTotalBps,
        uint256 _sellFeeBufferBps,
        uint256 _sellFeeBuybackBps,
        uint256 _sellFeeCreatorBps
    ) external onlyFactory {
        require(
            _buyFeePlatformBps + _buyFeeCreatorBps + _buyFeeBufferBps == _buyFeeTotalBps,
            "BUY_SPLIT"
        );
        require(
            _sellFeeBufferBps + _sellFeeBuybackBps + _sellFeeCreatorBps == _sellFeeTotalBps,
            "SELL_SPLIT"
        );
        buyFeeTotalBps = _buyFeeTotalBps;
        buyFeePlatformBps = _buyFeePlatformBps;
        buyFeeCreatorBps = _buyFeeCreatorBps;
        buyFeeBufferBps = _buyFeeBufferBps;

        sellFeeTotalBps = _sellFeeTotalBps;
        sellFeeBufferBps = _sellFeeBufferBps;
        sellFeeBuybackBps = _sellFeeBuybackBps;
        sellFeeCreatorBps = _sellFeeCreatorBps;

        emit FeesUpdated(
            _buyFeeTotalBps, _buyFeePlatformBps, _buyFeeCreatorBps, _buyFeeBufferBps,
            _sellFeeTotalBps, _sellFeeBufferBps, _sellFeeBuybackBps, _sellFeeCreatorBps
        );
    }

    function forceGraduate() external onlyFactory {
        require(!graduated, "GRAD");
        _graduate();
    }

    /* ---------- Trading ---------- */

    function buy(uint256 minTokensOut) external payable buyActive returns (uint256 tokensOut) {
        require(msg.value > 0, "ZERO");

        if (botProtect) {
            require(block.number >= lastBuyBlock[msg.sender] + cooldownBlocks, "COOLDOWN");
            lastBuyBlock[msg.sender] = block.number;
        }

        // buy fees (2%)
        uint256 feePlatform = (msg.value * buyFeePlatformBps) / 10_000;
        uint256 feeCreator  = (msg.value * buyFeeCreatorBps) / 10_000;
        uint256 feeBuffer   = (msg.value * buyFeeBufferBps) / 10_000;

        // "raise" amount excludes all fees (matches your requirement)
        uint256 raiseNet = msg.value - feePlatform - feeCreator - feeBuffer;

        if (feePlatform > 0) payable(platform).transfer(feePlatform);
        if (feeCreator > 0) payable(creator).transfer(feeCreator);

        // buffer stays in curve balance
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

        require(IERC20(token).transfer(msg.sender, tokensOut), "T_OUT");
        emit Buy(msg.sender, msg.value, tokensOut);

        if (canGraduate()) _graduate();
    }

    // PARTIAL-FILL SAFE SELL:
    // - if curve can't pay full gross, it pays what it has (minus fees)
    // - refunds unused tokens back to seller
    function sell(uint256 tokenAmount, uint256 minMonOut) external sellActive returns (uint256 monOut) {
        require(tokenAmount > 0, "ZERO");

        // pull full amount, we might refund some back
        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "T_IN");

        uint256 p = priceWeiPerToken();
        uint256 gross = (tokenAmount * p) / 1e18;

        uint256 bal = address(this).balance;

        if (bal == 0) {
            // refund all tokens if no MON at all
            require(IERC20(token).transfer(msg.sender, tokenAmount), "REF_T");
            revert("NO_LIQ");
        }

        uint256 tokenUsed = tokenAmount;

        // If not enough MON, scale down to what we can pay
        if (bal < gross) {
            gross = bal;
            tokenUsed = (gross * 1e18) / p;
            if (tokenUsed > tokenAmount) tokenUsed = tokenAmount;

            uint256 refund = tokenAmount - tokenUsed;
            if (refund > 0) require(IERC20(token).transfer(msg.sender, refund), "REF_T");
        }

        // sell fees (2% total)
        uint256 feeBuffer  = (gross * sellFeeBufferBps) / 10_000;   // stays
        uint256 feeBuyback = (gross * sellFeeBuybackBps) / 10_000;  // immediate
        uint256 feeCreator = (gross * sellFeeCreatorBps) / 10_000;  // immediate
        uint256 net = gross - feeBuffer - feeBuyback - feeCreator;

        require(net >= minMonOut, "SLIP");

        // buffer stays in curve balance
        if (feeBuffer > 0) sellBufferAccrued += feeBuffer;

        if (feeBuyback > 0) payable(buyback).transfer(feeBuyback);
        if (feeCreator > 0) payable(creator).transfer(feeCreator);

        payable(msg.sender).transfer(net);
        monOut = net;

        emit Sell(msg.sender, tokenUsed, net);
    }

    function _graduate() internal {
        if (graduated) return;
        graduated = true;

        uint256 monBal = address(this).balance;
        uint256 tokenBal = IERC20(token).balanceOf(address(this));
        require(monBal > 0 && tokenBal > 0, "EMPTY");

        // pay buffers at graduation
        // - buy buffer -> creator
        if (buyBufferAccrued > 0 && monBal >= buyBufferAccrued) {
            uint256 amt = buyBufferAccrued;
            buyBufferAccrued = 0;
            payable(creator).transfer(amt);
            monBal = address(this).balance;
        }

        // - creation fee -> buyback
        if (creationFeeAccrued > 0 && monBal >= creationFeeAccrued) {
            uint256 amt2 = creationFeeAccrued;
            creationFeeAccrued = 0;
            payable(buyback).transfer(amt2);
            monBal = address(this).balance;
        }

        // keep sellBuffer inside curve for safety during bonding,
        // but AFTER graduation we can send it to platform dev (your request)
        if (sellBufferAccrued > 0 && monBal >= sellBufferAccrued) {
            uint256 amt3 = sellBufferAccrued;
            sellBufferAccrued = 0;
            payable(platform).transfer(amt3);
            monBal = address(this).balance;
        }

        // graduate ALL remaining MON + tokens into V3, LP minted to DEAD
        uint256 finalMon = address(this).balance;
        uint256 finalToken = IERC20(token).balanceOf(address(this));

        require(IERC20(token).approve(graduator, finalToken), "APP_G");

        (address pool, uint256 tokenId) = MonPadGraduatorV3(payable(graduator)).graduateToV3{value: finalMon}(
            token,
            10_000, // 1% fee tier
            finalToken
        );

        emit Graduated(pool, tokenId);
    }
}
/* =========================================================
   Factory
   - deploys: Graduator + Token + Curve
   - creator is ALWAYS msg.sender of createLaunch
   - requires msg.value == creationFee (10 MON default)
   ========================================================= */

contract MonPadFactory {
    address public owner;

    address public platform;
    address public buyback;
    address public wmon;
    address public npm;

    uint256 public capMon;          // 400k MON default
    uint256 public creationFee;     // 10 MON default

    uint256 public startPriceWeiPerToken;
    uint256 public slopeWeiPerTokenPerMon;

    bool public emergencyPaused;

    address[] public allTokens;
    address[] public allCurves;
    address[] public allGraduators;

    event Launched(address indexed token, address indexed curve, address indexed graduator, address creator);
    event EmergencyPaused(bool paused);
    event OwnershipTransferred(address indexed prev, address indexed next);

    event WalletsUpdated(address platform, address buyback, address wmon, address npm);
    event DefaultsUpdated(uint256 capMon, uint256 creationFee, uint256 startPriceWeiPerToken, uint256 slopeWeiPerTokenPerMon);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier notPaused() {
        require(!emergencyPaused, "FACTORY_PAUSED");
        _;
    }

    constructor(address _platform, address _buyback, address _wmon, address _npm) {
        owner = msg.sender;

        platform = _platform;
        buyback = _buyback;
        wmon = _wmon;
        npm = _npm;

        capMon = 400_000 ether;
        creationFee = 10 ether;

        // default “~3k+ start MC” feel (tunable)
        startPriceWeiPerToken = 150_000_000_000_000; // 1.5e14 wei per token
        slopeWeiPerTokenPerMon = 2_500_000_000;      // tunable
    }

    /* ---------- Ownership ---------- */

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "ZERO");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    /* ---------- Admin config ---------- */

    function setEmergencyPaused(bool p) external onlyOwner {
        emergencyPaused = p;
        emit EmergencyPaused(p);
    }

    function setWallets(address _platform, address _buyback, address _wmon, address _npm) external onlyOwner {
        platform = _platform;
        buyback = _buyback;
        wmon = _wmon;
        npm = _npm;
        emit WalletsUpdated(_platform, _buyback, _wmon, _npm);
    }

    // matches your Remix tx: setDefaults(uint256,uint256,uint256,uint256)
    function setDefaults(
        uint256 _capMon,
        uint256 _creationFee,
        uint256 _startPriceWeiPerToken,
        uint256 _slopeWeiPerTokenPerMon
    ) external onlyOwner {
        capMon = _capMon;
        creationFee = _creationFee;
        startPriceWeiPerToken = _startPriceWeiPerToken;
        slopeWeiPerTokenPerMon = _slopeWeiPerTokenPerMon;

        emit DefaultsUpdated(_capMon, _creationFee, _startPriceWeiPerToken, _slopeWeiPerTokenPerMon);
    }

    function allCounts() external view returns (uint256 tokens, uint256 curves, uint256 grads) {
        return (allTokens.length, allCurves.length, allGraduators.length);
    }

    /* ---------- Curve admin (owner -> curve via factory) ---------- */

    function setCurvePaused(address payable curve, bool pauseBuys, bool pauseSells) external onlyOwner {
        MonPadCurve(curve).setPaused(pauseBuys, pauseSells);
    }

    function delistCurve(address payable curve, bool delisted, bool pauseBuys, bool pauseSells) external onlyOwner {
        MonPadCurve(curve).setDelisted(delisted, pauseBuys, pauseSells);
    }

    function setBot(
        address payable curve,
        bool on,
        uint256 maxBuyBps,
        uint256 cooldownBlocks
    ) external onlyOwner {
        MonPadCurve(curve).setBot(on, maxBuyBps, cooldownBlocks);
    }

    function updateCurveConfig(address payable curve, uint256 _capMon) external onlyOwner {
        MonPadCurve(curve).updateConfig(_capMon);
    }

    function updateCurveWallets(
        address payable curve,
        address _creator,
        address _platform,
        address _buyback,
        address _graduator
    ) external onlyOwner {
        MonPadCurve(curve).updateWallets(_creator, _platform, _buyback, _graduator);
    }

    function updateCurveFees(
        address payable curve,
        uint256 buyFeeTotalBps,
        uint256 buyFeePlatformBps,
        uint256 buyFeeCreatorBps,
        uint256 buyFeeBufferBps,
        uint256 sellFeeTotalBps,
        uint256 sellFeeBufferBps,
        uint256 sellFeeBuybackBps,
        uint256 sellFeeCreatorBps
    ) external onlyOwner {
        MonPadCurve(curve).updateFees(
            buyFeeTotalBps, buyFeePlatformBps, buyFeeCreatorBps, buyFeeBufferBps,
            sellFeeTotalBps, sellFeeBufferBps, sellFeeBuybackBps, sellFeeCreatorBps
        );
    }

    function forceGraduate(address payable curve) external onlyOwner {
        MonPadCurve(curve).forceGraduate();
    }

    /* ---------- Launch ---------- */

    function createLaunch(
        string calldata name,
        string calldata symbol,
        uint256 maxSupply
    ) external payable notPaused returns (address token, address curve, address graduator) {
        require(platform != address(0) && buyback != address(0), "WALLETS");
        require(wmon != address(0) && npm != address(0), "V3_ADDR");
        require(maxSupply > 0, "SUPPLY");

        // require creation fee
        require(msg.value == creationFee, "CREATION_FEE");

        address creator = msg.sender;

        MonPadGraduatorV3 grad = new MonPadGraduatorV3(wmon, npm);
        MonPadToken t = new MonPadToken(name, symbol);

        // send creation fee INTO curve (stays there, paid out at graduation per your rule)
        MonPadCurve c = (new MonPadCurve){value: msg.value}(
            address(t),
            maxSupply,
            creator,
            platform,
            buyback,
            address(grad),
            capMon,
            startPriceWeiPerToken,
            slopeWeiPerTokenPerMon
        );

        t.setCurve(address(c));
        t.mintToCurve(maxSupply);

        token = address(t);
        curve = address(c);
        graduator = address(grad);

        allTokens.push(token);
        allCurves.push(curve);
        allGraduators.push(graduator);

        emit Launched(token, curve, graduator, creator);
    }
}
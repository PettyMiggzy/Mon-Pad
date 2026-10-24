// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MonpadToken} from "./MonpadToken.sol";
import {IUniswapV3Pool, IUniswapV3Factory, INonfungiblePositionManager, IWMON} from "./interfaces/IUniswap.sol";

/// @title MonpadLauncher (V4)
/// @notice One transaction launches a token straight into a REAL Uniswap V3 pool (WMON, 1% tier).
///         No bonding curve, no graduation. The whole supply sits in one single-sided position that
///         this contract owns forever: there is NO function that removes liquidity or moves the
///         position NFT, so liquidity is locked by construction. Swap fees are collected with
///         `harvest` and split 70/10/10/10:
///           WMON side : 70% creator · 10% platform · 10% buys and burns MONSHI · 10% buys and burns the token
///           token side: 70% creator · 10% platform · 20% burned (the two burn slices, in the token itself)
///         Not audited. Do not put real value behind it before a professional audit.
contract MonpadLauncher is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── fixed economics (immutable by being constants: no setter exists) ─────────
    uint16 public constant CREATOR_BPS = 7000;
    uint16 public constant PLATFORM_BPS = 1000;
    uint16 public constant BURN_MONSHI_BPS = 1000;
    uint16 public constant BURN_TOKEN_BPS = 1000; // remainder after the three above, so no dust is lost
    uint16 public constant BPS = 10_000;

    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint24 public constant FEE_TIER = 10_000; // 1%
    int24 public constant TICK_SPACING = 200;
    int24 public constant MAX_TICK = 887_200; // 887272 rounded down to the 200 spacing
    int24 public constant MIN_TICK = -887_200;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // ── oracle / buyback guards ──────────────────────────────────────────────────
    uint16 public constant CARDINALITY = 120;
    uint32 public constant TWAP_WINDOW = 600; // seconds
    int24 public constant MAX_SPOT_TWAP_TICKS = 300; // about 3%
    uint16 public constant MAX_SWAP_IMPACT_BPS = 300; // sqrt-price limit = 1.5% either way
    uint256 public constant BUYBACK_COOLDOWN = 10 minutes;
    uint256 public constant BUYBACK_FULL_BELOW = 400 ether; // below this, one call may spend the whole reserve
    uint256 public constant MIN_BUYBACK = 1 ether;

    // ── launch limits ────────────────────────────────────────────────────────────
    uint256 public constant MAX_CREATION_FEE = 10_000 ether;
    uint16 public constant MAX_DEV_BUY_BPS = 500; // a dev may buy at most 5% of supply in the launch tx
    uint256 public constant MONSHI_POOL_DELAY = 48 hours;

    // ── immutable wiring ─────────────────────────────────────────────────────────
    INonfungiblePositionManager public immutable npm;
    IUniswapV3Factory public immutable uniFactory;
    address public immutable wmon;
    address public immutable monshi;
    int24 public immutable startTick; // tick where price (WMON per token) = start market cap / supply
    uint160 public immutable sqrtAtStartTick; // sqrt price at startTick
    uint160 public immutable sqrtAtNegStartTick; // sqrt price at -startTick

    // ── mutable (owner, never touches user funds) ────────────────────────────────
    address public platform;
    uint256 public creationFee;
    bool public launchPaused;
    address public monshiPool;
    address public pendingMonshiPool;
    uint256 public pendingMonshiPoolAt;

    struct Launch {
        address token;
        address pool;
        address creator;
        uint256 positionId;
        bool wmonIs0;
        uint64 lastBuyback;
    }

    mapping(address => Launch) public launches; // by token
    address[] public allTokens;
    mapping(address => mapping(address => uint256)) public claimable; // account => asset (0 = native MON)
    uint256 public monshiReserve; // WMON waiting to buy and burn MONSHI
    uint64 public lastMonshiBuyback;
    mapping(address => uint256) public tokenReserve; // token => WMON waiting to buy and burn it

    address private _swapPool;
    bool private _swapWmonIs0;

    event Launched(
        address indexed token,
        address indexed creator,
        address indexed pool,
        uint256 positionId,
        string name,
        string symbol,
        uint256 devBuyTokens
    );
    event Harvested(address indexed token, uint256 wmonFees, uint256 tokenFees);
    event Claimed(address indexed account, address indexed asset, uint256 amount);
    event BuybackBurn(address indexed target, uint256 wmonSpent, uint256 burned);
    event CreatorChanged(address indexed token, address indexed oldCreator, address indexed newCreator);
    event PlatformChanged(address indexed platform);
    event CreationFeeChanged(uint256 fee);
    event LaunchPaused(bool paused);
    event MonshiPoolProposed(address indexed pool, uint256 executableAt);
    event MonshiPoolSet(address indexed pool);

    constructor(
        address owner_,
        address platform_,
        address npm_,
        address monshi_,
        int24 startTick_,
        uint160 sqrtAtStartTick_,
        uint160 sqrtAtNegStartTick_,
        uint256 creationFee_,
        uint24 monshiFee_
    ) Ownable(owner_) {
        require(platform_ != address(0) && npm_ != address(0) && monshi_ != address(0), "zero addr");
        require(creationFee_ <= MAX_CREATION_FEE, "fee too high");
        require(startTick_ % TICK_SPACING == 0 && startTick_ > MIN_TICK && startTick_ < MAX_TICK, "bad tick");
        require(sqrtAtStartTick_ > MIN_SQRT_RATIO && sqrtAtStartTick_ < MAX_SQRT_RATIO, "bad sqrt");
        require(sqrtAtNegStartTick_ > MIN_SQRT_RATIO && sqrtAtNegStartTick_ < MAX_SQRT_RATIO, "bad sqrt");
        // the two sqrt prices must be reciprocals: a * b == 2^192 (checked to 1e-9)
        uint256 prod = uint256(sqrtAtStartTick_) * uint256(sqrtAtNegStartTick_);
        uint256 one = uint256(1) << 192;
        uint256 diff = prod > one ? prod - one : one - prod;
        require(diff * 1e9 <= one, "sqrt mismatch");

        npm = INonfungiblePositionManager(npm_);
        uniFactory = IUniswapV3Factory(INonfungiblePositionManager(npm_).factory());
        wmon = INonfungiblePositionManager(npm_).WETH9();
        monshi = monshi_;
        startTick = startTick_;
        sqrtAtStartTick = sqrtAtStartTick_;
        sqrtAtNegStartTick = sqrtAtNegStartTick_;
        platform = platform_;
        creationFee = creationFee_;

        address mp = IUniswapV3Factory(INonfungiblePositionManager(npm_).factory()).getPool(
            monshi_, INonfungiblePositionManager(npm_).WETH9(), monshiFee_
        );
        monshiPool = mp; // may be zero: MONSHI buybacks stay disabled until a pool is set
    }

    receive() external payable {
        require(msg.sender == wmon, "only WMON");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Launch
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Predict the token address a launch will get (CREATE2, salted by the creator).
    function predictToken(address creator, bytes32 salt, string memory name_, string memory symbol_)
        external
        view
        returns (address)
    {
        bytes32 h = keccak256(
            abi.encodePacked(type(MonpadToken).creationCode, abi.encode(name_, symbol_, SUPPLY, address(this)))
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), keccak256(abi.encode(creator, salt)), h))))
        );
    }

    /// @notice Launch a token. `msg.value` = creation fee + optional dev buy (spent on the new pool at the
    ///         launch price, capped at 5% of supply). Everything happens in this one transaction.
    function launch(string calldata name_, string calldata symbol_, bytes32 salt)
        external
        payable
        nonReentrant
        returns (address token, uint256 positionId)
    {
        require(!launchPaused, "launches paused");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "bad name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "bad symbol");
        require(msg.value >= creationFee, "fee");
        uint256 devBuy = msg.value - creationFee;

        token = address(new MonpadToken{salt: keccak256(abi.encode(msg.sender, salt))}(name_, symbol_, SUPPLY, address(this)));

        bool wmonIs0 = wmon < token;
        (address pool, uint256 id) = _seedPool(token, wmonIs0);
        positionId = id;

        launches[token] = Launch({
            token: token,
            pool: pool,
            creator: msg.sender,
            positionId: id,
            wmonIs0: wmonIs0,
            lastBuyback: 0
        });
        allTokens.push(token);

        if (creationFee > 0) claimable[platform][address(0)] += creationFee;

        uint256 bought;
        if (devBuy > 0) bought = _devBuy(pool, wmonIs0, devBuy, msg.sender);

        emit Launched(token, msg.sender, pool, id, name_, symbol_, bought);
    }

    function _seedPool(address token, bool wmonIs0) internal returns (address pool, uint256 id) {
        // wmon is token0 => price = token per WMON => tick = -startTick and the single-sided token1 range sits below it.
        // token is token0 => price = WMON per token => tick = startTick and the single-sided token0 range sits above it.
        uint160 sqrtP = wmonIs0 ? sqrtAtNegStartTick : sqrtAtStartTick;
        int24 spawnTick = wmonIs0 ? -startTick : startTick;
        (address t0, address t1) = wmonIs0 ? (wmon, token) : (token, wmon);

        pool = npm.createAndInitializePoolIfNecessary(t0, t1, FEE_TIER, sqrtP);
        require(IUniswapV3Pool(pool).tickSpacing() == TICK_SPACING, "tier");
        {
            (uint160 sqrtNow, int24 tickNow,,,,,) = IUniswapV3Pool(pool).slot0();
            // proves we set the price: a pre-initialised pool at another price makes the launch revert (funds stay safe)
            require(sqrtNow == sqrtP && tickNow == spawnTick, "pool pre-initialised");
        }
        IUniswapV3Pool(pool).increaseObservationCardinalityNext(CARDINALITY);

        IERC20(token).forceApprove(address(npm), SUPPLY);
        INonfungiblePositionManager.MintParams memory p = INonfungiblePositionManager.MintParams({
            token0: t0,
            token1: t1,
            fee: FEE_TIER,
            tickLower: wmonIs0 ? MIN_TICK : startTick,
            tickUpper: wmonIs0 ? -startTick : MAX_TICK,
            amount0Desired: wmonIs0 ? 0 : SUPPLY,
            amount1Desired: wmonIs0 ? SUPPLY : 0,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp
        });
        (uint256 positionId,, uint256 a0, uint256 a1) = npm.mint(p);
        id = positionId;

        (uint256 wmonUsed, uint256 tokenUsed) = wmonIs0 ? (a0, a1) : (a1, a0);
        require(wmonUsed == 0, "not single-sided");
        require(tokenUsed >= SUPPLY - SUPPLY / 1_000_000, "position too small");
        IERC20(token).forceApprove(address(npm), 0);

        // burn the rounding dust so the whole supply is accounted for
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(DEAD, dust);
    }

    function _devBuy(address pool, bool wmonIs0, uint256 amountIn, address to) internal returns (uint256 received) {
        IWMON(wmon).deposit{value: amountIn}();
        uint160 limit = wmonIs0 ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1;
        uint256 consumed;
        (consumed, received) = _swapExactWmon(pool, wmonIs0, amountIn, to, limit);
        require(consumed == amountIn, "dev buy not filled");
        require(received <= (SUPPLY * MAX_DEV_BUY_BPS) / BPS, "dev buy over cap");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Fees: harvest, split, claim
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Collect a token's swap fees and split them. Anyone can call.
    function harvest(address token) external nonReentrant {
        Launch storage L = launches[token];
        require(L.token != address(0), "unknown token");

        (uint256 a0, uint256 a1) = npm.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: L.positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        (uint256 wmonFees, uint256 tokenFees) = L.wmonIs0 ? (a0, a1) : (a1, a0);

        if (wmonFees > 0) {
            uint256 toCreator = (wmonFees * CREATOR_BPS) / BPS;
            uint256 toPlatform = (wmonFees * PLATFORM_BPS) / BPS;
            uint256 toMonshi = (wmonFees * BURN_MONSHI_BPS) / BPS;
            uint256 toToken = wmonFees - toCreator - toPlatform - toMonshi;

            IWMON(wmon).withdraw(toCreator + toPlatform);
            claimable[L.creator][address(0)] += toCreator;
            claimable[platform][address(0)] += toPlatform;
            monshiReserve += toMonshi;
            tokenReserve[token] += toToken;
        }
        if (tokenFees > 0) {
            uint256 toCreator = (tokenFees * CREATOR_BPS) / BPS;
            uint256 toPlatform = (tokenFees * PLATFORM_BPS) / BPS;
            uint256 toBurn = tokenFees - toCreator - toPlatform;
            claimable[L.creator][token] += toCreator;
            claimable[platform][token] += toPlatform;
            if (toBurn > 0) IERC20(token).safeTransfer(DEAD, toBurn);
        }
        emit Harvested(token, wmonFees, tokenFees);
    }

    /// @notice Withdraw what the caller is owed. `asset` = address(0) for native MON, else a token address.
    function claim(address asset) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][asset];
        require(amount > 0, "nothing to claim");
        claimable[msg.sender][asset] = 0;
        if (asset == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "send failed");
        } else {
            IERC20(asset).safeTransfer(msg.sender, amount);
        }
        emit Claimed(msg.sender, asset, amount);
    }

    /// @notice The creator can hand future fee rights to another address (fees already accrued stay claimable).
    function setCreator(address token, address newCreator) external {
        Launch storage L = launches[token];
        require(L.token != address(0), "unknown token");
        require(msg.sender == L.creator, "not creator");
        require(newCreator != address(0), "zero addr");
        emit CreatorChanged(token, L.creator, newCreator);
        L.creator = newCreator;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Buy and burn (permissionless, oracle-gated)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Spend a token's WMON reserve buying that token on its own pool; the tokens go to the dead address.
    function buybackToken(address token, uint256 maxWmon) external nonReentrant returns (uint256 burned) {
        Launch storage L = launches[token];
        require(L.token != address(0), "unknown token");
        require(block.timestamp >= uint256(L.lastBuyback) + BUYBACK_COOLDOWN, "cooldown");
        uint256 spent;
        (spent, burned) = _buyback(L.pool, L.wmonIs0, tokenReserve[token], maxWmon);
        tokenReserve[token] -= spent;
        L.lastBuyback = uint64(block.timestamp);
        emit BuybackBurn(token, spent, burned);
    }

    /// @notice Spend the MONSHI reserve buying MONSHI on its WMON pool; the MONSHI goes to the dead address.
    function buybackMonshi(uint256 maxWmon) external nonReentrant returns (uint256 burned) {
        require(monshiPool != address(0), "no MONSHI pool");
        require(block.timestamp >= uint256(lastMonshiBuyback) + BUYBACK_COOLDOWN, "cooldown");
        bool wmonIs0 = wmon < monshi;
        uint256 spent;
        (spent, burned) = _buyback(monshiPool, wmonIs0, monshiReserve, maxWmon);
        monshiReserve -= spent;
        lastMonshiBuyback = uint64(block.timestamp);
        emit BuybackBurn(monshi, spent, burned);
    }

    function _buyback(address pool, bool wmonIs0, uint256 reserve, uint256 maxWmon)
        internal
        returns (uint256 spent, uint256 received)
    {
        require(reserve > 0, "empty reserve");
        uint256 amountIn = maxWmon < reserve ? maxWmon : reserve;
        uint256 cap = reserve > BUYBACK_FULL_BELOW ? reserve / 4 : reserve;
        if (amountIn > cap) amountIn = cap;
        require(amountIn >= MIN_BUYBACK || amountIn == reserve, "too small");

        // oracle gate: spot must be close to the 10-minute TWAP, or this call reverts (fail-closed)
        _requireSpotNearTwap(pool);

        (uint160 sqrtSpot,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint256 delta = (uint256(sqrtSpot) * (MAX_SWAP_IMPACT_BPS / 2)) / BPS;
        uint160 limit;
        if (wmonIs0) {
            limit = uint160(uint256(sqrtSpot) - delta);
            if (limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1;
        } else {
            limit = uint160(uint256(sqrtSpot) + delta);
            if (limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1;
        }
        (spent, received) = _swapExactWmon(pool, wmonIs0, amountIn, DEAD, limit);
        require(spent > 0, "no fill");
    }

    function _requireSpotNearTwap(address pool) internal view {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP_WINDOW;
        ago[1] = 0;
        (int56[] memory cum,) = IUniswapV3Pool(pool).observe(ago); // reverts if the pool has less history than the window
        int56 d = cum[1] - cum[0];
        int56 win = int56(uint56(TWAP_WINDOW));
        int24 mean = int24(d / win);
        if (d < 0 && (d % win != 0)) mean--;
        (, int24 spot,,,,,) = IUniswapV3Pool(pool).slot0();
        int256 dev = int256(spot) - int256(mean);
        if (dev < 0) dev = -dev;
        require(dev <= int256(MAX_SPOT_TWAP_TICKS), "spot far from twap");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Swap plumbing (direct pool swaps; callback only pays WMON to the expected pool)
    // ═════════════════════════════════════════════════════════════════════════════

    function _swapExactWmon(address pool, bool wmonIs0, uint256 amountIn, address to, uint160 limit)
        internal
        returns (uint256 consumed, uint256 received)
    {
        require(amountIn <= uint256(type(int256).max), "amount");
        _swapPool = pool;
        _swapWmonIs0 = wmonIs0;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(to, wmonIs0, int256(amountIn), limit, "");
        _swapPool = address(0);
        (int256 inDelta, int256 outDelta) = wmonIs0 ? (a0, a1) : (a1, a0);
        require(inDelta >= 0 && outDelta <= 0, "bad swap");
        consumed = uint256(inDelta);
        received = uint256(-outDelta);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == _swapPool && _swapPool != address(0), "bad pool");
        (int256 inDelta, int256 outDelta) = _swapWmonIs0 ? (amount0Delta, amount1Delta) : (amount1Delta, amount0Delta);
        require(inDelta >= 0 && outDelta <= 0, "bad delta");
        if (inDelta > 0) IWMON(wmon).transfer(msg.sender, uint256(inDelta));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Owner controls: nothing here can touch liquidity, fees owed, or reserves
    // ═════════════════════════════════════════════════════════════════════════════

    function setPlatform(address platform_) external onlyOwner {
        require(platform_ != address(0), "zero addr");
        platform = platform_;
        emit PlatformChanged(platform_);
    }

    function setCreationFee(uint256 fee_) external onlyOwner {
        require(fee_ <= MAX_CREATION_FEE, "fee too high");
        creationFee = fee_;
        emit CreationFeeChanged(fee_);
    }

    /// @notice Pause NEW launches only. Harvest, claim and buyback always work.
    function setLaunchPaused(bool paused) external onlyOwner {
        launchPaused = paused;
        emit LaunchPaused(paused);
    }

    /// @notice Point MONSHI buybacks at another official-Uniswap pool (any fee tier) after a 48h delay.
    function proposeMonshiPool(uint24 fee_) external onlyOwner {
        address p = uniFactory.getPool(monshi, wmon, fee_);
        require(p != address(0), "no such pool");
        pendingMonshiPool = p;
        pendingMonshiPoolAt = block.timestamp + MONSHI_POOL_DELAY;
        emit MonshiPoolProposed(p, pendingMonshiPoolAt);
    }

    function executeMonshiPool() external onlyOwner {
        require(pendingMonshiPool != address(0), "nothing pending");
        require(block.timestamp >= pendingMonshiPoolAt, "too early");
        monshiPool = pendingMonshiPool;
        pendingMonshiPool = address(0);
        pendingMonshiPoolAt = 0;
        emit MonshiPoolSet(monshiPool);
    }

    function renounceOwnership() public pure override {
        revert("disabled");
    }

    // ── views ───────────────────────────────────────────────────────────────────
    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }
}

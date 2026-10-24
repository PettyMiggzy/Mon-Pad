// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

import {MonpadToken} from "../v4/MonpadToken.sol";
import {MonpadHook} from "./MonpadHook.sol";
import {MonpadPoolLib} from "./MonpadPoolLib.sol";

/// @title MonpadHookLauncher (Uniswap V4 + hook)
/// @notice One transaction launches a token into a REAL Uniswap V4 pool (USDC quote pair) whose swap fee is
///         enforced by MonpadHook: 1% plus a creator-chosen tax (0 to 5%), charged on every swap from any router.
///         The whole supply sits in one single-sided position owned by this contract. There is NO function that
///         removes liquidity, so it is locked by construction.
///
///         Fees (collected with `harvest`) are split:
///           the 1% base fee .... USDC side: 70% creator / 10% platform / 10% USDC→MONSHI burn / 10% USDC→token burn
///                                token side : 70% creator / 10% platform / 20% burned (in the token itself)
///           the creator tax .... 100% routed to USDC→token buy+burn (USDC side) or burned (token side). The creator
///                                chooses the rate once at launch and cannot take it out or change it.
///         Not audited. Do not put real value behind it before a professional audit.
contract MonpadHookLauncher is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    // ── fixed economics (constants: no setter exists) ────────────────────────────
    uint16 public constant CREATOR_BPS = 7000;
    uint16 public constant PLATFORM_BPS = 1000;
    uint16 public constant BURN_MONSHI_BPS = 1000; // burn-token slice is the remainder
    uint16 public constant BPS = 10_000;
    uint16 public constant BASE_FEE_BPS = 100; // 1% base fee on every swap
    uint16 public constant MAX_CREATOR_TAX_BPS = 500; // creator may add up to 5% on top (6% total fee max)

    uint256 public constant SUPPLY = 1_000_000_000 ether;
    int24 public constant TICK_SPACING = 200;
    int24 public constant MIN_TICK = -887_200; // aligned to the 200 spacing
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ── buyback guards ───────────────────────────────────────────────────────────
    int24 public constant MAX_SPOT_REF_TICKS = 300; // spot must be within about 3% of the hook's reference tick
    uint16 public constant MAX_SWAP_IMPACT_BPS = 300; // price limit of 1.5% from spot
    uint256 public constant BUYBACK_COOLDOWN = 10 minutes;
    uint256 public constant BUYBACK_FULL_BELOW = 400 * 1e6;
    uint256 public constant MIN_BUYBACK = 1e6; // 1 USDC

    // ── launch limits ────────────────────────────────────────────────────────────
    uint256 public constant MAX_CREATION_FEE = 10_000 * 1e6; // 10k USDC (6 decimals)
    uint16 public constant MAX_DEV_BUY_BPS = 500; // a dev may buy at most 5% of supply in the launch tx
    uint256 public constant MONSHI_POOL_DELAY = 48 hours;

    // ── wiring ───────────────────────────────────────────────────────────────────
    IPoolManager public immutable poolManager;
    MonpadHook public immutable hook;
    address public immutable quoteAsset; // USDC (6 decimals)
    address public immutable monshi;
    int24 public immutable startTick; // start price for the USDC/token pool

    address public platform;
    address public keeper; // may run MONSHI buybacks (with a min-out); cannot touch any funds otherwise
    uint256 public creationFee;
    bool public launchPaused;

    PoolKey public monshiKey; // hookless USDC/MONSHI pool for MONSHI buybacks (USDC → MONSHI, burn)
    bool public monshiKeySet;
    PoolKey internal _pendingMonshiKey;
    uint256 public pendingMonshiAt;

    struct Launch {
        address token;
        address creator;
        uint16 taxBps;
        uint64 lastBuyback;
        bool quoteIs0;
        PoolKey key;
    }

    mapping(address => Launch) internal _launches;
    address[] public allTokens;
    mapping(address => mapping(address => uint256)) public claimable; // account => asset (quoteAsset or token)
    uint256 public monshiReserve; // USDC waiting to swap→MONSHI and burn
    uint64 public lastMonshiBuyback;
    mapping(address => uint256) public tokenReserve; // token => USDC waiting to buy+burn it

    bool private _inUnlock;

    enum Op {
        ADD_LIQUIDITY,
        COLLECT,
        SWAP_QUOTE_IN
    }

    event Launched(
        address indexed token,
        address indexed creator,
        bytes32 indexed poolId,
        uint16 creatorTaxBps,
        string name,
        string symbol,
        uint256 devBuyTokens
    );
    event Harvested(address indexed token, uint256 nativeFees, uint256 tokenFees);
    event Claimed(address indexed account, address indexed asset, uint256 amount);
    event BuybackBurn(address indexed target, uint256 nativeSpent, uint256 burned);
    event CreatorChanged(address indexed token, address indexed oldCreator, address indexed newCreator);
    event PlatformChanged(address indexed platform);
    event KeeperChanged(address indexed keeper);
    event CreationFeeChanged(uint256 fee);
    event LaunchPaused(bool paused);
    event MonshiPoolProposed(uint24 fee, int24 tickSpacing, uint256 executableAt);
    event MonshiPoolSet(uint24 fee, int24 tickSpacing);

    constructor(
        address owner_,
        address platform_,
        address poolManager_,
        address hook_,
        address quoteAsset_,
        address monshi_,
        int24 startTick_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(
            platform_ != address(0) && poolManager_ != address(0) && hook_ != address(0) && quoteAsset_ != address(0)
                && monshi_ != address(0),
            "zero addr"
        );
        require(creationFee_ <= MAX_CREATION_FEE, "fee too high");
        require(startTick_ % TICK_SPACING == 0 && startTick_ > MIN_TICK && startTick_ < TickMath.MAX_TICK, "bad tick");
        poolManager = IPoolManager(poolManager_);
        hook = MonpadHook(hook_);
        require(hook.launcher() == address(this) && address(hook.poolManager()) == poolManager_, "hook mismatch");
        quoteAsset = quoteAsset_;
        monshi = monshi_;
        startTick = startTick_;
        platform = platform_;
        creationFee = creationFee_;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Launch
    // ═════════════════════════════════════════════════════════════════════════════

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

    /// @notice Launch a token. Pulls `creationFee + quoteDevBuy` USDC. Dev buy is capped at 5% of supply.
    function launch(
        string calldata name_,
        string calldata symbol_,
        bytes32 salt,
        uint16 creatorTaxBps,
        uint256 quoteDevBuy
    ) external nonReentrant returns (address token) {
        require(!launchPaused, "launches paused");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "bad name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "bad symbol");
        require(creatorTaxBps <= MAX_CREATOR_TAX_BPS, "tax too high");
        uint256 totalQuote = creationFee + quoteDevBuy;
        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), totalQuote);

        token = address(new MonpadToken{salt: keccak256(abi.encode(msg.sender, salt))}(name_, symbol_, SUPPLY, address(this)));

        MonpadPoolLib.SortedKey memory sorted =
            MonpadPoolLib.buildMonpadKey(quoteAsset, token, address(hook));
        PoolKey memory key = sorted.key;
        hook.configure(key, uint24(uint256(BASE_FEE_BPS + creatorTaxBps) * 100));
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(startTick));
        _addLiquidity(key, sorted);

        Launch storage L = _launches[token];
        L.token = token;
        L.creator = msg.sender;
        L.taxBps = creatorTaxBps;
        L.quoteIs0 = sorted.quoteIs0;
        L.key = key;
        allTokens.push(token);

        if (creationFee > 0) claimable[platform][quoteAsset] += creationFee;

        uint256 bought;
        if (quoteDevBuy > 0) {
            uint256 consumed;
            (consumed, bought) = _swapQuoteIn(key, sorted.quoteIs0, quoteDevBuy, msg.sender, _quoteInLimit(key, sorted.quoteIs0));
            require(consumed == quoteDevBuy, "dev buy not filled");
            require(bought <= (SUPPLY * MAX_DEV_BUY_BPS) / BPS, "dev buy over cap");
        }

        emit Launched(token, msg.sender, PoolId.unwrap(key.toId()), creatorTaxBps, name_, symbol_, bought);
    }

    function _addLiquidity(PoolKey memory key, MonpadPoolLib.SortedKey memory sorted) internal {
        uint160 sqrtU = TickMath.getSqrtPriceAtTick(startTick);
        bytes memory out;
        if (sorted.quoteIs0) {
            uint160 sqrtL = TickMath.getSqrtPriceAtTick(MIN_TICK);
            uint128 liq = uint128(FullMath.mulDiv(SUPPLY, FixedPoint96.Q96, uint256(sqrtU) - uint256(sqrtL)));
            out = _unlock(abi.encode(Op.ADD_LIQUIDITY, key, abi.encode(true, liq)));
        } else {
            int24 upper = int24(TickMath.MAX_TICK - (TickMath.MAX_TICK % TICK_SPACING));
            uint160 sqrtL = TickMath.getSqrtPriceAtTick(startTick);
            uint160 sqrtH = TickMath.getSqrtPriceAtTick(upper);
            uint256 intermediate = FullMath.mulDiv(sqrtL, sqrtH, FixedPoint96.Q96);
            uint128 liq = uint128(FullMath.mulDiv(SUPPLY, intermediate, sqrtH - sqrtL));
            out = _unlock(abi.encode(Op.ADD_LIQUIDITY, key, abi.encode(false, liq)));
        }
        uint256 owed = abi.decode(out, (uint256));
        require(owed >= SUPPLY - SUPPLY / 1_000_000, "position too small");
        uint256 dust = IERC20(sorted.token).balanceOf(address(this));
        if (dust > 0) IERC20(sorted.token).safeTransfer(DEAD, dust);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Fees: harvest, split, claim
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Collect a token's swap fees and split them. Anyone can call.
    function harvest(address token) external nonReentrant {
        Launch storage L = _launches[token];
        require(L.token != address(0), "unknown token");
        bytes memory out = _unlock(abi.encode(Op.COLLECT, L.key, bytes("")));
        (uint256 quoteFees, uint256 tokenFees) = abi.decode(out, (uint256, uint256));

        uint256 total = uint256(BASE_FEE_BPS) + L.taxBps;
        if (quoteFees > 0) {
            uint256 extra = (quoteFees * L.taxBps) / total;
            uint256 base = quoteFees - extra;
            uint256 toCreator = (base * CREATOR_BPS) / BPS;
            uint256 toPlatform = (base * PLATFORM_BPS) / BPS;
            uint256 toMonshi = (base * BURN_MONSHI_BPS) / BPS;
            claimable[L.creator][quoteAsset] += toCreator;
            claimable[platform][quoteAsset] += toPlatform;
            monshiReserve += toMonshi;
            tokenReserve[token] += base - toCreator - toPlatform - toMonshi + extra;
        }
        if (tokenFees > 0) {
            uint256 extra = (tokenFees * L.taxBps) / total;
            uint256 base = tokenFees - extra;
            uint256 toCreator = (base * CREATOR_BPS) / BPS;
            uint256 toPlatform = (base * PLATFORM_BPS) / BPS;
            claimable[L.creator][token] += toCreator;
            claimable[platform][token] += toPlatform;
            uint256 toBurn = tokenFees - toCreator - toPlatform;
            if (toBurn > 0) IERC20(token).safeTransfer(DEAD, toBurn);
        }
        emit Harvested(token, quoteFees, tokenFees);
    }

    function claim(address asset) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][asset];
        require(amount > 0, "nothing to claim");
        claimable[msg.sender][asset] = 0;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, asset, amount);
    }

    function setCreator(address token, address newCreator) external {
        Launch storage L = _launches[token];
        require(L.token != address(0), "unknown token");
        require(msg.sender == L.creator, "not creator");
        require(newCreator != address(0), "zero addr");
        emit CreatorChanged(token, L.creator, newCreator);
        L.creator = newCreator;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Buy and burn
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Permissionless. Spends USDC reserve buying that token; tokens go to the dead address.
    ///         Reverts unless spot is within about 3% of the hook's reference price.
    function buybackToken(address token, uint256 maxUsdc) external nonReentrant returns (uint256 burned) {
        Launch storage L = _launches[token];
        require(L.token != address(0), "unknown token");
        require(block.timestamp >= uint256(L.lastBuyback) + BUYBACK_COOLDOWN, "cooldown");

        PoolId id = L.key.toId();
        (int24 refTick, uint40 refTs) = hook.ref(id);
        require(refTs != 0, "no reference price yet");
        (uint160 sqrtSpot, int24 spot,,) = poolManager.getSlot0(id);
        int256 dev = int256(spot) - int256(refTick);
        if (dev < 0) dev = -dev;
        require(dev <= int256(MAX_SPOT_REF_TICKS), "spot far from reference");

        uint256 amountIn = _boundedAmount(tokenReserve[token], maxUsdc);
        uint160 limit = _limitDown(sqrtSpot, L.quoteIs0);
        uint256 spent;
        (spent, burned) = _swapQuoteIn(L.key, L.quoteIs0, amountIn, DEAD, limit);
        require(spent > 0, "no fill");
        tokenReserve[token] -= spent;
        L.lastBuyback = uint64(block.timestamp);
        emit BuybackBurn(token, spent, burned);
    }

    /// @notice Keeper only. Swaps USDC reserve → MONSHI on the configured USDC/MONSHI pool; MONSHI is burned.
    function buybackMonshi(uint256 maxUsdc, uint256 minMonshiOut) external nonReentrant returns (uint256 burned) {
        require(msg.sender == keeper, "not keeper");
        require(monshiKeySet, "no MONSHI pool");
        require(block.timestamp >= uint256(lastMonshiBuyback) + BUYBACK_COOLDOWN, "cooldown");
        uint256 amountIn = _boundedAmount(monshiReserve, maxUsdc);
        (uint160 sqrtSpot,,,) = poolManager.getSlot0(monshiKey.toId());
        require(sqrtSpot != 0, "pool not initialised");
        bool quoteIs0 = Currency.unwrap(monshiKey.currency0) == quoteAsset;
        uint256 spent;
        (spent, burned) = _swapQuoteIn(monshiKey, quoteIs0, amountIn, DEAD, _limitDown(sqrtSpot, quoteIs0));
        require(spent > 0, "no fill");
        require(burned >= minMonshiOut, "too little out");
        monshiReserve -= spent;
        lastMonshiBuyback = uint64(block.timestamp);
        emit BuybackBurn(monshi, spent, burned);
    }

    function _boundedAmount(uint256 reserve, uint256 maxIn) internal pure returns (uint256 amountIn) {
        require(reserve > 0, "empty reserve");
        amountIn = maxIn < reserve ? maxIn : reserve;
        uint256 cap = reserve > BUYBACK_FULL_BELOW ? reserve / 4 : reserve;
        if (amountIn > cap) amountIn = cap;
        require(amountIn >= MIN_BUYBACK || amountIn == reserve, "too small");
    }

    function _limitDown(uint160 sqrtSpot, bool quoteIs0) internal pure returns (uint160 limit) {
        uint256 delta = (uint256(sqrtSpot) * (MAX_SWAP_IMPACT_BPS / 2)) / BPS;
        if (quoteIs0) {
            limit = uint160(uint256(sqrtSpot) - delta);
            if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
        } else {
            limit = uint160(uint256(sqrtSpot) + delta);
            if (limit >= TickMath.MAX_SQRT_PRICE) limit = TickMath.MAX_SQRT_PRICE - 1;
        }
    }

    function _quoteInLimit(PoolKey memory key, bool quoteIs0) internal pure returns (uint160) {
        return quoteIs0 ? uint160(TickMath.MIN_SQRT_PRICE + 1) : uint160(TickMath.MAX_SQRT_PRICE - 1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // V4 plumbing
    // ═════════════════════════════════════════════════════════════════════════════

    function _unlock(bytes memory data) internal returns (bytes memory out) {
        _inUnlock = true;
        out = poolManager.unlock(data);
        _inUnlock = false;
    }

    /// @dev swap USDC -> token (or MONSHI), exact input; returns (USDC consumed, tokens received)
    function _swapQuoteIn(PoolKey memory key, bool quoteIs0, uint256 amountIn, address recipient, uint160 limit)
        internal
        returns (uint256 consumed, uint256 received)
    {
        require(amountIn <= uint256(uint128(type(int128).max)), "amount");
        bytes memory out = _unlock(abi.encode(Op.SWAP_QUOTE_IN, key, abi.encode(quoteIs0, amountIn, recipient, limit)));
        (consumed, received) = abi.decode(out, (uint256, uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager) && _inUnlock, "bad caller");
        (Op op, PoolKey memory key, bytes memory args) = abi.decode(raw, (Op, PoolKey, bytes));

        if (op == Op.ADD_LIQUIDITY) {
            (bool tokenIsCurrency1, uint128 liq) = abi.decode(args, (bool, uint128));
            if (tokenIsCurrency1) {
                (BalanceDelta d,) = poolManager.modifyLiquidity(
                    key,
                    ModifyLiquidityParams({tickLower: MIN_TICK, tickUpper: startTick, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}),
                    ""
                );
                require(d.amount0() == 0, "not single-sided");
                uint256 owed = uint256(uint128(-d.amount1()));
                _settleToken(key.currency1, owed);
                return abi.encode(owed);
            }
            int24 upper = int24(TickMath.MAX_TICK - (TickMath.MAX_TICK % TICK_SPACING));
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: startTick, tickUpper: upper, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}),
                ""
            );
            require(d.amount1() == 0, "not single-sided");
            uint256 owed = uint256(uint128(-d.amount0()));
            _settleToken(key.currency0, owed);
            return abi.encode(owed);
        }

        if (op == Op.COLLECT) {
            bool quoteIs0 = Currency.unwrap(key.currency0) == quoteAsset;
            int24 upper = int24(TickMath.MAX_TICK - (TickMath.MAX_TICK % TICK_SPACING));
            ModifyLiquidityParams memory p = quoteIs0
                ? ModifyLiquidityParams({tickLower: MIN_TICK, tickUpper: startTick, liquidityDelta: 0, salt: bytes32(0)})
                : ModifyLiquidityParams({tickLower: startTick, tickUpper: upper, liquidityDelta: 0, salt: bytes32(0)});
            (, BalanceDelta fees) = poolManager.modifyLiquidity(key, p, "");
            uint256 a0 = fees.amount0() > 0 ? uint256(uint128(fees.amount0())) : 0;
            uint256 a1 = fees.amount1() > 0 ? uint256(uint128(fees.amount1())) : 0;
            if (a0 > 0) poolManager.take(key.currency0, address(this), a0);
            if (a1 > 0) poolManager.take(key.currency1, address(this), a1);
            uint256 quoteFees = quoteIs0 ? a0 : a1;
            uint256 tokenFees = quoteIs0 ? a1 : a0;
            return abi.encode(quoteFees, tokenFees);
        }

        (bool quoteIs0, uint256 amountIn, address recipient, uint160 limit) = abi.decode(args, (bool, uint256, address, uint160));
        bool zeroForOne = quoteIs0;
        BalanceDelta s = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), ""
        );
        if (quoteIs0) {
            require(s.amount0() <= 0 && s.amount1() >= 0, "bad swap");
            uint256 consumed = uint256(uint128(-s.amount0()));
            uint256 got = uint256(uint128(s.amount1()));
            if (consumed > 0) _settleToken(key.currency0, consumed);
            if (got > 0) poolManager.take(key.currency1, recipient, got);
            return abi.encode(consumed, got);
        }
        require(s.amount1() <= 0 && s.amount0() >= 0, "bad swap");
        uint256 consumed = uint256(uint128(-s.amount1()));
        uint256 got = uint256(uint128(s.amount0()));
        if (consumed > 0) _settleToken(key.currency1, consumed);
        if (got > 0) poolManager.take(key.currency0, recipient, got);
        return abi.encode(consumed, got);
    }

    function _settleToken(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Owner controls: nothing here can touch liquidity, fees owed, or reserves
    // ═════════════════════════════════════════════════════════════════════════════

    function setPlatform(address platform_) external onlyOwner {
        require(platform_ != address(0), "zero addr");
        platform = platform_;
        emit PlatformChanged(platform_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    function setCreationFee(uint256 fee_) external onlyOwner {
        require(fee_ <= MAX_CREATION_FEE, "fee too high");
        creationFee = fee_;
        emit CreationFeeChanged(fee_);
    }

    /// @notice Pause NEW launches only. Harvest, claim and buybacks always work.
    function setLaunchPaused(bool paused) external onlyOwner {
        launchPaused = paused;
        emit LaunchPaused(paused);
    }

    /// @notice Point MONSHI buybacks at a hookless USDC/MONSHI pool after a 48h delay. The pool must exist.
    function proposeMonshiPool(uint24 fee_, int24 tickSpacing_) external onlyOwner {
        (address c0, address c1) = quoteAsset < monshi ? (quoteAsset, monshi) : (monshi, quoteAsset);
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee_,
            tickSpacing: tickSpacing_,
            hooks: IHooks(address(0))
        });
        (uint160 sqrtP,,,) = poolManager.getSlot0(k.toId());
        require(sqrtP != 0, "no such pool");
        _pendingMonshiKey = k;
        pendingMonshiAt = block.timestamp + MONSHI_POOL_DELAY;
        emit MonshiPoolProposed(fee_, tickSpacing_, pendingMonshiAt);
    }

    function executeMonshiPool() external onlyOwner {
        require(pendingMonshiAt != 0, "nothing pending");
        require(block.timestamp >= pendingMonshiAt, "too early");
        monshiKey = _pendingMonshiKey;
        monshiKeySet = true;
        pendingMonshiAt = 0;
        emit MonshiPoolSet(monshiKey.fee, monshiKey.tickSpacing);
    }

    function renounceOwnership() public pure override {
        revert("disabled");
    }

    // ── views ───────────────────────────────────────────────────────────────────
    function launches(address token)
        external
        view
        returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId)
    {
        Launch storage L = _launches[token];
        return (L.creator, L.taxBps, L.lastBuyback, PoolId.unwrap(L.key.toId()));
    }

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }
}

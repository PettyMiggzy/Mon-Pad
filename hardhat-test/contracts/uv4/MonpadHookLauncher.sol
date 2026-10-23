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

/// @title MonpadHookLauncher (Uniswap V4 + hook)
/// @notice One transaction launches a token into a REAL Uniswap V4 pool (native MON pair) whose swap fee is
///         enforced by MonpadHook: 1% plus a creator-chosen tax (0 to 5%), charged on every swap from any router.
///         The whole supply sits in one single-sided position owned by this contract. There is NO function that
///         removes liquidity, so it is locked by construction.
///
///         Fees (collected with `harvest`) are split:
///           the 1% base fee .... native side: 70% creator / 10% platform / 10% buys+burns MONSHI / 10% buys+burns the token
///                                token side : 70% creator / 10% platform / 20% burned (both burn slices, in the token itself)
///           the creator tax .... 100% buys+burns the token (native side) or is burned (token side). The creator
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
    uint256 public constant BUYBACK_FULL_BELOW = 400 ether;
    uint256 public constant MIN_BUYBACK = 1 ether;

    // ── launch limits ────────────────────────────────────────────────────────────
    uint256 public constant MAX_CREATION_FEE = 10_000 ether;
    uint16 public constant MAX_DEV_BUY_BPS = 500; // a dev may buy at most 5% of supply in the launch tx
    uint256 public constant MONSHI_POOL_DELAY = 48 hours;

    // ── wiring ───────────────────────────────────────────────────────────────────
    IPoolManager public immutable poolManager;
    MonpadHook public immutable hook;
    address public immutable monshi;
    int24 public immutable startTick; // tick where price (tokens per MON) = supply / start market cap

    address public platform;
    address public keeper; // may run MONSHI buybacks (with a min-out); cannot touch any funds otherwise
    uint256 public creationFee;
    bool public launchPaused;

    PoolKey public monshiKey; // hookless native-MON/MONSHI pool used for MONSHI buybacks
    bool public monshiKeySet;
    PoolKey internal _pendingMonshiKey;
    uint256 public pendingMonshiAt;

    struct Launch {
        address token;
        address creator;
        uint16 taxBps;
        uint64 lastBuyback;
        PoolKey key;
    }

    mapping(address => Launch) internal _launches;
    address[] public allTokens;
    mapping(address => mapping(address => uint256)) public claimable; // account => asset (0 = native MON)
    uint256 public monshiReserve; // native MON waiting to buy+burn MONSHI
    uint64 public lastMonshiBuyback;
    mapping(address => uint256) public tokenReserve; // token => native MON waiting to buy+burn it

    bool private _inUnlock;

    enum Op {
        ADD_LIQUIDITY,
        COLLECT,
        SWAP_NATIVE_IN
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
        address monshi_,
        int24 startTick_,
        uint256 creationFee_
    ) Ownable(owner_) {
        require(platform_ != address(0) && poolManager_ != address(0) && hook_ != address(0) && monshi_ != address(0), "zero addr");
        require(creationFee_ <= MAX_CREATION_FEE, "fee too high");
        require(startTick_ % TICK_SPACING == 0 && startTick_ > MIN_TICK && startTick_ < TickMath.MAX_TICK, "bad tick");
        poolManager = IPoolManager(poolManager_);
        hook = MonpadHook(hook_);
        require(hook.launcher() == address(this) && address(hook.poolManager()) == poolManager_, "hook mismatch");
        monshi = monshi_;
        startTick = startTick_;
        platform = platform_;
        creationFee = creationFee_;
    }

    receive() external payable {
        require(msg.sender == address(poolManager), "only PoolManager");
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

    /// @notice Launch a token. `msg.value` = creation fee + optional dev buy (spent on the new pool at the launch
    ///         price, capped at 5% of supply). `creatorTaxBps` (0..1000) is the extra tax, fixed forever.
    function launch(string calldata name_, string calldata symbol_, bytes32 salt, uint16 creatorTaxBps)
        external
        payable
        nonReentrant
        returns (address token)
    {
        require(!launchPaused, "launches paused");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "bad name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 10, "bad symbol");
        require(creatorTaxBps <= MAX_CREATOR_TAX_BPS, "tax too high");
        require(msg.value >= creationFee, "fee");
        uint256 devBuy = msg.value - creationFee;

        token = address(new MonpadToken{salt: keccak256(abi.encode(msg.sender, salt))}(name_, symbol_, SUPPLY, address(this)));

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO, // native MON always sorts first
            currency1: Currency.wrap(token),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        hook.configure(key, uint24(uint256(BASE_FEE_BPS + creatorTaxBps) * 100));
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(startTick));
        _addLiquidity(key, token);

        Launch storage L = _launches[token];
        L.token = token;
        L.creator = msg.sender;
        L.taxBps = creatorTaxBps;
        L.key = key;
        allTokens.push(token);

        if (creationFee > 0) claimable[platform][address(0)] += creationFee;

        uint256 bought;
        if (devBuy > 0) {
            uint256 consumed;
            (consumed, bought) = _swapNative(key, devBuy, msg.sender, TickMath.MIN_SQRT_PRICE + 1);
            require(consumed == devBuy, "dev buy not filled");
            require(bought <= (SUPPLY * MAX_DEV_BUY_BPS) / BPS, "dev buy over cap");
        }

        emit Launched(token, msg.sender, PoolId.unwrap(key.toId()), creatorTaxBps, name_, symbol_, bought);
    }

    function _addLiquidity(PoolKey memory key, address token) internal {
        uint160 sqrtU = TickMath.getSqrtPriceAtTick(startTick);
        uint160 sqrtL = TickMath.getSqrtPriceAtTick(MIN_TICK);
        // current price sits on the upper tick, so the range holds only token1 (the new token):
        // amount1 = L * (sqrtU - sqrtL) / 2^96
        uint128 liq = uint128(FullMath.mulDiv(SUPPLY, FixedPoint96.Q96, uint256(sqrtU) - uint256(sqrtL)));
        bytes memory out = _unlock(abi.encode(Op.ADD_LIQUIDITY, key, abi.encode(liq)));
        uint256 owed = abi.decode(out, (uint256));
        require(owed >= SUPPLY - SUPPLY / 1_000_000, "position too small");
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust > 0) IERC20(token).safeTransfer(DEAD, dust);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Fees: harvest, split, claim
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Collect a token's swap fees and split them. Anyone can call.
    function harvest(address token) external nonReentrant {
        Launch storage L = _launches[token];
        require(L.token != address(0), "unknown token");
        bytes memory out = _unlock(abi.encode(Op.COLLECT, L.key, bytes("")));
        (uint256 nativeFees, uint256 tokenFees) = abi.decode(out, (uint256, uint256));

        uint256 total = uint256(BASE_FEE_BPS) + L.taxBps;
        if (nativeFees > 0) {
            uint256 extra = (nativeFees * L.taxBps) / total; // the creator-tax share of the fee
            uint256 base = nativeFees - extra;
            uint256 toCreator = (base * CREATOR_BPS) / BPS;
            uint256 toPlatform = (base * PLATFORM_BPS) / BPS;
            uint256 toMonshi = (base * BURN_MONSHI_BPS) / BPS;
            claimable[L.creator][address(0)] += toCreator;
            claimable[platform][address(0)] += toPlatform;
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
        emit Harvested(token, nativeFees, tokenFees);
    }

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

    /// @notice Permissionless. Spends the token's native-MON reserve buying that token; the tokens go to the dead address.
    ///         Reverts unless spot is within about 3% of the hook's reference price.
    function buybackToken(address token, uint256 maxNative) external nonReentrant returns (uint256 burned) {
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

        uint256 amountIn = _boundedAmount(tokenReserve[token], maxNative);
        uint160 limit = _limitDown(sqrtSpot);
        uint256 spent;
        (spent, burned) = _swapNative(L.key, amountIn, DEAD, limit);
        require(spent > 0, "no fill");
        tokenReserve[token] -= spent;
        L.lastBuyback = uint64(block.timestamp);
        emit BuybackBurn(token, spent, burned);
    }

    /// @notice Keeper only. Spends the MONSHI reserve buying MONSHI on the configured pool; the MONSHI goes to the dead
    ///         address. The keeper supplies `minMonshiOut` from an off-chain price, so a sandwich cannot extract more.
    function buybackMonshi(uint256 maxNative, uint256 minMonshiOut) external nonReentrant returns (uint256 burned) {
        require(msg.sender == keeper, "not keeper");
        require(monshiKeySet, "no MONSHI pool");
        require(block.timestamp >= uint256(lastMonshiBuyback) + BUYBACK_COOLDOWN, "cooldown");
        uint256 amountIn = _boundedAmount(monshiReserve, maxNative);
        (uint160 sqrtSpot,,,) = poolManager.getSlot0(monshiKey.toId());
        require(sqrtSpot != 0, "pool not initialised");
        uint256 spent;
        (spent, burned) = _swapNative(monshiKey, amountIn, DEAD, _limitDown(sqrtSpot));
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

    function _limitDown(uint160 sqrtSpot) internal pure returns (uint160 limit) {
        // buying with native MON (currency0) moves the price down
        uint256 delta = (uint256(sqrtSpot) * (MAX_SWAP_IMPACT_BPS / 2)) / BPS;
        limit = uint160(uint256(sqrtSpot) - delta);
        if (limit <= TickMath.MIN_SQRT_PRICE) limit = TickMath.MIN_SQRT_PRICE + 1;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // V4 plumbing
    // ═════════════════════════════════════════════════════════════════════════════

    function _unlock(bytes memory data) internal returns (bytes memory out) {
        _inUnlock = true;
        out = poolManager.unlock(data);
        _inUnlock = false;
    }

    /// @dev swap native MON -> the pool's token, exact input; returns (native consumed, token received)
    function _swapNative(PoolKey memory key, uint256 amountIn, address recipient, uint160 limit)
        internal
        returns (uint256 consumed, uint256 received)
    {
        require(amountIn <= uint256(uint128(type(int128).max)), "amount");
        bytes memory out = _unlock(abi.encode(Op.SWAP_NATIVE_IN, key, abi.encode(amountIn, recipient, limit)));
        (consumed, received) = abi.decode(out, (uint256, uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager) && _inUnlock, "bad caller");
        (Op op, PoolKey memory key, bytes memory args) = abi.decode(raw, (Op, PoolKey, bytes));

        if (op == Op.ADD_LIQUIDITY) {
            uint128 liq = abi.decode(args, (uint128));
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

        if (op == Op.COLLECT) {
            (, BalanceDelta fees) = poolManager.modifyLiquidity(
                key,
                ModifyLiquidityParams({tickLower: MIN_TICK, tickUpper: startTick, liquidityDelta: 0, salt: bytes32(0)}),
                ""
            );
            uint256 a0 = fees.amount0() > 0 ? uint256(uint128(fees.amount0())) : 0;
            uint256 a1 = fees.amount1() > 0 ? uint256(uint128(fees.amount1())) : 0;
            if (a0 > 0) poolManager.take(key.currency0, address(this), a0);
            if (a1 > 0) poolManager.take(key.currency1, address(this), a1);
            return abi.encode(a0, a1);
        }

        // SWAP_NATIVE_IN
        (uint256 amountIn, address recipient, uint160 limit) = abi.decode(args, (uint256, address, uint160));
        BalanceDelta s = poolManager.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}),
            ""
        );
        int128 d0 = s.amount0();
        int128 d1 = s.amount1();
        require(d0 <= 0 && d1 >= 0, "bad swap");
        uint256 consumed = uint256(uint128(-d0));
        uint256 got = uint256(uint128(d1));
        if (consumed > 0) {
            poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
            poolManager.settle{value: consumed}();
        }
        if (got > 0) poolManager.take(key.currency1, recipient, got);
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

    /// @notice Point MONSHI buybacks at a hookless native-MON/MONSHI pool after a 48h delay. The pool must exist.
    function proposeMonshiPool(uint24 fee_, int24 tickSpacing_) external onlyOwner {
        PoolKey memory k = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(monshi),
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

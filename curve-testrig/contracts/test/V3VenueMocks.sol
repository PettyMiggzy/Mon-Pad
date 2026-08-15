// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {IUniswapV3SwapCallback} from "../interfaces/IUniswapV3Minimal.sol";

/// @title V3VenueMocks — an OFFLINE V3 venue that reproduces MEASURED pathologies, not an idealised one
/// @notice The unit suite must make ZERO network calls (the RPC endpoint is a paid proxy with two collectors
/// already running against it), so the whole venue is mocked. The mocks are deliberately NOT charitable:
///   - feeAmountTickSpacing returns 0 for 2500 and 20000, because the real canonical factory does;
///   - the map is settable so the NON-canonical fee 10000 / spacing 100 pairing that factory
///     0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8 really emits can be reproduced;
///   - a pool can be pre-created and pre-initialized at a hostile price, reproducing the front-run;
///   - the mint fills SHORT of desired by the EXACT real amount, because it runs the same
///     LiquidityAmounts + SqrtPriceMath round trip the real pool does rather than a settable fudge factor.
/// That last point is what lets the amountMin logic be validated against real chain numbers with no RPC:
/// feeding this mock the BRACKETS geometry returns 999999999999999999999994558, the number the live Mint
/// event actually carried.

/// @dev EMPTY CONSTRUCTOR is critical. The factory CREATE2-deploys this, and the pad's POOL_INIT_CODE_HASH is
/// a constant, so parameters cannot be constructor arguments — exactly how the canonical UniswapV3Pool reads
/// its own parameters back from the factory instead of taking them as arguments.
contract MockV3Pool {
    address public factory;
    address public token0;
    address public token1;
    uint24 public fee;
    int24 public tickSpacing;

    uint160 public sqrtPriceX96;
    int24 public tick;
    uint128 public liquidity;

    /// @notice How the next swap fills. NORMAL consumes the whole input; PARTIAL consumes `fillBps` of it,
    /// which is what a binding sqrtPriceLimitX96 looks like from the caller's side; ZERO consumes nothing.
    enum FillMode {
        NORMAL,
        PARTIAL,
        ZERO
    }

    FillMode public fillMode;
    uint16 public fillBps = 10000;
    /// @notice Output token amount for a FULL fill; scaled down proportionally on a partial fill.
    uint256 public swapOutOnFullFill;

    event Mint(
        address sender,
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    error AlreadyInit();
    error NotFactory();
    error NotInit();
    error InsufficientInput();
    error SlippageCheck();

    function init(address t0, address t1, uint24 fee_, int24 spacing) external {
        if (factory != address(0)) revert AlreadyInit();
        factory = msg.sender;
        token0 = t0;
        token1 = t1;
        fee = fee_;
        tickSpacing = spacing;
    }

    function initialize(uint160 sqrtPriceX96_) external {
        if (sqrtPriceX96 != 0) revert AlreadyInit();
        sqrtPriceX96 = sqrtPriceX96_;
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96_);
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, tick, 0, 0, 0, 0, true);
    }

    /// @notice Test hook: reproduce a venue whose pool spacing disagrees with the factory's live map.
    function forceTickSpacing(int24 s) external {
        tickSpacing = s;
    }

    function setSwapFill(FillMode mode, uint16 bps, uint256 outOnFullFill) external {
        fillMode = mode;
        fillBps = bps;
        swapOutOnFullFill = outOnFullFill;
    }

    /// @dev Called by the position manager, which has already pulled the desired amounts and approved us —
    /// mirroring the real flow where the pool pulls from the NPM inside uniswapV3MintCallback. The pad
    /// therefore measures its own balance deltas against the NPM, exactly as it does on the real venue.
    function mintFor(address payer, int24 tickLower, int24 tickUpper, uint256 a0Desired, uint256 a1Desired)
        external
        returns (uint128 liq, uint256 amount0, uint256 amount1)
    {
        if (sqrtPriceX96 == 0) revert NotInit();
        uint160 sLo = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sHi = TickMath.getSqrtPriceAtTick(tickUpper);
        liq = LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sLo, sHi, a0Desired, a1Desired);
        (amount0, amount1) = amountsForLiquidity(sqrtPriceX96, sLo, sHi, liq);
        if (amount0 > 0) IERC20(token0).transferFrom(payer, address(this), amount0);
        if (amount1 > 0) IERC20(token1).transferFrom(payer, address(this), amount1);
        liquidity += liq;
        emit Mint(payer, msg.sender, tickLower, tickUpper, liq, amount0, amount1);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        uint256 asked = uint256(amountSpecified);
        uint256 consumed = fillMode == FillMode.ZERO
            ? 0
            : (fillMode == FillMode.PARTIAL ? (asked * fillBps) / 10000 : asked);
        uint256 out = asked == 0 ? 0 : (swapOutOnFullFill * consumed) / asked;

        address inTok = zeroForOne ? token0 : token1;
        address outTok = zeroForOne ? token1 : token0;

        amount0 = zeroForOne ? int256(consumed) : -int256(out);
        amount1 = zeroForOne ? -int256(out) : int256(consumed);

        uint256 before = IERC20(inTok).balanceOf(address(this));
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        if (IERC20(inTok).balanceOf(address(this)) < before + consumed) revert InsufficientInput();

        if (out > 0) IERC20(outTok).transfer(recipient, out);
        emit Swap(msg.sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick);
    }

    /// @dev Same form as AtomicExperimentPad._amountsForLiquidity — v4-periphery has no
    /// getAmountsForLiquidity, so the reverse direction is v4-core SqrtPriceMath with roundUp = true.
    function amountsForLiquidity(uint160 sp, uint160 sLo, uint160 sHi, uint128 liq)
        public
        pure
        returns (uint256 a0, uint256 a1)
    {
        if (liq == 0) return (0, 0);
        if (sp <= sLo) {
            a0 = SqrtPriceMath.getAmount0Delta(sLo, sHi, liq, true);
        } else if (sp < sHi) {
            a0 = SqrtPriceMath.getAmount0Delta(sp, sHi, liq, true);
            a1 = SqrtPriceMath.getAmount1Delta(sLo, sp, liq, true);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sLo, sHi, liq, true);
        }
    }
}

contract MockV3Factory {
    mapping(uint24 => int24) public feeAmountTickSpacing;
    mapping(bytes32 => address) internal _pools;

    // Swap behaviour has to be configurable BEFORE the pool exists, because the dev buy happens in the same
    // transaction that creates the pool. Stamped onto each pool at creation.
    MockV3Pool.FillMode public defaultFillMode;
    uint16 public defaultFillBps = 10000;
    uint256 public defaultSwapOut;

    event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool);

    error TierDisabled();
    error PoolExists();

    constructor() {
        // The canonical map, as measured live on 0x1f7d7550b1b028f7571e69a784071f0205fd2efa.
        feeAmountTickSpacing[100] = 1;
        feeAmountTickSpacing[500] = 10;
        feeAmountTickSpacing[3000] = 60;
        feeAmountTickSpacing[10000] = 200;
        // 2500 and 20000 stay 0 — measured as NOT enabled. createPool must revert for them.
    }

    function setFeeAmountTickSpacing(uint24 fee, int24 spacing) external {
        feeAmountTickSpacing[fee] = spacing;
    }

    function setPoolDefaults(MockV3Pool.FillMode mode, uint16 bps, uint256 outOnFullFill) external {
        defaultFillMode = mode;
        defaultFillBps = bps;
        defaultSwapOut = outOnFullFill;
    }

    function _key(address a, address b, uint24 fee) internal pure returns (bytes32) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(t0, t1, fee));
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return _pools[_key(a, b, fee)];
    }

    /// @notice Test hook: make NEWLY created pools report a spacing that disagrees with the factory map.
    /// Needed because the pad now refuses any pool that pre-existed its launch tx, so a disagreeing pool
    /// can no longer be staged by creating one beforehand — it has to be born wrong.
    int24 public spacingOverrideOnCreate;

    function setSpacingOverrideOnCreate(int24 s) external {
        spacingOverrideOnCreate = s;
    }

    function createPool(address a, address b, uint24 fee) public returns (address pool) {
        int24 spacing = feeAmountTickSpacing[fee];
        if (spacing == 0) revert TierDisabled();
        bytes32 salt = _key(a, b, fee);
        if (_pools[salt] != address(0)) revert PoolExists();
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        pool = address(new MockV3Pool{salt: salt}());
        MockV3Pool(pool).init(t0, t1, fee, spacing);
        if (spacingOverrideOnCreate != 0) MockV3Pool(pool).forceTickSpacing(spacingOverrideOnCreate);
        MockV3Pool(pool).setSwapFill(defaultFillMode, defaultFillBps, defaultSwapOut);
        _pools[salt] = pool;
        emit PoolCreated(t0, t1, fee, spacing, pool);
    }
}

contract MockNPM {
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

    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    /// @dev `factory` and `WETH9` mirror the REAL NPM's two immutable self-descriptions (selectors 0xc45a0155
    /// and 0x4aa4a4fc, both probed present on 0x73991a25...). The pad's constructor asks the NPM which venue
    /// it belongs to, so the mock has to be able to answer — and to be able to answer WRONGLY, which is what
    /// makes the cross-check testable offline instead of being dead code until deploy day.
    MockV3Factory public immutable factory;
    address public immutable WETH9;
    uint256 public nextId = 1;
    mapping(uint256 => address) internal _owners;
    mapping(uint256 => Position) internal _positions;

    /// @notice Test hook: make createAndInitializePoolIfNecessary return a pool that is NOT the one the
    /// factory would give, so the pad's address assertion is genuinely exercised.
    address public poolOverride;

    MintParams public lastMintParams;

    error SlippageCheck();
    error NoPosition();

    constructor(address factory_, address weth_) {
        factory = MockV3Factory(factory_);
        WETH9 = weth_;
    }

    function setPoolOverride(address p) external {
        poolOverride = p;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool)
    {
        pool = factory.getPool(token0, token1, fee);
        if (pool == address(0)) pool = factory.createPool(token0, token1, fee);
        if (MockV3Pool(pool).sqrtPriceX96() == 0) MockV3Pool(pool).initialize(sqrtPriceX96);
        if (poolOverride != address(0)) return poolOverride;
    }

    function mint(MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        lastMintParams = p;
        address pool = factory.getPool(p.token0, p.token1, p.fee);

        // Pull the DESIRED amounts, let the pool take only what the rounded-down liquidity actually needs,
        // then hand the remainder straight back. Net effect on the caller is identical to the real NPM's
        // mint-callback flow, so the pad's balance-delta accounting is exercised for real.
        if (p.amount0Desired > 0) IERC20(p.token0).transferFrom(msg.sender, address(this), p.amount0Desired);
        if (p.amount1Desired > 0) IERC20(p.token1).transferFrom(msg.sender, address(this), p.amount1Desired);
        if (p.amount0Desired > 0) IERC20(p.token0).approve(pool, p.amount0Desired);
        if (p.amount1Desired > 0) IERC20(p.token1).approve(pool, p.amount1Desired);

        (liquidity, amount0, amount1) =
            MockV3Pool(pool).mintFor(address(this), p.tickLower, p.tickUpper, p.amount0Desired, p.amount1Desired);
        if (amount0 < p.amount0Min || amount1 < p.amount1Min) revert SlippageCheck();

        if (p.amount0Desired > amount0) IERC20(p.token0).transfer(msg.sender, p.amount0Desired - amount0);
        if (p.amount1Desired > amount1) IERC20(p.token1).transfer(msg.sender, p.amount1Desired - amount1);

        tokenId = nextId++;
        _owners[tokenId] = p.recipient;
        _positions[tokenId] = Position(p.token0, p.token1, p.fee, p.tickLower, p.tickUpper, liquidity);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        if (o == address(0)) revert NoPosition();
        return o;
    }

    function positions(uint256 tokenId)
        external
        view
        returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
    {
        Position memory pos = _positions[tokenId];
        return (0, address(0), pos.token0, pos.token1, pos.fee, pos.tickLower, pos.tickUpper, pos.liquidity, 0, 0, 0, 0);
    }
}

/// @dev WETH9-shaped, plus one hook: `reenterTarget` makes `deposit()` call back into the pad's
/// sweepStrandedNative mid-launch, which is how the shared ReentrancyGuard is proven to close that door.
contract MockWETH9 {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    address public reenterTarget;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();
    error WithdrawFailed();

    function setReenterTarget(address t) external {
        reenterTarget = t;
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
        if (reenterTarget != address(0)) {
            // abi.encodeWithSignature avoids importing the pad here; the call is EXPECTED to revert the tx.
            (bool ok, bytes memory ret) =
                reenterTarget.call(abi.encodeWithSignature("sweepStrandedNative()"));
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }

    receive() external payable {
        deposit();
    }

    function withdraw(uint256 wad) external {
        if (balanceOf[msg.sender] < wad) revert InsufficientBalance();
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        emit Transfer(msg.sender, address(0), wad);
        (bool ok,) = payable(msg.sender).call{value: wad}("");
        if (!ok) revert WithdrawFailed();
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = a - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev The drain regression. A real attacker CAN create a genuine (attackerToken, WETH) pool through the
/// canonical factory, so "msg.sender is a factory pool" is not authentication. This calls the pad's callback
/// directly with a fabricated positive delta; it must revert NotPool, and it must still revert after a
/// completed launch (proving the transient latch was cleared).
contract HostilePool {
    function attack(address pad, bool quoteIsToken0, int256 fakeDelta) external {
        IUniswapV3SwapCallback(pad).uniswapV3SwapCallback(
            quoteIsToken0 ? fakeDelta : int256(0),
            quoteIsToken0 ? int256(0) : fakeDelta,
            abi.encode(quoteIsToken0)
        );
    }
}

/// @dev An operator whose receive() reverts, used to prove the refund leg fails loudly rather than stranding
/// value in the pad.
contract BadRefundReceiver {
    error Nope();

    /// @dev Funding has to go through a function, not `receive()` — receive() is the thing that reverts.
    function fund() external payable {}

    function fire(address pad, uint256 value, bytes calldata launchCalldata) external payable {
        (bool ok, bytes memory ret) = pad.call{value: value}(launchCalldata);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    receive() external payable {
        revert Nope();
    }
}

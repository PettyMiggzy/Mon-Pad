// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PadToken} from "../pads/PadToken.sol";
import {
    IUniswapV3Factory,
    INonfungiblePositionManager,
    IUniswapV3Pool,
    IWETH9
} from "../interfaces/IUniswapV3Minimal.sol";

/// @title RektCurve — a bonding-curve launchpad whose raise BECOMES the pool's quote side
/// @author Robin Labs
///
/// @notice THE ONE IDEA. On RektPad, whatever quote currency ends up in the pool is money the launcher
/// puts there — the measured 92% bot rate costs a real 1.0 ETH, and that ETH then sits in the pool as
/// exit liquidity for whoever sells into it first. Here the curve raises it instead. Buyers pay ETH into
/// a bonding curve; at the target that ETH is not swept, not split and not paid out — every wei of it is
/// wrapped and minted as the quote side of the V3 position. The seed and the raise are the same money.
///
/// So the launcher's cost for a pool that opens with 1.0 ETH in it is gas, and the 1.0 ETH came from the
/// people who wanted the token.
///
/// @dev WHAT IS DELIBERATELY NOT HERE. No trading fee, no creator cut, no treasury cut, no tax, no
/// referral, no vesting, no staking hook. Not because those are wrong for a product, but because this is
/// the instrument the launch research runs on, and every basis point skimmed off the raise is a wedge
/// between "what buyers paid" and "what the pool opened with" — the exact quantity being measured. The
/// only value that leaves this contract is a seller's own ETH back out of the curve.
///
/// @dev CALIBRATION, and why the pool opens at the curve's closing price. Reserves are virtual and
/// constant-product. Fixing
///
///     virtualToken = 2 * curveSupply        virtualQuote = target
///
/// makes selling the whole curve supply raise EXACTLY `target` (k/(2C-C) - target == target), and closes
/// the curve at price 2*target/C — four times where it opened. Seeding `curveSupply / 2` tokens against
/// the raised `target` then prices the pool at target/(C/2) == 2*target/C, i.e. the same number. That is
/// why `seedTokenAmount == curveSupply / 2` is not a default but a CHECKED invariant: any other split
/// opens the pool at a price the curve did not close at, and hands the first arbitrageur the difference,
/// paid for by the buyers who funded the raise.
///
/// A worked default: supply 1.5B, curveSupply 1B, seed 500M, target 1 ETH. The curve raises 1 ETH across
/// 1B tokens, the pool opens holding that 1 ETH against 500M tokens at the same price the last curve
/// buyer paid, and 500M is inside the 0.5-5B seeded-token window the bot measurements were taken in.
///
/// @dev VENUE. Same immutables and the same constructor coherence checks as RektPad, for the same reason:
/// factory, position manager and WETH must describe ONE venue, and the init code hash is bound to a real
/// pool at construction so a wrong 32 bytes fails here rather than on every graduation.
contract RektCurve is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Immutables — the venue
    // ---------------------------------------------------------------------------------------------

    IUniswapV3Factory public immutable FACTORY;
    INonfungiblePositionManager public immutable NPM;
    IWETH9 public immutable WETH;
    uint256 public immutable EXPECTED_CHAIN_ID;
    bytes32 public immutable POOL_INIT_CODE_HASH;

    /// @notice Where graduated LP position NFTs are sent. Immutable, and never this contract: this
    /// contract has no ERC721 surface, so a position minted here would be unrecoverable forever.
    address public immutable LP_VAULT;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    struct CreateParams {
        string name;
        string symbol;
        uint8 decimals;
        uint256 totalSupply;
        /// @dev CREATE2 salt, mined off chain so the token lands on the wanted side of WETH. Which side
        /// the token sorts on is half of what decides whether bots show up, so it is an input, not luck.
        bytes32 tokenSalt;
        bool wantTokenIsToken0;
        /// @dev Tokens sold on the curve. The remainder of totalSupply is the seed.
        uint256 curveSupply;
        /// @dev Native wei the curve must raise before it graduates. This is the pool's entire quote side.
        uint256 target;
        uint24 fee;
    }

    struct Curve {
        // --- config, snapshotted at creation so nothing can move under a live curve ---
        uint256 curveSupply;
        uint256 seedTokenAmount;
        uint256 target;
        uint24 fee;
        bool tokenIsToken0;
        address creator;
        // --- state ---
        uint256 virtualQuote; // moves with trading
        uint256 virtualToken; // moves with trading
        uint256 sold; // tokens handed out by the curve so far
        uint256 raised; // native wei held for this curve — becomes the pool's quote side verbatim
        bool graduated;
        address pool;
    }

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    mapping(address => Curve) public curves;
    mapping(address => bool) public isOperator;
    address[] public tokens;

    /// @dev Sum of every live curve's `raised`. Native sitting above this is stray — a donation, or a
    /// refund that failed to land — and only that excess can ever be swept. Buyer money cannot be.
    uint256 public totalRaised;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Created(
        address indexed token,
        address indexed creator,
        uint256 curveSupply,
        uint256 seedTokenAmount,
        uint256 target,
        bool tokenIsToken0
    );
    event Bought(address indexed token, address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 raised);
    event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 raised);
    event Graduated(
        address indexed token,
        address indexed pool,
        uint256 quoteSeeded,
        uint256 tokensSeeded,
        uint256 positionId,
        uint128 liquidity
    );
    event OperatorSet(address indexed operator, bool allowed);
    event Swept(address indexed to, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error NotOperator();
    error WrongChain();
    error ZeroAddress();
    error BadToken();
    error BadSupplySplit();
    error BadTarget();
    error BadSeedSplit(uint256 needed, uint256 got);
    error FeeTierDisabled(uint24 fee);
    error TokenAddressMismatch();
    error SortSideMismatch(bool want, bool got);
    error AlreadyExists();
    error NoSuchCurve();
    error AlreadyGraduated();
    error NotGraduated();
    error Expired();
    error NothingIn();
    error SoldOut();
    error TooLittleOut(uint256 got, uint256 min);
    error PoolAlreadyExists();
    error PoolAddressMismatch(address predicted, address got);
    error RefundFailed();
    error PayoutFailed();
    error NpmFactoryMismatch(address expected, address got);
    error NpmWeth9Mismatch(address expected, address got);
    error PoolProbeRequired();
    error PoolProbeNotCanonical(address probe, address viaFactory);
    error PoolInitCodeHashMismatch(address probe, address derived);
    error RenounceDisabled();
    error NothingToSweep();

    // ---------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------

    constructor(
        address initialOwner,
        address lpVault_,
        address factory_,
        address npm_,
        address weth_,
        uint256 expectedChainId_,
        bytes32 poolInitCodeHash_,
        address poolProbe_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || lpVault_ == address(0) || factory_ == address(0) || npm_ == address(0)
                || weth_ == address(0)
        ) revert ZeroAddress();
        // No ERC721 receiver here, so a position NFT minted to this contract could never be moved again.
        if (lpVault_ == address(this)) revert ZeroAddress();
        if (block.chainid != expectedChainId_) revert WrongChain();

        // Venue coherence: the NPM publishes its own view of two of these three, so ask it rather than
        // trusting three constructor arguments to have been typed consistently.
        {
            address npmFactory = INonfungiblePositionManager(npm_).factory();
            if (npmFactory != factory_) revert NpmFactoryMismatch(factory_, npmFactory);
            address npmWeth = INonfungiblePositionManager(npm_).WETH9();
            if (npmWeth != weth_) revert NpmWeth9Mismatch(weth_, npmWeth);
        }

        // Bind the init code hash to a REAL pool this factory minted, which also proves `factory_` is the
        // factory that actually mints this venue's pools. A wrong hash then costs a failed deploy instead
        // of bricking every graduation.
        if (poolInitCodeHash_ != bytes32(0)) {
            if (poolProbe_ == address(0)) revert PoolProbeRequired();
            address t0 = IUniswapV3Pool(poolProbe_).token0();
            address t1 = IUniswapV3Pool(poolProbe_).token1();
            uint24 probeFee = IUniswapV3Pool(poolProbe_).fee();
            address viaFactory = IUniswapV3Factory(factory_).getPool(t0, t1, probeFee);
            if (viaFactory != poolProbe_) revert PoolProbeNotCanonical(poolProbe_, viaFactory);
            address derived = _poolFor(factory_, poolInitCodeHash_, t0, t1, probeFee);
            if (derived != poolProbe_) revert PoolInitCodeHashMismatch(poolProbe_, derived);
        }

        FACTORY = IUniswapV3Factory(factory_);
        NPM = INonfungiblePositionManager(npm_);
        WETH = IWETH9(weth_);
        LP_VAULT = lpVault_;
        EXPECTED_CHAIN_ID = expectedChainId_;
        POOL_INIT_CODE_HASH = poolInitCodeHash_;
    }

    modifier onlyOperator() {
        if (!isOperator[msg.sender] && msg.sender != owner()) revert NotOperator();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Create
    // ---------------------------------------------------------------------------------------------

    /// @notice Deploy a token and open its curve. Operator-gated; TRADING is not.
    /// @dev Creation is restricted and buying deliberately is not. The experiment is whether strangers
    /// and their bots turn up, so gating buys would be gating the measurement.
    function create(CreateParams calldata p) external onlyOperator nonReentrant returns (address token) {
        if (p.totalSupply == 0) revert BadToken();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadToken();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 64) revert BadToken();
        if (p.curveSupply == 0 || p.curveSupply >= p.totalSupply) revert BadSupplySplit();
        if (p.target == 0) revert BadTarget();
        if (FACTORY.feeAmountTickSpacing(p.fee) == 0) revert FeeTierDisabled(p.fee);

        // THE INVARIANT THAT KEEPS THE POOL HONEST. See the calibration note on the contract: with
        // virtualToken == 2 * curveSupply the curve closes at 2*target/curveSupply, and only a seed of
        // exactly curveSupply / 2 against the raised `target` opens the pool at that same price. Any other
        // split gaps the pool away from the curve's last fill and pays the difference to an arbitrageur
        // out of the buyers' raise. Checked, not documented.
        uint256 seed = p.totalSupply - p.curveSupply;
        if (seed != p.curveSupply / 2) revert BadSeedSplit(p.curveSupply / 2, seed);

        token = address(new PadToken{salt: p.tokenSalt}(p.name, p.symbol, p.decimals, p.totalSupply, address(this)));
        if (curves[token].curveSupply != 0) revert AlreadyExists();

        bool tokenIsToken0 = token < address(WETH);
        if (tokenIsToken0 != p.wantTokenIsToken0) revert SortSideMismatch(p.wantTokenIsToken0, tokenIsToken0);

        // The pool must not exist yet — an adopted pool would already carry a price somebody else chose,
        // and the graduation would seed into it at that price instead of the curve's.
        (address t0, address t1) = tokenIsToken0 ? (token, address(WETH)) : (address(WETH), token);
        if (FACTORY.getPool(t0, t1, p.fee) != address(0)) revert PoolAlreadyExists();

        curves[token] = Curve({
            curveSupply: p.curveSupply,
            seedTokenAmount: seed,
            target: p.target,
            fee: p.fee,
            tokenIsToken0: tokenIsToken0,
            creator: msg.sender,
            virtualQuote: p.target,
            virtualToken: 2 * p.curveSupply,
            sold: 0,
            raised: 0,
            graduated: false,
            pool: address(0)
        });
        tokens.push(token);

        emit Created(token, msg.sender, p.curveSupply, seed, p.target, tokenIsToken0);
    }

    // ---------------------------------------------------------------------------------------------
    // Trade
    // ---------------------------------------------------------------------------------------------

    /// @notice Buy on the curve. Overpaying past the last token is refunded, not kept.
    /// @dev Graduation is attempted inline the moment the raise is complete, so the buyer who finishes the
    /// curve is the one who pays that gas and the pool exists in the same transaction. If it reverts for a
    /// venue reason the buy still stands and `graduate` can be retried by anyone — the raise is never
    /// stranded behind a single failed call.
    function buy(address token, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (deadline < block.timestamp) revert Expired();
        Curve storage c = curves[token];
        if (c.curveSupply == 0) revert NoSuchCurve();
        if (c.graduated) revert AlreadyGraduated();
        if (msg.value == 0) revert NothingIn();

        uint256 remaining = c.curveSupply - c.sold;
        if (remaining == 0) revert SoldOut();

        uint256 k = c.virtualQuote * c.virtualToken;
        uint256 spend = msg.value;
        tokensOut = c.virtualToken - Math.ceilDiv(k, c.virtualQuote + spend);

        // Clamp to what is left and charge only for that, so the final buy cannot overshoot the supply and
        // cannot silently keep the overpayment. Price it as the exact quote that moves the curve to empty.
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            spend = Math.ceilDiv(k, c.virtualToken - tokensOut) - c.virtualQuote;
            if (spend > msg.value) spend = msg.value; // rounding guard; can only favour the curve
        }
        if (tokensOut < minTokensOut) revert TooLittleOut(tokensOut, minTokensOut);
        if (tokensOut == 0) revert NothingIn();

        c.virtualQuote += spend;
        c.virtualToken -= tokensOut;
        c.sold += tokensOut;
        c.raised += spend;
        totalRaised += spend;

        IERC20(token).safeTransfer(msg.sender, tokensOut);
        emit Bought(token, msg.sender, spend, tokensOut, c.raised);

        uint256 refund = msg.value - spend;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }

        if (c.raised >= c.target || c.sold == c.curveSupply) _tryGraduate(token);
    }

    /// @notice Sell back into the curve at the curve price.
    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        if (deadline < block.timestamp) revert Expired();
        Curve storage c = curves[token];
        if (c.curveSupply == 0) revert NoSuchCurve();
        if (c.graduated) revert AlreadyGraduated();
        if (tokensIn == 0) revert NothingIn();
        if (tokensIn > c.sold) revert SoldOut();

        uint256 k = c.virtualQuote * c.virtualToken;
        quoteOut = c.virtualQuote - Math.ceilDiv(k, c.virtualToken + tokensIn);
        if (quoteOut > c.raised) quoteOut = c.raised; // can only round in the curve's favour
        if (quoteOut < minQuoteOut) revert TooLittleOut(quoteOut, minQuoteOut);

        c.virtualQuote -= quoteOut;
        c.virtualToken += tokensIn;
        c.sold -= tokensIn;
        c.raised -= quoteOut;
        totalRaised -= quoteOut;

        // Pull the tokens BEFORE paying out. nonReentrant already covers the reentrancy case; this keeps
        // the ordering readable and makes a non-standard token's failure abort before any ETH moves.
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        (bool ok,) = msg.sender.call{value: quoteOut}("");
        if (!ok) revert PayoutFailed();

        emit Sold(token, msg.sender, tokensIn, quoteOut, c.raised);
    }

    // ---------------------------------------------------------------------------------------------
    // Graduate
    // ---------------------------------------------------------------------------------------------

    /// @notice Create the pool and mint the position. Callable by anyone once the target is met — the
    /// raise must never depend on one address staying willing to press a button.
    function graduate(address token) external nonReentrant {
        Curve storage c = curves[token];
        if (c.curveSupply == 0) revert NoSuchCurve();
        if (c.graduated) revert AlreadyGraduated();
        if (c.raised < c.target && c.sold < c.curveSupply) revert NotGraduated();
        _graduate(token, c);
    }

    /// @dev Inline attempt from `buy`. Swallows a revert on purpose: a venue-side failure must not undo a
    /// legitimate buy, and `graduate` stays open to retry.
    function _tryGraduate(address token) internal {
        try this.graduateSelf(token) {} catch {}
    }

    /// @notice Internal-use entry point for the inline attempt. Restricted to this contract so it cannot
    /// become a second, unguarded graduation path.
    function graduateSelf(address token) external {
        if (msg.sender != address(this)) revert NotOperator();
        Curve storage c = curves[token];
        if (c.graduated) revert AlreadyGraduated();
        _graduate(token, c);
    }

    function _graduate(address token, Curve storage c) internal {
        c.graduated = true; // set first: every path below is external, and this is the reentrancy latch

        uint256 quote = c.raised;
        uint256 tokensToSeed = c.seedTokenAmount;
        c.raised = 0;
        totalRaised -= quote;

        (address t0, address t1) = c.tokenIsToken0 ? (token, address(WETH)) : (address(WETH), token);
        (uint256 amount0, uint256 amount1) =
            c.tokenIsToken0 ? (tokensToSeed, quote) : (quote, tokensToSeed);

        // Price the pool at the ratio of what is actually going in, which — given the checked seed split —
        // is also the price the curve closed at. Deriving it from the amounts rather than from a supplied
        // tick means both sides are consumed and the pool cannot open on a stale number.
        uint160 sqrtPriceX96 = _sqrtPriceX96From(amount0, amount1);

        int24 spacing = FACTORY.feeAmountTickSpacing(c.fee);
        if (spacing == 0) revert FeeTierDisabled(c.fee);
        // Full range. The position must straddle the price to hold both sides, and a full-range position is
        // the only range that needs no further assumption about where the price goes next.
        int24 tickLower = TickMath.minUsableTick(spacing);
        int24 tickUpper = TickMath.maxUsableTick(spacing);

        if (FACTORY.getPool(t0, t1, c.fee) != address(0)) revert PoolAlreadyExists();
        address pool = NPM.createAndInitializePoolIfNecessary(t0, t1, c.fee, sqrtPriceX96);
        if (POOL_INIT_CODE_HASH != bytes32(0)) {
            address predicted = _poolFor(address(FACTORY), POOL_INIT_CODE_HASH, t0, t1, c.fee);
            if (pool != predicted) revert PoolAddressMismatch(predicted, pool);
        }
        c.pool = pool;

        // THE MOMENT THE WHOLE CONTRACT EXISTS FOR: the raise, wrapped, going in as the quote side. This
        // is also the Mint log the launch bots key on.
        WETH.deposit{value: quote}();
        IERC20(address(WETH)).forceApprove(address(NPM), quote);
        IERC20(token).forceApprove(address(NPM), tokensToSeed);

        uint256 wethBefore = WETH.balanceOf(address(this));
        (uint256 positionId, uint128 liquidity,,) = NPM.mint(
            INonfungiblePositionManager.MintParams({
                token0: t0,
                token1: t1,
                fee: c.fee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: LP_VAULT,
                deadline: block.timestamp
            })
        );

        IERC20(address(WETH)).forceApprove(address(NPM), 0);
        IERC20(token).forceApprove(address(NPM), 0);

        // Liquidity rounds DOWN, so a few wei of quote and a dust of token are always left behind. Unwrap
        // the quote dust back to native — it lands in the sweepable excess rather than being counted as
        // some other curve's raise, because `totalRaised` was already reduced by the full `quote`.
        uint256 wethLeft = WETH.balanceOf(address(this)) - (wethBefore - quote);
        if (wethLeft > 0) WETH.withdraw(wethLeft);

        emit Graduated(token, pool, quote - wethLeft, tokensToSeed, positionId, liquidity);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /// @notice What `buy` would return for `quoteIn`, and what it would actually charge.
    function previewBuy(address token, uint256 quoteIn) external view returns (uint256 tokensOut, uint256 spend) {
        Curve storage c = curves[token];
        if (c.curveSupply == 0 || c.graduated) return (0, 0);
        uint256 remaining = c.curveSupply - c.sold;
        if (remaining == 0) return (0, 0);
        uint256 k = c.virtualQuote * c.virtualToken;
        spend = quoteIn;
        tokensOut = c.virtualToken - Math.ceilDiv(k, c.virtualQuote + spend);
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            spend = Math.ceilDiv(k, c.virtualToken - tokensOut) - c.virtualQuote;
            if (spend > quoteIn) spend = quoteIn;
        }
    }

    function previewSell(address token, uint256 tokensIn) external view returns (uint256 quoteOut) {
        Curve storage c = curves[token];
        if (c.curveSupply == 0 || c.graduated || tokensIn > c.sold) return 0;
        uint256 k = c.virtualQuote * c.virtualToken;
        quoteOut = c.virtualQuote - Math.ceilDiv(k, c.virtualToken + tokensIn);
        if (quoteOut > c.raised) quoteOut = c.raised;
    }

    /// @notice Address a token will land on for a given salt, so the salt can be mined off chain.
    function predictToken(CreateParams calldata p) external view returns (address token, bool tokenIsToken0) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(PadToken).creationCode, abi.encode(p.name, p.symbol, p.decimals, p.totalSupply, address(this))
            )
        );
        token = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), p.tokenSalt, initHash))))
        );
        tokenIsToken0 = token < address(WETH);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    /// @dev sqrt(amount1/amount0) in Q64.96. `mulDiv` carries the full 512-bit intermediate, so shifting by
    /// 192 before the divide loses no precision and cannot overflow on the way.
    function _sqrtPriceX96From(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        uint256 ratioX192 = Math.mulDiv(amount1, 1 << 192, amount0);
        uint256 sqrtP = Math.sqrt(ratioX192);
        if (sqrtP < TickMath.MIN_SQRT_PRICE || sqrtP > TickMath.MAX_SQRT_PRICE) revert BadTarget();
        return uint160(sqrtP);
    }

    function _poolFor(address factory_, bytes32 initHash, address tokenA, address tokenB, uint24 fee)
        internal
        pure
        returns (address)
    {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), factory_, keccak256(abi.encode(t0, t1, fee)), initHash)
                    )
                )
            )
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    function setOperator(address op, bool allowed) external onlyOwner {
        if (op == address(0)) revert ZeroAddress();
        isOperator[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    /// @notice Sweep ONLY native above the sum of live raises. Buyer money is not reachable.
    function sweepExcess(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 excess = address(this).balance - totalRaised;
        if (excess == 0) revert NothingToSweep();
        (bool ok,) = to.call{value: excess}("");
        if (!ok) revert PayoutFailed();
        emit Swept(to, excess);
    }

    /// @dev Ownable2Step already requires the new owner to accept. Renouncing is still disabled: an owner
    /// with no operators can never grant one again, and `sweepExcess` would be unreachable forever.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev Only from WETH unwrapping. Anything else would be an unattributable donation, and this
    /// contract's accounting is the difference between a buyer's money and a sweepable balance.
    receive() external payable {
        if (msg.sender != address(WETH)) revert NotOperator();
    }
}

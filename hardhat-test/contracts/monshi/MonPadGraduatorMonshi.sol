// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================================
//  MonPadGraduatorMonshi — MONSHI/token graduation LP
// ----------------------------------------------------------------------------
//  MONSHI-native rebuild of MonPadGraduator. Instead of wrapping native MON into
//  WMON and seeding a WMON/token Uniswap V3 pool, this seeds a MONSHI/token pool.
//
//  Flow per token:
//    1. Curve transfers `lpTokens` of the launched token to this contract.
//    2. Curve transfers `quoteAmount` MONSHI to this contract.
//    3. Curve calls onGraduate(token, lpTokens, quoteAmount) (NON-payable).
//    4. Graduator creates+inits the MONSHI/token V3 pool if needed, mints a
//       full-range position, then burns the LP NFT (sent to dEaD).
//
//  NOT YET DEPLOYED. Draft for review + audit. See MONSHI-REBUILD.md.
// ============================================================================

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    constructor() { _status = _NOT_ENTERED; }
    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

interface IUniswapV3Pool {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
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
    function factory() external view returns (address);
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IMonPadFactory {
    function graduator() external view returns (address);
    function tokToCurve(address token) external view returns (address);
    function treasuryWallet() external view returns (address);
}

contract MonPadGraduatorMonshi is ReentrancyGuard, IERC721Receiver {
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint24  public constant POOL_FEE = 10000;
    int24   public constant TICK_LOWER = -887200;
    int24   public constant TICK_UPPER =  887200;
    uint256 public constant MINT_DEADLINE_BUFFER = 600;
    /// @dev Minimum MONSHI the curve must send on graduation. Dust-prevention floor only.
    uint256 public constant LP_MON_MIN = 1 ether;

    IMonPadFactory              public immutable monpadFactory;
    INonfungiblePositionManager public immutable npm;
    IUniswapV3Factory           public immutable uniV3Factory;
    /// @notice MONSHI ERC20 — the quote side of every graduation pool.
    IERC20                      public immutable quote;

    address public owner;
    address public pendingOwner;

    mapping(address => bool)    public graduated;
    mapping(address => address) public tokenToPool;
    mapping(address => uint256) public tokenToNftId;

    address private _tokenInFlight;

    event Graduated(
        address indexed token,
        address indexed pool,
        uint256 nftId,
        uint256 amountToken,
        uint256 amountQuote,
        uint128 liquidity,
        uint160 sqrtPriceX96
    );
    event PoolCreated(address indexed token, address indexed pool, uint160 sqrtPriceX96);
    event NftBurned(address indexed token, uint256 indexed nftId);
    event Swept(address indexed asset, address indexed to, uint256 amount, bool isEth);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PreDepositSwept(address indexed token, uint256 amount, address indexed treasury);

    error NotCurve();
    error AlreadyGraduated(address token);
    error WrongQuoteAmount(uint256 provided, uint256 minRequired);
    error InsufficientQuoteBalance(uint256 have, uint256 need);
    error PoolPreInitWithBadPrice(address pool, uint160 expected, uint160 actual);
    error InsufficientTokenBalance(uint256 have, uint256 need);
    error MintFailed();
    error AssetInFlight(address asset);
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error PlainMonRejected();
    error UnknownCall();
    error QuoteApproveFailed();
    error TokenApproveFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _factory, address _npm, address _quoteToken) {
        if (_factory == address(0) || _npm == address(0) || _quoteToken == address(0)) revert ZeroAddress();
        monpadFactory = IMonPadFactory(_factory);
        npm           = INonfungiblePositionManager(_npm);
        quote         = IERC20(_quoteToken);
        uniV3Factory  = IUniswapV3Factory(INonfungiblePositionManager(_npm).factory());
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Graduation entry point. Called by the curve once graduation conditions hit.
    /// @param token       The graduating MonPad token.
    /// @param lpTokens    Token-side amount the curve already transferred here.
    /// @param quoteAmount MONSHI-side amount the curve already transferred here.
    function onGraduate(address token, uint256 lpTokens, uint256 quoteAmount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();

        // Only the factory-registered curve for this exact token may call.
        address registeredCurve = monpadFactory.tokToCurve(token);
        if (registeredCurve == address(0) || msg.sender != registeredCurve) revert NotCurve();

        if (graduated[token]) revert AlreadyGraduated(token);

        if (quoteAmount < LP_MON_MIN) revert WrongQuoteAmount(quoteAmount, LP_MON_MIN);

        // Verify the MONSHI side actually arrived.
        uint256 quoteBal = quote.balanceOf(address(this));
        if (quoteBal < quoteAmount) revert InsufficientQuoteBalance(quoteBal, quoteAmount);

        // Token side: use caller-supplied lpTokens, sweep any excess to treasury.
        uint256 actualBalance = IERC20(token).balanceOf(address(this));
        if (actualBalance < lpTokens) revert InsufficientTokenBalance(actualBalance, lpTokens);
        if (actualBalance > lpTokens) {
            uint256 excess = actualBalance - lpTokens;
            address tre = monpadFactory.treasuryWallet();
            if (tre == address(0)) revert ZeroAddress();
            bool okSweep = IERC20(token).transfer(tre, excess);
            if (!okSweep) revert TokenApproveFailed();
            emit PreDepositSwept(token, excess, tre);
        }
        uint256 amountToken = lpTokens;

        _tokenInFlight = token;

        // Resolve token0/token1 ordering between the launched token and MONSHI.
        address tokenA = token;
        address tokenB = address(quote);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        uint256 amount0Desired;
        uint256 amount1Desired;
        if (token0 == tokenA) {
            amount0Desired = amountToken;
            amount1Desired = quoteAmount;
        } else {
            amount0Desired = quoteAmount;
            amount1Desired = amountToken;
        }

        // Get-or-create the V3 pool.
        address pool = uniV3Factory.getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) {
            pool = uniV3Factory.createPool(token0, token1, POOL_FEE);
        }

        // Initialize only if uninitialized; else require existing price within tolerance.
        uint160 sqrtPriceX96 = _computeSqrtPriceX96(amount0Desired, amount1Desired);
        (uint160 existingSqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (existingSqrtPriceX96 == 0) {
            IUniswapV3Pool(pool).initialize(sqrtPriceX96);
            emit PoolCreated(token, pool, sqrtPriceX96);
        } else {
            uint256 expected = uint256(sqrtPriceX96);
            uint256 actual   = uint256(existingSqrtPriceX96);
            uint256 diff     = expected > actual ? expected - actual : actual - expected;
            if (diff * 1000 > expected) {
                revert PoolPreInitWithBadPrice(pool, sqrtPriceX96, existingSqrtPriceX96);
            }
        }

        // Approve NPM for both sides (approve(0) then approve(amount)).
        bool okT0 = IERC20(token).approve(address(npm), 0);
        if (!okT0) revert TokenApproveFailed();
        bool okT  = IERC20(token).approve(address(npm), amountToken);
        if (!okT)  revert TokenApproveFailed();

        bool okQ0 = quote.approve(address(npm), 0);
        if (!okQ0) revert QuoteApproveFailed();
        bool okQ  = quote.approve(address(npm), quoteAmount);
        if (!okQ)  revert QuoteApproveFailed();

        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0:          token0,
            token1:          token1,
            fee:             POOL_FEE,
            tickLower:       TICK_LOWER,
            tickUpper:       TICK_UPPER,
            amount0Desired:  amount0Desired,
            amount1Desired:  amount1Desired,
            amount0Min:      0,
            amount1Min:      0,
            recipient:       address(this),
            deadline:        block.timestamp + MINT_DEADLINE_BUFFER
        });

        (uint256 nftId, uint128 liquidity, uint256 used0, uint256 used1) = npm.mint(params);
        if (nftId == 0 || liquidity == 0) revert MintFailed();
        used0; used1;

        graduated[token]    = true;
        tokenToPool[token]  = pool;
        tokenToNftId[token] = nftId;

        npm.safeTransferFrom(address(this), BURN_ADDRESS, nftId);
        emit NftBurned(token, nftId);

        // Sweep any post-mint residual to treasury. V3 mint with amountXMin=0 consumes the two
        // sides by the live price and leaves a little of one of them; without this it would be
        // locked behind the graduated[] sweep guard forever (audit L-5).
        address treasury = monpadFactory.treasuryWallet();
        if (treasury != address(0)) {
            uint256 tokLeft = IERC20(token).balanceOf(address(this));
            if (tokLeft > 0) IERC20(token).transfer(treasury, tokLeft);
            uint256 quoteLeft = quote.balanceOf(address(this));
            if (quoteLeft > 0) quote.transfer(treasury, quoteLeft);
        }

        _tokenInFlight = address(0);

        emit Graduated(token, pool, nftId, amountToken, quoteAmount, liquidity, sqrtPriceX96);
    }

    // ── pricing ───────────────────────────────
    function _computeSqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "PRICE_ZERO");
        uint256 sqrtA1 = _sqrt(amount1);
        uint256 sqrtA0 = _sqrt(amount0);
        uint256 priceX96 = (sqrtA1 << 96) / sqrtA0;
        require(priceX96 <= type(uint160).max, "PRICE_OVERFLOW");
        return uint160(priceX96);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ── sweep ─────────────────────────────────
    function sweep(address asset, address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (asset != address(0)) {
            if (graduated[asset] || asset == _tokenInFlight) revert AssetInFlight(asset);
        }
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "NATIVE_SEND_FAIL");
            emit Swept(address(0), to, amount, true);
        } else {
            bool ok = IERC20(asset).transfer(to, amount);
            require(ok, "ERC20_TRANSFER_FAIL");
            emit Swept(asset, to, amount, false);
        }
    }

    // ── ownership ─────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    // ── views ─────────────────────────────────
    function poolFor(address token) external view returns (address) { return tokenToPool[token]; }
    function nftIdFor(address token) external view returns (uint256) { return tokenToNftId[token]; }
    function isGraduated(address token) external view returns (bool) { return graduated[token]; }

    // ── ERC721 receiver ───────────────────────
    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ── native MON rules ──────────────────────
    /// @dev This contract handles MONSHI (an ERC20) only — it never needs native MON.
    receive() external payable { revert PlainMonRejected(); }
    fallback() external payable { revert UnknownCall(); }
}

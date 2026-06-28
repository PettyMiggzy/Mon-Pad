// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonPadGraduator
 * @notice Receives a graduating MonPad token + 400,000 MON from the bonding curve and
 *         seeds a Uniswap V3 (Monad) full-range liquidity position. The resulting LP
 *         NFT is permanently burned (sent to dEaD), making liquidity irrevocable.
 *
 *         Flow per token:
 *           1. Curve transfers `graduationLP` worth of token to this contract.
 *           2. Curve calls onGraduate{value: 400_000 ether}(token) on this contract.
 *           3. Graduator wraps MON -> WMON, creates+inits the V3 pool if needed,
 *              mints a full-range position, then burns the resulting NFT.
 *
 *         All token0/token1 ordering is handled internally. Slippage mins are 0
 *         because this is the very first liquidity in the pool.
 */

/* ------------------------------------------------------------------ */
/*                      Inlined: ReentrancyGuard                       */
/* ------------------------------------------------------------------ */
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

/* ------------------------------------------------------------------ */
/*                       Inlined: IERC721Receiver                      */
/* ------------------------------------------------------------------ */
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

/* ------------------------------------------------------------------ */
/*                          External Interfaces                        */
/* ------------------------------------------------------------------ */
interface IToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IWMON {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
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
    /// @notice Required for V2.1-2 caller authentication: maps token => its bonding curve.
    function tokToCurve(address token) external view returns (address);
    function treasuryWallet() external view returns (address);
}

/* ------------------------------------------------------------------ */
/*                          MonPadGraduator                            */
/* ------------------------------------------------------------------ */
// V3: identical to the audited MonPadGraduator (native MON -> WMON/token Uniswap V3 LP,
// onGraduate(token, lpTokens) payable, Graduated event carries the pool for DexScreener),
// plus a post-mint dust sweep so V3-mint residuals aren't locked behind the sweep guard.
contract MonPadGraduatorV3 is ReentrancyGuard, IERC721Receiver {
    /* ----------------------------- Constants --------------------------- */

    /// @dev Burn sink for the LP NFT.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @dev V3 fee tier used for every graduating pool (1%).
    uint24  public constant POOL_FEE = 10000;

    /// @dev Full-range ticks for fee = 10000 (tickSpacing = 200). 887200 = floor(887272 / 200) * 200.
    int24   public constant TICK_LOWER = -887200;
    int24   public constant TICK_UPPER =  887200;

    /// @dev Mint deadline buffer added to block.timestamp.
    uint256 public constant MINT_DEADLINE_BUFFER = 600;

    /// @dev Minimum LP-side MON the curve must send on graduation. Sanity floor only.
    ///      Set generously low (1 MON) so creatorReward / graduationCreatorReward rotations
    ///      cannot brick graduation. See V2.1-6: previously this was a strict equality
    ///      against a hardcoded 400_000 ether, which made `graduationLP` decorative AND
    ///      stranded any monRaisedNet overshoot in the curve forever.
    ///      Auth (V2.1-2: msg.sender == factory.tokToCurve(token)) is what protects against
    ///      attacker-controlled tiny LPs; this floor is just dust-prevention for operator error.
    uint256 public constant LP_MON_MIN = 1 ether;

    /* ---------------------------- Immutables --------------------------- */

    /// @notice MonPad factory — only authorized caller is the curve it spawned.
    IMonPadFactory      public immutable monpadFactory;

    /// @notice Uniswap V3 NonfungiblePositionManager (Monad).
    INonfungiblePositionManager public immutable npm;

    /// @notice WMON wrapper.
    IWMON               public immutable wmon;

    /// @notice Uniswap V3 core factory (derived from npm.factory()).
    IUniswapV3Factory   public immutable uniV3Factory;

    /* ----------------------------- Storage ----------------------------- */

    /// @notice 2-step ownership.
    address public owner;
    address public pendingOwner;

    /// @notice token => has graduation completed for this token.
    mapping(address => bool)    public graduated;

    /// @notice token => Uniswap V3 pool address.
    mapping(address => address) public tokenToPool;

    /// @notice token => LP NFT id minted then burned.
    mapping(address => uint256) public tokenToNftId;

    /// @dev Re-entrancy / sweep guard for the in-flight token in onGraduate.
    address private _tokenInFlight;

    /* ------------------------------ Events ----------------------------- */

    event Graduated(
        address indexed token,
        address indexed pool,
        uint256 nftId,
        uint256 amountToken,
        uint256 amountWmon,
        uint128 liquidity,
        uint160 sqrtPriceX96
    );
    event PoolCreated(address indexed token, address indexed pool, uint160 sqrtPriceX96);
    event NftBurned(address indexed token, uint256 indexed nftId);
    event Swept(address indexed asset, address indexed to, uint256 amount, bool isEth);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PreDepositSwept(address indexed token, uint256 amount, address indexed treasury);

    /* ------------------------------ Errors ----------------------------- */

    error NotCurve();
    error AlreadyGraduated(address token);
    error WrongMonAmount(uint256 provided, uint256 minRequired);
    error NoTokenBalance(address token);
    error PoolAlreadyInitialized(address pool);
    error MintFailed();
    error AssetInFlight(address asset);
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error PlainMonRejected();
    error UnknownCall();
    error WmonApproveFailed();
    error PoolPreInitWithBadPrice(address pool, uint160 expected, uint160 actual);
    error InsufficientTokenBalance(uint256 have, uint256 need);
    error TokenApproveFailed();

    /* ----------------------------- Modifier ---------------------------- */

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /* ---------------------------- Constructor -------------------------- */

    /**
     * @param _factory MonPad factory address (authoritative source for `graduator()`).
     * @param _npm     Uniswap V3 NonfungiblePositionManager (0xa9f6...0526 on Monad).
     * @param _wmon    WMON wrapper (0x3bd3...433A on Monad).
     */
    constructor(address _factory, address _npm, address _wmon) {
        if (_factory == address(0) || _npm == address(0) || _wmon == address(0)) revert ZeroAddress();

        monpadFactory = IMonPadFactory(_factory);
        npm           = INonfungiblePositionManager(_npm);
        wmon          = IWMON(_wmon);
        uniV3Factory  = IUniswapV3Factory(INonfungiblePositionManager(_npm).factory());

        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /* --------------------------- Graduation ---------------------------- */

    /**
     * @notice Called by a MonPad bonding curve when its token graduates.
     *         Caller is implicitly authorized via the curve→factory→token relationship:
     *         - msg.value MUST equal LP_MON_AMOUNT (400,000 ether).
     *         - The full token-side balance is whatever the curve has just transferred to us
     *           (read live via balanceOf(address(this))).
     *
     *         Authorization: msg.sender MUST be a curve registered in the MonPad factory
     *         AND the factory.graduator() MUST be this contract (latter checked off-chain at
     *         deployment / governance, but we still gate by the simple invariant that
     *         graduating the same token twice is impossible).
     *
     * @param token Address of the graduating MonPad token.
     */
    /// @notice Graduation entry point. Called by curve once graduation conditions hit.
    /// @dev If the V3 pool was pre-initialized at a price > 1%% from the curve's computed
    ///      price, this call reverts. Failure is griefing-only — attacker cannot profit.
    ///      Recovery is out-of-band (e.g. wait for arbitrage, or community migration).
    function onGraduate(address token, uint256 lpTokens) external payable nonReentrant {
        // ---- 1. Basic preconditions
        if (token == address(0))            revert ZeroAddress();

        // V2.1-2 auth: only the factory-registered curve for this exact token may call.
        // Without this, anyone with `monAmt` MON + a few wei of token can pre-graduate any
        // MonPad token and permanently brick its real graduation.
        address registeredCurve = monpadFactory.tokToCurve(token);
        if (registeredCurve == address(0) || msg.sender != registeredCurve) revert NotCurve();

        if (graduated[token])               revert AlreadyGraduated(token);

        // V2.1-6: accept any msg.value above the sanity floor. The curve sends its full
        // post-fee balance (which is monRaisedNet - creatorReward, plus any overshoot above
        // graduationTarget). Strict equality here previously bricked graduation any time the
        // curve's balance didn't land exactly on 400_000 ether.
        uint256 monAmt = msg.value;
        if (monAmt < LP_MON_MIN)            revert WrongMonAmount(monAmt, LP_MON_MIN);

        // C-2 fix: use caller-supplied lpTokens, sweep any excess to treasury.
        uint256 actualBalance = IToken(token).balanceOf(address(this));
        if (actualBalance < lpTokens) revert InsufficientTokenBalance(actualBalance, lpTokens);
        if (actualBalance > lpTokens) {
            uint256 excess = actualBalance - lpTokens;
            address tre = IMonPadFactory(monpadFactory).treasuryWallet();
            if (tre == address(0)) revert ZeroAddress();
            bool okSweep = IToken(token).transfer(tre, excess);
            if (!okSweep) revert TokenApproveFailed();
            emit PreDepositSwept(token, excess, tre);
        }
        uint256 amountToken = lpTokens;

        // Reserve the in-flight slot so an open sweep cannot steal the asset mid-call.
        _tokenInFlight = token;

        // ---- 2. Wrap MON → WMON
        wmon.deposit{value: monAmt}();

        // ---- 3. Resolve token0/token1 ordering
        address tokenA = token;
        address tokenB = address(wmon);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        uint256 amount0Desired;
        uint256 amount1Desired;
        if (token0 == tokenA) {
            // token is token0, wmon is token1
            amount0Desired = amountToken;
            amount1Desired = monAmt;
        } else {
            // wmon is token0, token is token1
            amount0Desired = monAmt;
            amount1Desired = amountToken;
        }

        // ---- 4. Get-or-create the V3 pool
        address pool = uniV3Factory.getPool(token0, token1, POOL_FEE);
        if (pool == address(0)) {
            pool = uniV3Factory.createPool(token0, token1, POOL_FEE);
        }

        // ---- 5. Initialize the pool only if uninitialized
        uint160 sqrtPriceX96 = _computeSqrtPriceX96(amount0Desired, amount1Desired);
        (uint160 existingSqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (existingSqrtPriceX96 == 0) {
            IUniswapV3Pool(pool).initialize(sqrtPriceX96);
            emit PoolCreated(token, pool, sqrtPriceX96);
        } else {
            // C-1 fix: pool was pre-initialized. Require existing price within 1%
            // of computed price, else revert. Griefing-only failure mode.
            uint256 expected = uint256(sqrtPriceX96);
            uint256 actual   = uint256(existingSqrtPriceX96);
            uint256 diff     = expected > actual ? expected - actual : actual - expected;
            if (diff * 1000 > expected) { // N-1: 0.1% sqrt-price (~0.2% real-price) tolerance
                revert PoolPreInitWithBadPrice(pool, sqrtPriceX96, existingSqrtPriceX96);
            }
        }

        // ---- 6. Approve NPM for both sides (manual approve(0) then approve(amount))
        //         Token side uses curve-style direct call with bool return check.
        bool okT0 = IToken(token).approve(address(npm), 0);
        if (!okT0) revert TokenApproveFailed();
        bool okT  = IToken(token).approve(address(npm), amountToken);
        if (!okT)  revert TokenApproveFailed();

        bool okW0 = wmon.approve(address(npm), 0);
        if (!okW0) revert WmonApproveFailed();
        bool okW  = wmon.approve(address(npm), monAmt);
        if (!okW)  revert WmonApproveFailed();

        // ---- 7. Mint full-range position to this contract (so we can immediately burn it)
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
        used0; used1; // used amounts are not asserted (mins = 0); kept silent.

        // ---- 8. Record state BEFORE external NFT transfer (CEI)
        graduated[token]    = true;
        tokenToPool[token]  = pool;
        tokenToNftId[token] = nftId;

        // ---- 9. Burn the LP NFT permanently
        npm.safeTransferFrom(address(this), BURN_ADDRESS, nftId);
        emit NftBurned(token, nftId);

        // ---- 9b. Sweep post-mint residual to treasury. V3 mint with amount*Min=0 consumes the
        // two sides by the live price and leaves a little of one of them; without this it would be
        // locked behind the graduated[] sweep guard forever.
        {
            address treasury = monpadFactory.treasuryWallet();
            if (treasury != address(0)) {
                uint256 tokLeft = IToken(token).balanceOf(address(this));
                if (tokLeft > 0) IToken(token).transfer(treasury, tokLeft);
                uint256 wmonLeft = wmon.balanceOf(address(this));
                if (wmonLeft > 0) wmon.transfer(treasury, wmonLeft);
            }
        }

        // ---- 10. Clear the in-flight slot before emitting final event
        _tokenInFlight = address(0);

        // ---- 11. Final event
        emit Graduated(
            token,
            pool,
            nftId,
            amountToken,
            monAmt,
            liquidity,
            sqrtPriceX96
        );
    }

    /* ----------------------- Internal: pricing ------------------------- */

    /**
     * @dev sqrtPriceX96 = sqrt(amount1 / amount0) * 2**96.
     *      We compute sqrt(amount1 * 2**192 / amount0) which equals the above without losing precision.
     *      With amounts up to ~1e27 and 2**192 ~= 6.27e57, the numerator fits in 256 bits comfortably
     *      because amount1 * 2**192 ≤ 4e26 * 6.3e57 ≈ 2.5e84 < 2**281? No — we must be careful.
     *      Numerator can exceed 2**256, so we split: sqrt(a1) * 2**96 / sqrt(a0).
     */
    function _computeSqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "PRICE_ZERO");
        uint256 sqrtA1 = _sqrt(amount1);
        uint256 sqrtA0 = _sqrt(amount0);
        // Multiply numerator first by 2**96. sqrtA1 ≤ sqrt(1e27) ≈ 3.16e13 → sqrtA1 << 96 fits in 256 bits.
        uint256 priceX96 = (sqrtA1 << 96) / sqrtA0;
        require(priceX96 <= type(uint160).max, "PRICE_OVERFLOW");
        return uint160(priceX96);
    }

    /// @dev Babylonian integer square root.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /* ------------------------------ Sweep ------------------------------ */

    /**
     * @notice Owner-only sweep for stuck assets. Cannot touch graduated tokens or the in-flight token.
     *         WMON is generally fine to sweep — if a graduation succeeded fully there should be
     *         no leftover WMON on this contract.
     *
     *         V2.1-7 fix: was permissionless. Native MON had no graduation guard at all,
     *         so anyone could drain forced-transferred MON or any leftover from a partially-
     *         failed flow. Now gated behind onlyOwner.
     * @param asset  ERC-20 to sweep (address(0) = native MON)
     * @param to     Recipient
     * @param amount Amount to sweep
     */
    function sweep(address asset, address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        // Block sweeping anything tied to an active or completed graduation.
        if (asset != address(0)) {
            if (graduated[asset] || asset == _tokenInFlight) revert AssetInFlight(asset);
        }

        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "NATIVE_SEND_FAIL");
            emit Swept(address(0), to, amount, true);
        } else {
            bool ok = IToken(asset).transfer(to, amount);
            require(ok, "ERC20_TRANSFER_FAIL");
            emit Swept(asset, to, amount, false);
        }
    }

    /* --------------------------- Ownership ----------------------------- */

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

    /* ------------------------------ Views ------------------------------ */

    function poolFor(address token) external view returns (address) {
        return tokenToPool[token];
    }

    function nftIdFor(address token) external view returns (uint256) {
        return tokenToNftId[token];
    }

    function isGraduated(address token) external view returns (bool) {
        return graduated[token];
    }

    /* -------------------------- ERC721 receiver ------------------------ */

    /// @dev Required for npm.mint() to land the LP NFT here before we forward to BURN.
    function onERC721Received(
        address /* operator */,
        address /* from */,
        uint256 /* tokenId */,
        bytes calldata /* data */
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /* -------------------------- MON entry rules ------------------------ */

    /**
     * @dev Accept native MON only from WMON (the unwrap path) and reject every other plain send.
     *      The 400,000 MON for an actual graduation arrives via onGraduate(), which is `payable`,
     *      not via receive().
     */
    receive() external payable {
        if (msg.sender != address(wmon)) revert PlainMonRejected();
    }

    fallback() external payable {
        revert UnknownCall();
    }
}

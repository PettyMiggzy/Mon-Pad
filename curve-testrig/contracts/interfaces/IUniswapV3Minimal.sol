// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IUniswapV3Minimal — hand-written V3 surface for AtomicExperimentPad
/// @notice node_modules carries @uniswap/v4-core and @uniswap/v4-periphery ONLY; there is no v3-core or
/// v3-periphery package to import from. Rather than vendor two more packages for six functions, the exact
/// surface the pad touches is declared here.
///
/// EVERY selector below was confirmed PRESENT in the live runtime bytecode of the named Robinhood Chain
/// (chainId 4663) address before being written down. A selector that is merely "standard V3" but absent from
/// the deployed code would produce a silent no-op or a bare revert at launch time, so presence was measured,
/// not assumed.
///
/// UNITS, stated once and referenced everywhere else:
///   - `fee` is hundredths of a bip (1e-6). 10000 == 1%.
///   - every tick is a V3 tick in POOL orientation, i.e. the price of token1 per token0 AFTER sorting.
///   - every amount is RAW base units (no decimal scaling), matching what scripts/watch-launches.cjs
///     records with `amount0.toString()`.

/// @dev 0x1f7d7550b1b028f7571e69a784071f0205fd2efa on Robinhood Chain — the CANONICAL UniswapV3Factory.
/// Proven by CREATE2: all 6 reference-pad pools reproduce exactly under
/// keccak256(abi.encode(token0,token1,fee)) with init code hash
/// 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54, so it deploys unmodified pool bytecode.
interface IUniswapV3Factory {
    /// @notice fee (hundredths of a bip) -> tick spacing. Returns 0 when the tier is NOT enabled.
    /// @dev Measured live on the canonical factory: 100->1, 500->10, 3000->60, 10000->200, and both
    /// 2500->0 and 20000->0. NEVER hardcode this map: three V3 factories coexist on this chain and they
    /// disagree — 0xe0c4ceb92d08ca985bb70fe0a22feb121a9854a8 emits fee 10000 paired with tickSpacing 100.
    /// The canonical factory's owner (0x05c420bc4823e039aa4da645edde743486daaa25) is also live and can
    /// enable further tiers, so the map is a runtime read, not a compile-time constant.
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);

    /// @notice Canonical pool for the (unordered) pair at `fee`, or address(0).
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);

    /// @notice Deploy the pool. Only needed if the NPM helper is bypassed; the pad does not call this.
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

/// @dev 0x73991a25c818bf1f1128deaab1492d45638de0d3 — "Uniswap V3 Positions NFT-V1" / "UNI-V3-POS",
/// factory() == the canonical factory, WETH9() == the quote token. The reference pad's own runtime embeds
/// this address. Going through the NPM (rather than pool.mint directly) means the pad needs NO
/// uniswapV3MintCallback: the NPM implements it itself (selector 0xd3487997 present in its runtime).
interface INonfungiblePositionManager {
    struct MintParams {
        address token0; // SORTED low
        address token1; // SORTED high
        uint24 fee; // hundredths of a bip
        int24 tickLower; // MUST be a multiple of tickSpacing
        int24 tickUpper; // MUST be a multiple of tickSpacing
        uint256 amount0Desired; // RAW base units of token0
        uint256 amount1Desired; // RAW base units of token1
        uint256 amount0Min; // slippage floor; must be STRICTLY below desired (amounts round down)
        uint256 amount1Min;
        address recipient; // receives the ERC721 position NFT
        uint256 deadline; // unix seconds
    }

    /// @notice Selector 0x13ead562. factory.createPool + pool.initialize in one idempotent call.
    /// @param token0 MUST already be the lower-sorting address.
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    /// @notice Selector 0x88316456.
    /// @return tokenId the position NFT id
    /// @return liquidity the L actually minted (rounded DOWN from the desired amounts)
    /// @return amount0 the RAW token0 actually pulled — ALWAYS <= amount0Desired
    /// @return amount1 the RAW token1 actually pulled — ALWAYS <= amount1Desired
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @dev Canonical UniswapV3Pool bytecode, verified via the init code hash above.
interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    /// @notice The spacing BAKED INTO the deployed pool. Cross-checked against the factory's map so a
    /// venue whose map drifted after the pool was created fails loudly instead of minting a misaligned range.
    function tickSpacing() external view returns (int24);

    /// @notice Direct dev-buy path. `zeroForOne` must be `!tokenIsToken0` (the pad always SELLS the quote).
    /// Requires the caller to implement uniswapV3SwapCallback and authenticate msg.sender.
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified, // positive == exact input
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @dev 0x0bd7d308f8e1639fab988df18a8011f41eacad73 is WETH9-COMPATIBLE BUT NOT AN IMMUTABLE WETH9 — it is an
/// EIP-1967 proxy (implementation slot holds 0xc6b81b429797e0f555440b70cd99e032d7ae947e). The proxy's own
/// 2202 bytes contain NO ERC20 selectors, so a naive "does this address have deposit()" bytecode probe returns
/// FALSE; the implementation is where deposit() 0xd0e30db0 and withdraw(uint256) 0x2e1a7d4d actually live.
/// Behaviourally WETH9 today, but the admin can swap the implementation — treat these semantics as an
/// assumption to re-verify before each experiment run, not an invariant.
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice The ONLY callback the pad exposes. Deliberately no IUniswapV3MintCallback: the NPM implements
/// that itself, and declaring it would add a selector the pad has no business answering.
interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

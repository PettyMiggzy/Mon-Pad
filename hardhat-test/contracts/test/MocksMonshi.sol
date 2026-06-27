// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ------------------------------------------------------------------ */
/*  Test-only mocks for the MONSHI-native contract set.               */
/*  Functional Uniswap V3 stubs so the REAL MonPadGraduatorMonshi can */
/*  be driven end-to-end on a vanilla hardhat node.                   */
/* ------------------------------------------------------------------ */

interface IERC20m {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Minimal functional V3 pool: stores sqrtPrice, supports initialize/slot0.
contract MockV3PoolM {
    uint160 public sqrtPriceX96;
    function initialize(uint160 _sqrtPriceX96) external { sqrtPriceX96 = _sqrtPriceX96; }
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, int24(0), uint16(0), uint16(0), uint16(0), uint8(0), true);
    }
}

/// @notice Functional V3 factory: deploys/returns a MockV3PoolM per (tokenA,tokenB,fee).
contract MockV3FactoryM {
    mapping(bytes32 => address) public pools;

    function _key(address a, address b, uint24 fee) internal pure returns (bytes32) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(t0, t1, fee));
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[_key(a, b, fee)];
    }

    function createPool(address a, address b, uint24 fee) external returns (address pool) {
        bytes32 k = _key(a, b, fee);
        require(pools[k] == address(0), "exists");
        pool = address(new MockV3PoolM());
        pools[k] = pool;
    }
}

/// @notice Functional NonfungiblePositionManager: pulls both sides on mint, records amounts.
contract MockNPMM {
    address public immutable factory;
    uint256 public nextId = 1;

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

    mapping(uint256 => uint256) public mintedAmount0;
    mapping(uint256 => uint256) public mintedAmount1;
    mapping(uint256 => address) public mintedToken0;
    mapping(uint256 => address) public mintedToken1;

    event Minted(uint256 id, address token0, address token1, uint256 amt0, uint256 amt1);

    constructor(address _factory) { factory = _factory; }

    function mint(MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Pull both sides from the caller (the graduator).
        require(IERC20m(p.token0).transferFrom(msg.sender, address(this), p.amount0Desired), "t0");
        require(IERC20m(p.token1).transferFrom(msg.sender, address(this), p.amount1Desired), "t1");

        tokenId = nextId++;
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired;
        // Fake but nonzero liquidity.
        liquidity = uint128(_min(amount0, amount1));
        if (liquidity == 0) liquidity = 1;

        mintedAmount0[tokenId] = amount0;
        mintedAmount1[tokenId] = amount1;
        mintedToken0[tokenId] = p.token0;
        mintedToken1[tokenId] = p.token1;
        emit Minted(tokenId, p.token0, p.token1, amount0, amount1);
    }

    /// @dev Accept the burn transfer; no-op.
    function safeTransferFrom(address, address, uint256) external {}

    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}

/// @notice MONSHI-aware graduator stub: records what the curve transferred, no Uniswap.
contract MockGraduatorMonshi {
    address public immutable quote;
    mapping(address => uint256) public lastQuoteReceived;
    mapping(address => uint256) public lastTokensReceived;
    mapping(address => bool) public graduated;

    event MockGraduated(address indexed token, uint256 quoteIn, uint256 tokenIn);

    constructor(address _quote) { quote = _quote; }

    function onGraduate(address token, uint256 lpTokens, uint256 quoteAmount) external {
        lastQuoteReceived[token] = quoteAmount;
        lastTokensReceived[token] = lpTokens;
        graduated[token] = true;
        emit MockGraduated(token, quoteAmount, lpTokens);
    }

    function isGraduated(address token) external view returns (bool) { return graduated[token]; }
}

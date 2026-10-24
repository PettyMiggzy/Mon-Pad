// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IMonpadHookLauncher {
    function launches(address token) external view returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId);
}

/// @title MonpadV4Router
/// @notice Uniswap V4 router for Monpad pools only: payable buy, slippage, refunds on partial fills.
///         Not audited — use at your own risk.
contract MonpadV4Router is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;
    IMonpadHookLauncher public immutable launcher;
    address public immutable monpadHook;

    error Slippage();
    error NoValue();
    error TransferFailed();
    error Expired();
    error BadKey();
    error UnknownToken();
    error ExcessiveInput();

    constructor(IPoolManager poolManager_, IMonpadHookLauncher launcher_, address monpadHook_) {
        require(address(poolManager_) != address(0) && address(launcher_) != address(0) && monpadHook_ != address(0), "zero addr");
        poolManager = poolManager_;
        launcher = launcher_;
        monpadHook = monpadHook_;
    }

    receive() external payable {}

    /// @param sqrtPriceLimitX96 Pass 0 for the widest limit (full input may be consumed).
    function buyExactIn(PoolKey calldata key, uint256 minTokensOut, uint256 deadline, uint160 sqrtPriceLimitX96)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert NoValue();
        _validateKey(key);
        address token = Currency.unwrap(key.currency1);
        uint160 limit = sqrtPriceLimitX96 == 0 ? uint160(TickMath.MIN_SQRT_PRICE + 1) : sqrtPriceLimitX96;

        bytes memory out = poolManager.unlock(abi.encode(uint8(0), key, msg.value, limit));
        uint256 monConsumed;
        (tokensOut, monConsumed) = abi.decode(out, (uint256, uint256));

        if (monConsumed > msg.value) revert ExcessiveInput();
        if (tokensOut < minTokensOut) revert Slippage();

        IERC20(token).safeTransfer(msg.sender, tokensOut);

        uint256 monRefund = msg.value - monConsumed;
        if (monRefund > 0) {
            (bool ok,) = msg.sender.call{value: monRefund}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @param sqrtPriceLimitX96 Pass 0 for the widest limit.
    function sellExactIn(
        PoolKey calldata key,
        uint256 tokensIn,
        uint256 minMonOut,
        uint256 deadline,
        uint160 sqrtPriceLimitX96
    ) external nonReentrant returns (uint256 monOut) {
        if (block.timestamp > deadline) revert Expired();
        _validateKey(key);
        address token = Currency.unwrap(key.currency1);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint160 limit = sqrtPriceLimitX96 == 0 ? uint160(TickMath.MAX_SQRT_PRICE - 1) : sqrtPriceLimitX96;

        bytes memory out = poolManager.unlock(abi.encode(uint8(1), key, tokensIn, limit));
        uint256 tokensConsumed;
        (monOut, tokensConsumed) = abi.decode(out, (uint256, uint256));

        if (tokensConsumed > tokensIn) revert ExcessiveInput();
        if (monOut < minMonOut) revert Slippage();

        uint256 tokenRefund = tokensIn - tokensConsumed;
        if (tokenRefund > 0) {
            IERC20(token).safeTransfer(msg.sender, tokenRefund);
        }

        (bool ok,) = msg.sender.call{value: monOut}("");
        if (!ok) revert TransferFailed();
    }

    function _validateKey(PoolKey calldata key) internal view {
        if (Currency.unwrap(key.currency0) != address(0)) revert BadKey();
        if (address(IHooks(key.hooks)) != monpadHook) revert BadKey();
        address token = Currency.unwrap(key.currency1);
        (address creator,,,) = launcher.launches(token);
        if (creator == address(0)) revert UnknownToken();
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pm");
        (uint8 op, PoolKey memory key, uint256 amount, uint160 limit) = abi.decode(raw, (uint8, PoolKey, uint256, uint160));
        address token = Currency.unwrap(key.currency1);

        bool zeroForOne = op == 0;
        BalanceDelta s = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), ""
        );
        if (zeroForOne) {
            uint256 monOwe = uint256(uint128(-s.amount0()));
            uint256 tokensGot = uint256(uint128(s.amount1()));
            if (monOwe > amount) revert ExcessiveInput();
            poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
            poolManager.settle{value: monOwe}();
            poolManager.take(key.currency1, address(this), tokensGot);
            return abi.encode(tokensGot, monOwe);
        }
        uint256 tokenOwe = uint256(uint128(-s.amount1()));
        uint256 monGot = uint256(uint128(s.amount0()));
        if (tokenOwe > amount) revert ExcessiveInput();
        poolManager.sync(key.currency1);
        IERC20(token).safeTransfer(address(poolManager), tokenOwe);
        poolManager.settle();
        poolManager.take(CurrencyLibrary.ADDRESS_ZERO, address(this), monGot);
        return abi.encode(monGot, tokenOwe);
    }
}

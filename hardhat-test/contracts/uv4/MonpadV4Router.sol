// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title MonpadV4Router
/// @notice Minimal Uniswap V4 router for Monpad pools: one payable tx to buy, slippage on buy/sell.
///         Not audited — use at your own risk.
contract MonpadV4Router is IUnlockCallback {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable poolManager;

    error Slippage();
    error NoValue();
    error TransferFailed();

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    receive() external payable {}

    /// @notice Exact-in buy: `msg.value` is native MON spent; tokens go to `msg.sender`.
    function buyExactIn(PoolKey calldata key, uint256 minTokensOut) external payable returns (uint256 tokensOut) {
        if (msg.value == 0) revert NoValue();
        address token = Currency.unwrap(key.currency1);
        bytes memory out = poolManager.unlock(
            abi.encode(uint8(0), key, msg.value, uint160(TickMath.MIN_SQRT_PRICE + 1), msg.sender)
        );
        tokensOut = abi.decode(out, (uint256));
        if (tokensOut < minTokensOut) revert Slippage();
        IERC20(token).safeTransfer(msg.sender, tokensOut);
    }

    /// @notice Exact-in sell: pull tokens from caller, send native MON to caller.
    function sellExactIn(PoolKey calldata key, uint256 tokensIn, uint256 minMonOut) external returns (uint256 monOut) {
        address token = Currency.unwrap(key.currency1);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        bytes memory out = poolManager.unlock(
            abi.encode(uint8(1), key, tokensIn, uint160(TickMath.MAX_SQRT_PRICE - 1), msg.sender)
        );
        monOut = abi.decode(out, (uint256));
        if (monOut < minMonOut) revert Slippage();
        (bool ok,) = msg.sender.call{value: monOut}("");
        if (!ok) revert TransferFailed();
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pm");
        (uint8 op, PoolKey memory key, uint256 amount, uint160 limit, address recipient) =
            abi.decode(raw, (uint8, PoolKey, uint256, uint160, address));
        address token = Currency.unwrap(key.currency1);

        bool zeroForOne = op == 0;
        BalanceDelta s = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), ""
        );
        if (zeroForOne) {
            uint256 owe = uint256(uint128(-s.amount0()));
            uint256 got = uint256(uint128(s.amount1()));
            poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
            poolManager.settle{value: owe}();
            poolManager.take(key.currency1, address(this), got);
            return abi.encode(got);
        }
        uint256 owe = uint256(uint128(-s.amount1()));
        uint256 got = uint256(uint128(s.amount0()));
        poolManager.sync(key.currency1);
        IERC20(token).safeTransfer(address(poolManager), owe);
        poolManager.settle();
        poolManager.take(CurrencyLibrary.ADDRESS_ZERO, address(this), got);
        return abi.encode(got);
    }
}

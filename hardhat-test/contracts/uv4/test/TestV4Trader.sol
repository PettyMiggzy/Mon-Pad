// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// TEST ONLY: trades and seeds hookless liquidity against a V4 pool manager.
contract TestV4Trader is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    function buy(PoolKey memory key, uint256 nativeIn) external returns (uint256 tokensOut) {
        bytes memory out = pm.unlock(abi.encode(uint8(0), key, nativeIn, uint160(TickMath.MIN_SQRT_PRICE + 1)));
        tokensOut = abi.decode(out, (uint256));
    }

    function sell(PoolKey memory key, uint256 tokensIn) external returns (uint256 nativeOut) {
        bytes memory out = pm.unlock(abi.encode(uint8(1), key, tokensIn, uint160(TickMath.MAX_SQRT_PRICE - 1)));
        nativeOut = abi.decode(out, (uint256));
    }

    function buyWithQuote(PoolKey memory key, bool quoteIs0, uint256 quoteIn) external returns (uint256 tokensOut) {
        uint160 lim = quoteIs0 ? uint160(TickMath.MIN_SQRT_PRICE + 1) : uint160(TickMath.MAX_SQRT_PRICE - 1);
        bytes memory out = pm.unlock(abi.encode(uint8(10), key, quoteIs0, quoteIn, lim));
        tokensOut = abi.decode(out, (uint256));
    }

    function sellToQuote(PoolKey memory key, bool quoteIs0, uint256 tokensIn) external returns (uint256 quoteOut) {
        uint160 lim = quoteIs0 ? uint160(TickMath.MAX_SQRT_PRICE - 1) : uint160(TickMath.MIN_SQRT_PRICE + 1);
        bytes memory out = pm.unlock(abi.encode(uint8(11), key, quoteIs0, tokensIn, lim));
        quoteOut = abi.decode(out, (uint256));
    }

    function seed(PoolKey memory key, int24 tick, int24 lower, int24 upper, uint128 liquidity) external {
        pm.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        pm.unlock(abi.encode(uint8(2), key, lower, upper, liquidity));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        uint8 op = abi.decode(raw, (uint8));

        if (op == 2) {
            (, PoolKey memory key, int24 lower, int24 upper, uint128 liq) = abi.decode(raw, (uint8, PoolKey, int24, int24, uint128));
            address c0 = Currency.unwrap(key.currency0);
            address c1 = Currency.unwrap(key.currency1);
            (BalanceDelta d,) = pm.modifyLiquidity(
                key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}), ""
            );
            if (d.amount0() < 0) _pay(key.currency0, c0, uint256(uint128(-d.amount0())));
            if (d.amount1() < 0) _pay(key.currency1, c1, uint256(uint128(-d.amount1())));
            return "";
        }

        if (op == 10) {
            (, PoolKey memory key, bool quoteIs0, uint256 quoteIn, uint160 limit) =
                abi.decode(raw, (uint8, PoolKey, bool, uint256, uint160));
            bool zeroForOne = quoteIs0;
            BalanceDelta s = pm.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(quoteIn), sqrtPriceLimitX96: limit}), "");
            return _quoteIn(key, quoteIs0, s);
        }

        if (op == 11) {
            (, PoolKey memory key, bool quoteIs0, uint256 tokensIn, uint160 limit) =
                abi.decode(raw, (uint8, PoolKey, bool, uint256, uint160));
            bool zeroForOne = !quoteIs0;
            BalanceDelta s = pm.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(tokensIn), sqrtPriceLimitX96: limit}), "");
            return _quoteOut(key, quoteIs0, s);
        }

        (, PoolKey memory key, uint256 amount, uint160 limit) = abi.decode(raw, (uint8, PoolKey, uint256, uint160));
        bool zeroForOne = op == 0;
        BalanceDelta s = pm.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), "");
        if (zeroForOne) {
            _pay(CurrencyLibrary.ADDRESS_ZERO, address(0), uint256(uint128(-s.amount0())));
            pm.take(key.currency1, address(this), uint256(uint128(s.amount1())));
            return abi.encode(uint256(uint128(s.amount1())));
        }
        address token = Currency.unwrap(key.currency1);
        _pay(key.currency1, token, uint256(uint128(-s.amount1())));
        pm.take(CurrencyLibrary.ADDRESS_ZERO, address(this), uint256(uint128(s.amount0())));
        return abi.encode(uint256(uint128(s.amount0())));
    }

    function _quoteIn(PoolKey memory key, bool quoteIs0, BalanceDelta s) internal returns (bytes memory) {
        if (quoteIs0) {
            _pay(key.currency0, Currency.unwrap(key.currency0), uint256(uint128(-s.amount0())));
            pm.take(key.currency1, address(this), uint256(uint128(s.amount1())));
            return abi.encode(uint256(uint128(s.amount1())));
        }
        _pay(key.currency1, Currency.unwrap(key.currency1), uint256(uint128(-s.amount1())));
        pm.take(key.currency0, address(this), uint256(uint128(s.amount0())));
        return abi.encode(uint256(uint128(s.amount0())));
    }

    function _quoteOut(PoolKey memory key, bool quoteIs0, BalanceDelta s) internal returns (bytes memory) {
        if (quoteIs0) {
            address token = Currency.unwrap(key.currency1);
            _pay(key.currency1, token, uint256(uint128(-s.amount1())));
            pm.take(key.currency0, address(this), uint256(uint128(s.amount0())));
            return abi.encode(uint256(uint128(s.amount0())));
        }
        address token = Currency.unwrap(key.currency0);
        _pay(key.currency0, token, uint256(uint128(-s.amount0())));
        pm.take(key.currency1, address(this), uint256(uint128(s.amount1())));
        return abi.encode(uint256(uint128(s.amount1())));
    }

    function _pay(Currency currency, address token, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            pm.sync(CurrencyLibrary.ADDRESS_ZERO);
            pm.settle{value: amount}();
        } else {
            pm.sync(currency);
            IERC20(token).transfer(address(pm), amount);
            pm.settle();
        }
    }
}

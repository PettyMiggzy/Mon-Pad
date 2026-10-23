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

/// TEST ONLY: trades and seeds hookless liquidity against a V4 pool manager, paying from its own balances.
contract TestV4Trader is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    receive() external payable {}

    /// native -> token, exact input
    function buy(PoolKey memory key, uint256 nativeIn) external returns (uint256 tokensOut) {
        bytes memory out = pm.unlock(abi.encode(uint8(0), key, nativeIn, uint160(TickMath.MIN_SQRT_PRICE + 1), int24(0), int24(0), uint128(0)));
        tokensOut = abi.decode(out, (uint256));
    }

    /// token -> native, exact input
    function sell(PoolKey memory key, uint256 tokensIn) external returns (uint256 nativeOut) {
        bytes memory out = pm.unlock(abi.encode(uint8(1), key, tokensIn, uint160(TickMath.MAX_SQRT_PRICE - 1), int24(0), int24(0), uint128(0)));
        nativeOut = abi.decode(out, (uint256));
    }

    /// create + seed a hookless native/token pool around `tick`
    function seed(PoolKey memory key, int24 tick, int24 lower, int24 upper, uint128 liquidity) external {
        pm.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        pm.unlock(abi.encode(uint8(2), key, uint256(0), uint160(0), lower, upper, liquidity));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        (uint8 op, PoolKey memory key, uint256 amount, uint160 limit, int24 lower, int24 upper, uint128 liq) =
            abi.decode(raw, (uint8, PoolKey, uint256, uint160, int24, int24, uint128));
        address token = Currency.unwrap(key.currency1);

        if (op == 2) {
            (BalanceDelta d,) = pm.modifyLiquidity(
                key, ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liq)), salt: bytes32(0)}), ""
            );
            if (d.amount0() < 0) {
                pm.sync(CurrencyLibrary.ADDRESS_ZERO);
                pm.settle{value: uint256(uint128(-d.amount0()))}();
            }
            if (d.amount1() < 0) {
                pm.sync(key.currency1);
                IERC20(token).transfer(address(pm), uint256(uint128(-d.amount1())));
                pm.settle();
            }
            return "";
        }

        bool zeroForOne = op == 0;
        BalanceDelta s = pm.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: limit}), "");
        if (zeroForOne) {
            uint256 owe = uint256(uint128(-s.amount0()));
            uint256 got = uint256(uint128(s.amount1()));
            pm.sync(CurrencyLibrary.ADDRESS_ZERO);
            pm.settle{value: owe}();
            pm.take(key.currency1, address(this), got);
            return abi.encode(got);
        } else {
            uint256 owe = uint256(uint128(-s.amount1()));
            uint256 got = uint256(uint128(s.amount0()));
            pm.sync(key.currency1);
            IERC20(token).transfer(address(pm), owe);
            pm.settle();
            pm.take(CurrencyLibrary.ADDRESS_ZERO, address(this), got);
            return abi.encode(got);
        }
    }
}

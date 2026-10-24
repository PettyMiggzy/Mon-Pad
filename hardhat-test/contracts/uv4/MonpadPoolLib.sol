// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @dev Helpers for USDC-quoted Monpad pools (sorted currencies, swap direction).
library MonpadPoolLib {
    using CurrencyLibrary for Currency;

    int24 public constant TICK_SPACING = 200;

    struct SortedKey {
        PoolKey key;
        bool quoteIs0;
        address token;
    }

    function buildMonpadKey(address quote, address token, address hook) internal pure returns (SortedKey memory s) {
        require(quote != address(0) && token != address(0) && quote != token, "bad pair");
        address c0;
        address c1;
        if (quote < token) {
            c0 = quote;
            c1 = token;
            s.quoteIs0 = true;
        } else {
            c0 = token;
            c1 = quote;
            s.quoteIs0 = false;
        }
        s.token = token;
        s.key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    /// @dev Exact-input swap: quote (USDC) -> launch token.
    function quoteInZeroForOne(SortedKey memory s) internal pure returns (bool) {
        return s.quoteIs0;
    }

    /// @dev Exact-input swap: launch token -> quote (USDC).
    function tokenInZeroForOne(SortedKey memory s) internal pure returns (bool) {
        return !s.quoteIs0;
    }
}

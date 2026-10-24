// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "../interfaces/IUniswap.sol";

/// TEST ONLY: swaps against a pool directly, paying from its own balance.
contract TestTrader {
    address private _pool;

    function swap(address pool, bool zeroForOne, uint256 amountIn, uint160 limit, address to)
        external
        returns (int256 a0, int256 a1)
    {
        _pool = pool;
        (a0, a1) = IUniswapV3Pool(pool).swap(to, zeroForOne, int256(amountIn), limit, "");
        _pool = address(0);
    }

    function uniswapV3SwapCallback(int256 d0, int256 d1, bytes calldata) external {
        require(msg.sender == _pool, "pool");
        if (d0 > 0) IERC20(IUniswapV3Pool(msg.sender).token0()).transfer(msg.sender, uint256(d0));
        if (d1 > 0) IERC20(IUniswapV3Pool(msg.sender).token1()).transfer(msg.sender, uint256(d1));
    }

    receive() external payable {}
}

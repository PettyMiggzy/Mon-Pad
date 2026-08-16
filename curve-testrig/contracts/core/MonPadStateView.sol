// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @title MonPadStateView
/// @notice Read-only `extsload` wrapper bound to OUR PoolManager (0x188d…ea8e on Monad).
/// @dev [MONAD] Production does NOT need this contract. Monad already has a canonical Uniswap StateView deployed
/// at 0x77395f3b2e73ae90843717371294fa97cc419d64, so the factory and curve should be pointed at that. It is kept
/// only so the local Hardhat suite (which spins up its own PoolManager) has a StateView to bind to.
/// No StateView on-chain pairs with that manager, so we deploy our own. Pure lens — zero trust
/// surface, no state, no owner. Used by the floor vault, the curve and the ambush vault to read slot0 and
/// position state, and by the indexer. [M-6] The old reference to `totalAssets` was left over from an
/// ERC-4626 floor-vault design that was never built — no such function exists anywhere in contracts/.
contract MonPadStateView is StateView {
    constructor(IPoolManager _poolManager) StateView(_poolManager) {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

interface IMonpadLauncherConfig {
    function quoteAsset() external view returns (address);
}

/// @title MonpadHook
/// @notice Uniswap V4 hook that makes every Monpad pool charge the fee its launch chose: 1% plus the
///         creator's tax. The fee is set inside the pool on every swap, from any router, so it cannot be skipped
///         by trading through a different front end. It also keeps a slow reference price used to guard buybacks.
///
///         Hook address flags (must be mined into the CREATE2 address): BEFORE_INITIALIZE (1<<13) | BEFORE_SWAP (1<<7) = 0x2080.
contract MonpadHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint32 public constant REF_INTERVAL = 600; // the reference tick is re-sampled at most every 10 minutes

    IPoolManager public immutable poolManager;
    address public immutable launcher;

    struct Ref {
        int24 tick;
        uint40 ts;
    }

    mapping(PoolId => uint24) public feeUnits; // total swap fee in hundredths of a basis point (1_000_000 = 100%)
    mapping(PoolId => Ref) public ref; // tick sampled BEFORE a swap, so a same-transaction manipulation can't poison it

    error NotPoolManager();
    error NotLauncher();
    error NotConfigured();
    error AlreadyConfigured();
    error BadFee();
    error BadKey();

    event PoolConfigured(PoolId indexed id, uint24 feeUnits);

    constructor(IPoolManager poolManager_, address launcher_) {
        poolManager = poolManager_;
        launcher = launcher_;
    }

    /// @notice The launcher registers the fee for a pool key before initialising it.
    function configure(PoolKey calldata key, uint24 fee) external {
        if (msg.sender != launcher) revert NotLauncher();
        if (fee == 0 || fee > LPFeeLibrary.MAX_LP_FEE) revert BadFee();
        PoolId id = key.toId();
        if (feeUnits[id] != 0) revert AlreadyConfigured();
        feeUnits[id] = fee;
        emit PoolConfigured(id, fee);
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external view returns (bytes4) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (sender != launcher) revert NotLauncher(); // nobody else can create a pool that uses this hook
        if (feeUnits[key.toId()] == 0) revert NotConfigured();
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert BadKey();
        address quote = IMonpadLauncherConfig(launcher).quoteAsset();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 != quote && c1 != quote) revert BadKey();
        address token = c0 == quote ? c1 : c0;
        if (token == address(0) || token == quote) revert BadKey();
        return this.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolId id = key.toId();
        Ref memory r = ref[id];
        if (r.ts == 0 || block.timestamp >= uint256(r.ts) + REF_INTERVAL) {
            (, int24 tick,,) = poolManager.getSlot0(id);
            ref[id] = Ref({tick: tick, ts: uint40(block.timestamp)});
        }
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeUnits[id] | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }
}

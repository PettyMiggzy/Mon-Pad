// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeterministicDeployer} from "./DeterministicDeployer.sol";
import {MonPadLockStaking} from "../pads/MonPadLockStaking.sol";

/// @title StakingDeployer
/// @notice Holds `MonPadLockStaking`'s creationCode so `MonPadFactoryV4` doesn't have to — the same offloading
/// pattern `CurveV4Deployer` uses for the curve. Deploy is permissionless and safe: the CREATE2 address is bound
/// to the exact ctor args, the shared DeterministicDeployer idempotently ADOPTS a byte-identical pre-deploy, and
/// a pool only ever receives the graduation reservoir if the CURVE was wired to it — which only the factory does,
/// and only once, and only after checking the pool's stake asset matches the pad token.
contract StakingDeployer {
    DeterministicDeployer public immutable deployer;

    constructor(address deployer_) {
        deployer = DeterministicDeployer(deployer_);
    }

    /// @param ctorArgs abi.encode(token, lockDuration, rewardsDuration)
    function deploy(bytes32 salt, bytes calldata ctorArgs) external returns (address staking) {
        staking = deployer.deploy(salt, abi.encodePacked(type(MonPadLockStaking).creationCode, ctorArgs));
    }
}

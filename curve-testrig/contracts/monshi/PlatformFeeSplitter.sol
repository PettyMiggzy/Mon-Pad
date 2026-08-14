// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title PlatformFeeSplitter — routes a slice of MonPad platform revenue into MONSHI buybacks
/// @notice Sits where the platform fee wallet would: set this as `FeeWalletRegistry.platformFeeWallet` and every
/// platform payout in the suite (hook buy tax, curve LP fees, the graduation platform cut) lands here. A
/// permissionless `distribute()` then forwards `buybackBps` to the MONSHI buyback and the remainder to the
/// platform treasury.
///
/// @dev Two properties this contract exists to guarantee:
///
/// 1. `receive()` CANNOT REVERT. The curve and hook pay the platform with a raw `call`, and a recipient that
///    reverts would make `claimPlatform()` fail — turning a routing preference into a liveness bug on the
///    platform's own revenue. So receiving is a bare accumulate; all the logic lives in `distribute()`, which
///    anyone may call and which failing hurts nobody.
///
/// 2. NEITHER LEG CAN BLOCK THE OTHER. A treasury that cannot receive (or a buyback that reverts) must not trap
///    the other side's money, so each leg is booked and sent independently, and a failed send re-parks into its
///    own book for a later retry rather than reverting the whole distribution. This is the same accrue-and-pull
///    discipline the audited curve uses for exactly this reason.
///
/// The split is owner-tunable within a hard cap because it governs only where the PLATFORM's own revenue goes —
/// it can never touch creator, trader or LP funds, none of which pass through here.
contract PlatformFeeSplitter is Ownable2Step, ReentrancyGuard {
    uint16 public constant BPS = 10000;
    /// @notice At most half of platform revenue may be diverted to buybacks — the platform still has a business.
    uint16 public constant MAX_BUYBACK_BPS = 5000;

    address public immutable buyback;
    address public treasury;
    uint16 public buybackBps;

    /// @notice Owed-but-unsent, per leg. Only ever non-zero when a send failed.
    uint256 public buybackOwed;
    uint256 public treasuryOwed;

    uint256 public totalToBuyback;
    uint256 public totalToTreasury;

    event Received(address indexed from, uint256 amount);
    event Distributed(uint256 toBuyback, uint256 toTreasury);
    event SendFailed(address indexed leg, uint256 amount);
    event BuybackBpsSet(uint16 bps);
    event TreasurySet(address indexed treasury);

    error ZeroAddress();
    error BadBps();
    error NothingToDistribute();

    constructor(address buyback_, address treasury_, address owner_, uint16 buybackBps_) Ownable(owner_) {
        if (buyback_ == address(0) || treasury_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (buybackBps_ > MAX_BUYBACK_BPS) revert BadBps();
        buyback = buyback_;
        treasury = treasury_;
        buybackBps = buybackBps_;
    }

    /// @dev Bare accumulate — see property (1) above. Never add logic that can revert here.
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice Split everything undistributed, then retry any previously-failed leg. Permissionless.
    function distribute() external nonReentrant {
        uint256 owed = buybackOwed + treasuryOwed;
        uint256 fresh = address(this).balance - owed;
        if (fresh == 0 && owed == 0) revert NothingToDistribute();

        // subtraction conserves dust into the treasury leg
        uint256 toBuyback = (fresh * buybackBps) / BPS;
        uint256 toTreasury = fresh - toBuyback;

        uint256 payBuyback = buybackOwed + toBuyback;
        uint256 payTreasury = treasuryOwed + toTreasury;
        buybackOwed = 0;
        treasuryOwed = 0;
        totalToBuyback += toBuyback;
        totalToTreasury += toTreasury;

        if (payBuyback > 0) {
            (bool ok,) = payable(buyback).call{value: payBuyback}("");
            if (!ok) {
                buybackOwed = payBuyback;
                emit SendFailed(buyback, payBuyback);
            }
        }
        if (payTreasury > 0) {
            (bool ok,) = payable(treasury).call{value: payTreasury}("");
            if (!ok) {
                treasuryOwed = payTreasury;
                emit SendFailed(treasury, payTreasury);
            }
        }
        emit Distributed(toBuyback, toTreasury);
    }

    function setBuybackBps(uint16 bps) external onlyOwner {
        if (bps > MAX_BUYBACK_BPS) revert BadBps();
        buybackBps = bps;
        emit BuybackBpsSet(bps);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The slice of nad.fun's DEX router this contract calls. MONSHI has already graduated off the nad.fun
/// bonding curve and trades in a Uniswap-V3-style pool (fee 1%, tickSpacing 200, factory
/// 0x6B5F564339DbAD6b780249827f2198a841FEB7F3), so the DEX router is the correct venue — NOT the bonding-curve
/// router. Verified live: a 1 MON call returns ~1,870 MONSHI with `to` set to the burn address.
///
/// The router reverts `InvalidAmountOut()` (0x4e969c58) when amountOutMin is zero, and `InsufficientOutput()`
/// (0xbb2875c3) when the swap cannot meet it — so slippage is enforced by the venue as well as by us.
interface INadDexRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    function buy(BuyParams calldata params) external payable returns (uint256 amountOut);
}

/// @title MonshiBuyback — turns MonPad platform revenue into permanent MONSHI buy pressure
/// @notice Accepts native MON from anywhere (the platform fee splitter, a manual top-up, a donation) and spends
/// it buying MONSHI on nad.fun's DEX, delivered STRAIGHT TO THE BURN ADDRESS. The router's `to` parameter is the
/// dead address, so the bought MONSHI never touches this contract — there is no path by which it can be
/// redirected, and no MONSHI balance here for anyone to claim.
///
/// @dev DESIGN NOTE — why the buy is keeper-gated rather than permissionless.
///
/// Every other permissionless entry point in this suite is safe because it moves money along a path fixed at
/// deploy time. A buyback is different: it needs a PRICE, and whoever supplies `minOut` decides how much
/// slippage is tolerated. A fully permissionless `buyback(minOut)` lets any caller pass a loose bound and
/// sandwich the trade. Deriving the bound on-chain from the pool's live `slot0` instead is exactly the mistake
/// the floor-vault redesign refuted four times over: a flash-manipulated spot is attacker-controllable within
/// one transaction, so a spot-derived bound is no bound at all.
///
/// The resolution here is that this is the platform spending ITS OWN revenue on ITS OWN token — no user
/// principal is ever at risk, and no third party is entitled to trigger it. So the trade is gated to a keeper
/// that computes `minOut` off-chain against a real quote, which is both safer and simpler than any on-chain
/// price oracle would be. `maxSpendPerCall` and `cooldown` bound the damage from a compromised keeper: it can
/// waste at most one capped slice per cooldown, and it can never withdraw — there is no path out of this
/// contract except a MONSHI buy that burns.
contract MonshiBuyback is Ownable2Step, ReentrancyGuard {
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable monshi;
    INadDexRouter public immutable router;

    address public keeper;
    uint256 public maxSpendPerCall;
    uint256 public cooldown;
    uint256 public lastBuyAt;

    uint256 public totalMonSpent;
    uint256 public totalMonshiBurned;
    uint256 public buyCount;

    event Funded(address indexed from, uint256 amount);
    event BoughtAndBurned(address indexed keeper, uint256 monIn, uint256 monshiBurned);
    event KeeperSet(address indexed keeper);
    event LimitsSet(uint256 maxSpendPerCall, uint256 cooldown);

    error NotKeeper();
    error NothingToSpend();
    error CoolingDown();
    error ZeroAddress();
    error BadLimit();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(address monshi_, address router_, address owner_, uint256 maxSpendPerCall_, uint256 cooldown_) Ownable(owner_) {
        if (monshi_ == address(0) || router_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (maxSpendPerCall_ == 0) revert BadLimit();
        monshi = IERC20(monshi_);
        router = INadDexRouter(router_);
        maxSpendPerCall = maxSpendPerCall_;
        cooldown = cooldown_;
    }

    /// @notice Accept MON from any source. Deliberately does nothing else: this is wired as the downstream of the
    /// platform fee splitter, and a `receive()` that can revert would block the platform's own claim path.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Spend up to `maxSpendPerCall` of the MON held here buying MONSHI, burned on delivery.
    /// @param minOut Minimum MONSHI out, computed off-chain against a live quote. The router rejects zero.
    /// @dev Spends `min(balance, maxSpendPerCall)`, so a keeper cannot drain a large balance in one trade even if
    /// `minOut` is set carelessly. CEI: the cooldown stamp and the spend are committed before the external call.
    function buyback(uint256 minOut) external onlyKeeper nonReentrant returns (uint256 burned) {
        if (block.timestamp < lastBuyAt + cooldown) revert CoolingDown();
        uint256 spend = address(this).balance;
        if (spend == 0) revert NothingToSpend();
        if (spend > maxSpendPerCall) spend = maxSpendPerCall;

        lastBuyAt = block.timestamp;
        totalMonSpent += spend;
        unchecked {
            ++buyCount;
        }

        burned = router.buy{value: spend}(
            INadDexRouter.BuyParams({
                amountOutMin: minOut,
                token: address(monshi),
                to: BURN_ADDRESS, // never held here — bought straight into the burn address
                deadline: block.timestamp
            })
        );
        totalMonshiBurned += burned;
        emit BoughtAndBurned(msg.sender, spend, burned);
    }

    /// @notice The address allowed to trigger buybacks. The owner can always trigger one directly.
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Bound how much a single buyback may spend, and how often one may run.
    function setLimits(uint256 maxSpendPerCall_, uint256 cooldown_) external onlyOwner {
        if (maxSpendPerCall_ == 0) revert BadLimit();
        maxSpendPerCall = maxSpendPerCall_;
        cooldown = cooldown_;
        emit LimitsSet(maxSpendPerCall_, cooldown_);
    }

    /// @notice MON sitting here waiting to be spent.
    function pending() external view returns (uint256) {
        return address(this).balance;
    }
}

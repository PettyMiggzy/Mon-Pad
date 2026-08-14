// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The slice of nad.fun's DEX router this contract calls. MONSHI has already graduated off the nad.fun
/// bonding curve and trades in a Uniswap-V3-style pool (fee 1%, tickSpacing 200, factory
/// 0x6B5F564339DbAD6b780249827f2198a841FEB7F3), so the DEX router is the correct venue — NOT the bonding-curve
/// router. Verified live: a 1 MON call returns ~1,870 MONSHI with `to` set to the burn address.
///
/// The router reverts `InvalidAmountOut()` (0x4e969c58) when amountOutMin is zero, and `InsufficientOutput()`
/// (0xbb2875c3) when the swap cannot meet it — so slippage is enforced by the venue as well as by us.
/// @notice The staking pool's funding hook — `MonPadLockStaking.fundTokenPushed`. Permissionless and
/// idempotent: transfer the tokens in, then call it and the delta is credited as a reward tranche.
interface IMonshiStakingFund {
    function fundTokenPushed(uint8 side, address asset) external returns (uint256);
}

/// @notice Stake-asset probe, so the staking share can only ever be pointed at a MONSHI pool.
interface IMonshiStakeAssetProbe {
    function token() external view returns (address);
}

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
/// it buying MONSHI on nad.fun's DEX. The bought MONSHI is split THREE WAYS in the same transaction:
///
///   • `treasuryBps`  → the treasury wallet          (default 40%)
///   • `stakingBps`   → MONSHI stakers, as rewards   (default 30%)
///   • the remainder  → burned to 0x…dEaD            (default 30%)
///
/// The staking leg is what turns a buyback into a HOLD incentive. A burn is one-off flow — it spends the money
/// once and the pressure is gone. Rewarding stakers gives holders a standing reason to buy MONSHI and keep it
/// staked, which removes float rather than just cycling it, and the pool's own early-exit penalty recycles back
/// to whoever stays. At a small market cap, removing float matters more than adding flow.
///
/// Treasury + staking together are capped at MAX_DIVERTED_BPS (70%), so AT LEAST 30% OF EVERY BUY BURNS and the
/// owner cannot govern that away. "Platform fees buy and burn MONSHI" is a promise to the MONSHI community; a
/// burn that could be set to zero would not be one. Stakers are not the platform — that leg goes to holders —
/// but it is capped jointly all the same, because the burn is the part that has to stay credible.
///
/// MONSHI is held only for the length of one call. Both exit paths — `buyback` and `sweepStrandedMonshi` —
/// settle through the same `_split`, so there is no route by which MONSHI leaves on other terms. If the staking
/// pool is unset, its share burns rather than stranding.
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
/// waste at most one capped slice per cooldown, and it can never redirect the proceeds — the only paths out of
/// this contract are a MONSHI buy that splits on capped, pre-set terms.
contract MonshiBuyback is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint16 public constant BPS = 10000;
    /// @notice At most half the bought MONSHI may be routed to the treasury.
    uint16 public constant MAX_TREASURY_BPS = 5000;
    /// @notice Treasury + stakers together may never exceed 70%, so AT LEAST 30% OF EVERY BUY BURNS.
    /// @dev This cap is the point of the contract. "Platform fees buy and burn MONSHI" is a promise made to the
    /// MONSHI community, and shares that could be raised to 100% would quietly turn the burn into a revenue
    /// stream. Capping on-chain makes the claim checkable by anyone rather than trusted. Note stakers are NOT
    /// the same as treasury — the staking share goes to holders, not the platform — but it is still capped
    /// jointly, because a burn that can be governed to zero is not a burn.
    uint16 public constant MAX_DIVERTED_BPS = 7000;

    IERC20 public immutable monshi;
    INadDexRouter public immutable router;

    address public keeper;
    address public treasury;
    address public staking; // MonPadLockStaking over MONSHI — stake MONSHI, earn MONSHI
    uint16 public treasuryBps;
    uint16 public stakingBps;
    uint256 public maxSpendPerCall;
    uint256 public cooldown;
    uint256 public lastBuyAt;

    uint256 public totalMonSpent;
    uint256 public totalMonshiBurned;
    uint256 public totalMonshiToTreasury;
    uint256 public totalMonshiToStakers;
    uint256 public buyCount;

    event Funded(address indexed from, uint256 amount);
    event BoughtAndSplit(address indexed keeper, uint256 monIn, uint256 monshiOut, uint256 burned, uint256 toTreasury, uint256 toStakers);
    event KeeperSet(address indexed keeper);
    event TreasurySet(address indexed treasury, uint16 bps);
    event StakingSet(address indexed staking, uint16 bps);
    event LimitsSet(uint256 maxSpendPerCall, uint256 cooldown);

    error NotKeeper();
    error NothingToSpend();
    error CoolingDown();
    error ZeroAddress();
    error BadLimit();
    error BadBps();
    error NoOutput();
    error StakeAssetMismatch();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(
        address monshi_,
        address router_,
        address owner_,
        address treasury_,
        uint16 treasuryBps_,
        uint16 stakingBps_,
        uint256 maxSpendPerCall_,
        uint256 cooldown_
    ) Ownable(owner_) {
        if (monshi_ == address(0) || router_ == address(0) || owner_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxSpendPerCall_ == 0) revert BadLimit();
        if (treasuryBps_ > MAX_TREASURY_BPS) revert BadBps();
        if (uint256(treasuryBps_) + stakingBps_ > MAX_DIVERTED_BPS) revert BadBps();
        monshi = IERC20(monshi_);
        router = INadDexRouter(router_);
        treasury = treasury_;
        treasuryBps = treasuryBps_;
        stakingBps = stakingBps_;
        maxSpendPerCall = maxSpendPerCall_;
        cooldown = cooldown_;
    }

    /// @notice Accept MON from any source. Deliberately does nothing else: this is wired as the downstream of the
    /// platform fee splitter, and a `receive()` that can revert would block the platform's own claim path.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Spend up to `maxSpendPerCall` of the MON held here buying MONSHI, then split the proceeds:
    /// `treasuryBps` to the treasury wallet, the remainder burned. Both legs settle in the same transaction.
    /// @param minOut Minimum MONSHI out, computed off-chain against a live quote. The router rejects zero.
    /// @dev Spends `min(balance, maxSpendPerCall)`, so a keeper cannot drain a large balance in one trade even if
    /// `minOut` is set carelessly. CEI: the cooldown stamp and the spend are committed before the external call.
    ///
    /// The split is measured from this contract's OWN balance delta rather than the router's return value, so a
    /// router that over-reports (or a token with transfer-side behaviour) can never cause us to send out more
    /// MONSHI than actually arrived. The burn leg takes the remainder by subtraction, so rounding dust burns
    /// rather than accruing to the treasury.
    function buyback(uint256 minOut) external onlyKeeper nonReentrant returns (uint256 burned, uint256 toTreasury) {
        if (block.timestamp < lastBuyAt + cooldown) revert CoolingDown();
        uint256 spend = address(this).balance;
        if (spend == 0) revert NothingToSpend();
        if (spend > maxSpendPerCall) spend = maxSpendPerCall;

        lastBuyAt = block.timestamp;
        totalMonSpent += spend;
        unchecked {
            ++buyCount;
        }

        uint256 before = monshi.balanceOf(address(this));
        router.buy{value: spend}(
            INadDexRouter.BuyParams({
                amountOutMin: minOut,
                token: address(monshi),
                to: address(this), // held only for the length of this call, then split
                deadline: block.timestamp
            })
        );
        uint256 got = monshi.balanceOf(address(this)) - before;
        if (got == 0) revert NoOutput();
        (burned, toTreasury) = _split(got, spend);
    }

    /// @dev Three-way settle: treasury / MONSHI stakers / burn. The burn leg is the REMAINDER, so rounding dust
    /// burns rather than accruing to a beneficiary, and if the staking pool is unset its share burns too — the
    /// contract can never hold MONSHI it has no route for.
    function _split(uint256 amount, uint256 monIn) internal returns (uint256 burned, uint256 toTreasury) {
        toTreasury = (amount * treasuryBps) / BPS;
        uint256 toStakers = (amount * stakingBps) / BPS;
        address sink = staking;
        if (sink == address(0)) toStakers = 0; // unset ⇒ that share burns instead of stranding

        burned = amount - toTreasury - toStakers; // remainder ⇒ dust burns
        if (toTreasury > 0) monshi.safeTransfer(treasury, toTreasury);
        if (toStakers > 0) {
            monshi.safeTransfer(sink, toStakers);
            // Credit the pushed tokens as a reward tranche. Wrapped: fundTokenPushed is permissionless and
            // idempotent, so if it reverts the MONSHI is already in the pool and the NEXT push (or anyone's
            // call) credits it. A misbehaving sink must not brick the buyback.
            try IMonshiStakingFund(sink).fundTokenPushed(0, address(monshi)) {} catch {}
        }
        if (burned > 0) monshi.safeTransfer(BURN_ADDRESS, burned);

        totalMonshiBurned += burned;
        totalMonshiToTreasury += toTreasury;
        totalMonshiToStakers += toStakers;
        emit BoughtAndSplit(msg.sender, monIn, amount, burned, toTreasury, toStakers);
    }

    /// @notice Split any MONSHI that reached this contract outside a buyback (a stray transfer, or a leftover
    /// from a reverted split) on the same fixed terms. Permissionless — it cannot choose a destination, so
    /// there is nothing to gain by calling it and nothing to lose by anyone being able to.
    /// @dev This is the ONLY other way MONSHI leaves, and it obeys the same capped split, so the invariant
    /// "MONSHI can only ever leave via the treasury/burn split" holds for every path.
    function sweepStrandedMonshi() external nonReentrant returns (uint256 burned, uint256 toTreasury) {
        uint256 bal = monshi.balanceOf(address(this));
        if (bal == 0) revert NoOutput();
        (burned, toTreasury) = _split(bal, 0);
    }

    /// @notice Point the staking share at a MONSHI staking pool. Repointable (unlike the pad curves' one-shot
    /// wiring) because this is the platform's own revenue routing, not a per-pad guarantee to a token's holders.
    /// @dev The pool's stake asset MUST be MONSHI — the same `token()` probe the pad curves use, so the staking
    /// share can never be pushed into a pool that would silently accept it and credit nothing.
    function setStaking(address s, uint16 bps) external onlyOwner {
        if (s != address(0)) {
            if (s.code.length == 0) revert ZeroAddress();
            if (IMonshiStakeAssetProbe(s).token() != address(monshi)) revert StakeAssetMismatch();
        }
        if (uint256(treasuryBps) + bps > MAX_DIVERTED_BPS) revert BadBps();
        staking = s;
        stakingBps = bps;
        emit StakingSet(s, bps);
    }

    /// @notice Where the treasury share goes, and how big it is. Capped at MAX_TREASURY_BPS.
    function setTreasury(address t, uint16 bps) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        if (bps > MAX_TREASURY_BPS) revert BadBps();
        if (uint256(bps) + stakingBps > MAX_DIVERTED_BPS) revert BadBps();
        treasury = t;
        treasuryBps = bps;
        emit TreasurySet(t, bps);
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

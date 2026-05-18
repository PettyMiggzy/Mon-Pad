// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonPadStakingPool — V2.1 (per-token staking pool with weighted tiers, pull-from-Hub rewards)
/// @notice One pool per graduated token. Stakers earn MON rewards distributed by the StakingHub.
/// @dev OZ-free. Inlines minimal ReentrancyGuard. Uses parameterized custom errors.

// ───────────────────────────── ReentrancyGuard (inlined) ─────────────────────────────
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    error Reentrant();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert Reentrant();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// ───────────────────────────── Interfaces ─────────────────────────────
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function totalSupply() external view returns (uint256);
}

/// @notice Hub interface. NOTE: both functions take a TOKEN address (not a pool address).
///         Hub looks up `tokenToPool[token]` and gates msg.sender against the result.
///         An earlier revision of this file had the param named `pool` and the call sites
///         passing `address(this)`, which made every claim revert PoolNotRegistered.
///         Always pass `address(token)` from this contract.
interface IHub {
    function claimReward(address token) external;
    function pendingReward(address token) external view returns (uint256);
}

/// @notice V2.1-10: Pool reads treasuryWallet live from factory rather than caching an
///         immutable copy at construction. This lets Factory.treasuryWallet rotation
///         (24h timelocked on the factory side) propagate to all pools automatically.
interface IFactoryRO_Pool {
    function treasuryWallet() external view returns (address);
}

// ───────────────────────────── MonPadStakingPool ─────────────────────────────
/// @dev EIP-1167 minimal-proxy design: this contract is deployed ONCE as an implementation
///      by MonPadPoolFactory. Each pool launch is a clone initialized via initialize().
///      Cloning costs ~50K gas vs ~3M for `new MonPadStakingPool` and is what kept the
///      pool factory under EIP-170's 24,576-byte deployed-code limit.
contract MonPadStakingPool is ReentrancyGuard {
    // ─── Wiring (was immutable; moved to storage so clones can populate via initialize) ───
    IERC20  public token;
    address public hub;
    address public monshiToken;
    /// @notice V2.1-10: factory address (NOT treasuryWallet). Pool resolves treasuryWallet
    ///         live from factoryRO.treasuryWallet() at claim time so factory-side rotation
    ///         propagates without per-pool migration.
    address public factoryRO;
    /// @notice V2.1-10: single uint accumulator (was a mapping keyed by the now-removed
    ///         immutable treasuryWallet). All paid stake fees pile up here; whoever is
    ///         the current factory.treasuryWallet at claim time pulls the lot.
    uint256 public treasuryPending;
    bool    public burnsToCreator;
    /// @dev Init guard. True on impl (set in constructor); clones start false, factory sets true via initialize.
    bool    private _initialized;

    // ─── Roles ───
    address public owner;
    address public pendingOwner;
    address public creator;

    // ─── Tier configuration ───
    struct Tier {
        uint64  duration;   // lock seconds
        uint64  multiplierBps; // 10_000 = 1.0x
        uint64  earlyFeeBps;   // basis points charged on early unstake principal
        bool    enabled;
    }
    Tier[] public tiers;

    // ─── Stake records ───
    struct Stake {
        uint128 amount;        // raw token amount
        uint128 weighted;      // amount * multiplierBps / 10_000
        uint64  startTs;
        uint64  unlockTs;
        uint64  tierId;
        uint64  flags;         // reserved
        bool    paidFee;       // false = Monshi-gated free stake (subject to 2M-MONSHI dropout penalty); true = paid creation fee path
        uint256 rewardDebt;    // weighted * rewardPerWeightedStored at last update / 1e18
    }
    mapping(address => Stake[]) public stakes;

    // ─── Reward accounting ───
    uint256 public rewardPerWeightedStored;   // scaled by 1e18
    uint256 public lastRewardBalance;          // C15: tracks address(this).balance accounted for
    uint256 public totalWeightedStaked;
    uint256 public totalRawStaked;             // B7: actual tracking (was stub)

    // ─── Limits ───
    uint256 public constant MAX_STAKES_PER_USER = 50;  // C2/C12
    uint256 public constant SCALE = 1e18;
    uint256 public constant MONSHI_GATE_AMOUNT = 2_000_000 ether; // 2M MONSHI threshold for free-tier eligibility
    uint256 public constant STAKE_FEE          = 100 ether;       // paid-fee path: 100 MON per stake
    uint64  public constant DROPOUT_PENALTY_BPS = 2000;          // 20% penalty if free-tier staker drops below gate at unstake

    // ─── Burn vault (early-unstake fees waiting for creator flush) ───
    uint256 public burnVault;

    // ─── Timelock ───
    uint256 public constant TIMELOCK_DELAY = 24 hours;
    struct Pending {
        bytes32 selector;
        bytes   data;
        uint64  eta;
        bool    exists;
    }
    mapping(bytes32 => Pending) public pendingOps;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ─── Pause ───
    bool public paused;

    // ─── Events ───
    event RewardAccrued(uint256 amount, uint256 newRewardPerWeighted);
    event Staked(address indexed user, uint256 indexed stakeId, uint256 amount, uint256 weighted, uint64 unlockTs, uint64 tierId, bool paidFee);
    event Unstaked(address indexed user, uint256 indexed stakeId, uint256 returned, uint256 fee, bool early, bool dropoutPenalty);
    event Claimed(address indexed user, uint256 amount);
    event Burned(uint256 amount, address to);
    event TierSet(uint256 indexed tierId, uint64 duration, uint64 multBps, uint64 earlyFeeBps, bool enabled);
    event CreatorChanged(address indexed prev, address indexed next);
    event EarlyFeeChanged(uint256 indexed tierId, uint64 oldBps, uint64 newBps);
    event OwnershipTransferStarted(address indexed prev, address indexed pending);
    event OwnershipTransferred(address indexed prev, address indexed next);
    event PausedSet(bool paused);
    event OpQueued(bytes32 indexed id, bytes32 selector, uint64 eta);
    event OpExecuted(bytes32 indexed id);
    event OpCancelled(bytes32 indexed id);
    event PulledFromHub(uint256 amount);
    event StakeFeeAccrued(address indexed staker, uint256 amount);
    event TreasuryClaimed(address indexed wallet, uint256 amount);
    event AdminEmergencyUnstaked(address indexed user, uint256 indexed stakeId, uint256 principal);

    // ─── Errors ───
    error NotOwner(address caller);
    error NotCreator(address caller);
    error NotPendingOwner(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error InvalidTier(uint256 tierId);
    error TierDisabled(uint256 tierId);
    error MaxStakesReached(uint256 cap);
    error StakeNotFound(uint256 stakeId);
    error TransferFailed();
    error TokenTransferFailed();
    error Paused();
    error OpNotReady(bytes32 id, uint64 eta);
    error OpUnknown(bytes32 id);
    error OpExists(bytes32 id);
    error InvalidBps(uint256 bps);
    error InvalidDuration(uint256 d);
    error NotMonshiHolder(uint256 balance, uint256 required);
    error FeeTooSmall(uint256 sent, uint256 required);
    error UnexpectedValue();
    error NotTreasury();
    error OwnershipCannotBeRenounced();
    error NotPaused();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(msg.sender); _; }
    modifier onlyCreator() { if (msg.sender != creator) revert NotCreator(msg.sender); _; }
    modifier whenNotPaused() { if (paused) revert Paused(); _; }
    modifier whenPaused()    { if (!paused) revert NotPaused(); _; }

    // ────────────────── Constructor / Initialize ──────────────────
    /// @notice Locks the implementation. Clones start with _initialized=false and are
    ///         initialized atomically by MonPadPoolFactory in createPool / adminCreatePool.
    constructor() {
        _initialized = true;
    }

    /// @notice Per-clone initializer. Same args as the old constructor. PoolFactory calls
    ///         this immediately after Clones.clone(impl) in the same tx, so any revert
    ///         here also unwinds the clone deployment.
    function initialize(
        address _token,
        address _hub,
        address _monshiToken,
        address _creator,
        bool    _burnsToCreator,
        address _owner,
        address _factory
    ) external {
        require(!_initialized, "init");
        if (_token == address(0) || _hub == address(0) || _monshiToken == address(0) || _creator == address(0) || _owner == address(0) || _factory == address(0)) revert ZeroAddress();
        _initialized = true;

        token          = IERC20(_token);
        hub            = _hub;
        monshiToken    = _monshiToken;
        creator        = _creator;
        burnsToCreator = _burnsToCreator;
        owner          = _owner;
        factoryRO      = _factory;

        // V2.1 tier seed: 30/90/180/365-day with 1.0/1.5/2.5/4.0x multipliers, all 10% early fee.
        tiers.push(Tier({duration: 30  days, multiplierBps: 10_000, earlyFeeBps: 1000, enabled: true}));
        tiers.push(Tier({duration: 90  days, multiplierBps: 15_000, earlyFeeBps: 1000, enabled: true}));
        tiers.push(Tier({duration: 180 days, multiplierBps: 25_000, earlyFeeBps: 1000, enabled: true}));
        tiers.push(Tier({duration: 365 days, multiplierBps: 40_000, earlyFeeBps: 1000, enabled: true}));
        emit TierSet(0, 30  days, 10_000, 1000, true);
        emit TierSet(1, 90  days, 15_000, 1000, true);
        emit TierSet(2, 180 days, 25_000, 1000, true);
        emit TierSet(3, 365 days, 40_000, 1000, true);
    }

    // ────────────────── Reward accounting ──────────────────
    /// @notice Pull any pending MON rewards owed by the Hub. Permissionless (C4).
    /// @dev Calls IHub.claimReward(address(token)). Hub keys pendingReward by token address
    ///      (NOT pool address) — passing address(this) would silently fail PoolNotRegistered
    ///      and strand all rewards in the Hub forever. Tested in v21-flow.js end-to-end claim.
    function pullFromHub() external nonReentrant {
        _pullFromHubInternal();
    }

    function _pullFromHubInternal() internal {
        // V2.1 BLOCKER FIX: Hub keys pendingReward + tokenToPool by TOKEN address, not pool.
        // Was incorrectly calling with address(this), which always returned 0 / reverted.
        address tok = address(token);
        uint256 owed = IHub(hub).pendingReward(tok);
        if (owed > 0) {
            IHub(hub).claimReward(tok);
            emit PulledFromHub(owed);
        }
        _accrue();
    }

    /// @dev C13/A18: explicit uint256 cast on every (weighted * rewardPerWeightedStored) product.
    ///      C15: uses lastRewardBalance for delta accounting; supports the C1 "hold" branch.
    function _accrue() internal {
        uint256 bal = address(this).balance;
        uint256 delta = bal - lastRewardBalance;
        if (delta == 0) return;
        if (totalWeightedStaked == 0) {
            // C1: hold; do NOT update rewardPerWeightedStored (no weighted divisor).
            // lastRewardBalance stays unchanged so delta carries forward to the first staker.
            return;
        }
        // delta * SCALE / totalWeightedStaked
        rewardPerWeightedStored += (delta * SCALE) / totalWeightedStaked;
        lastRewardBalance = bal;
        emit RewardAccrued(delta, rewardPerWeightedStored);
    }

    /// @notice Hub-deprecated entry point retained for back-compat. Reverts if used (push pattern removed).
    /// @dev B1/A2/A3: push notifyReward removed. Hub now uses pull. This function intentionally reverts.
    function notifyReward() external payable {
        revert TransferFailed(); // push pattern disabled; use pullFromHub()
    }

    function _earnedFor(Stake storage s) internal view returns (uint256) {
        // (weighted * rewardPerWeightedStored) / SCALE - rewardDebt
        uint256 acc = (uint256(s.weighted) * rewardPerWeightedStored) / SCALE;
        if (acc <= s.rewardDebt) return 0;
        return acc - s.rewardDebt;
    }

    // ────────────────── Stake / Claim / Unstake ──────────────────
    /// @notice Stake `amount` tokens into `tierId`. weighted = amount * mult / 10_000. Lock = now + duration.
    /// @dev C2/C12: enforces MAX_STAKES_PER_USER cap. C6: tier params baked at stake-time.
    function stake(uint256 tierId, uint256 amount, bool paidFee) external payable nonReentrant whenNotPaused {
        // === paidFee gating (V2.1 C4) ===
        if (!paidFee) {
            uint256 bal = IERC20(monshiToken).balanceOf(msg.sender);
            if (bal < MONSHI_GATE_AMOUNT) revert NotMonshiHolder(bal, MONSHI_GATE_AMOUNT);
            if (msg.value != 0) revert UnexpectedValue();
        } else {
            if (msg.value < STAKE_FEE) revert FeeTooSmall(msg.value, STAKE_FEE);
            // V2.1-10: single uint accumulator. Whoever is factory.treasuryWallet at
            // claim time pulls the entire bucket via claimTreasury().
            treasuryPending += msg.value;
            emit StakeFeeAccrued(msg.sender, msg.value);
        }
        if (amount == 0) revert ZeroAmount();
        if (tierId >= tiers.length) revert InvalidTier(tierId);
        Tier memory t = tiers[tierId];
        if (!t.enabled) revert TierDisabled(tierId);
        Stake[] storage userStakes = stakes[msg.sender];

        // C5: auto-pull rewards before mutating accounting state.
        _pullFromHubInternal();

        // Pull tokens from user.
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TokenTransferFailed();

        uint256 weighted = (amount * t.multiplierBps) / 10_000;
        if (weighted == 0) revert ZeroAmount();
        // N-6: bounds checks before uint128 casts
        require(amount   <= type(uint128).max, "amount overflow");
        require(weighted <= type(uint128).max, "weighted overflow");

        // If this is the first staker (totalWeightedStaked was 0), the held delta carries forward:
        // Roll lastRewardBalance forward AFTER setting totalWeightedStaked so first staker captures it.
        // Audit H-5: prefer reusing a closed slot (amount == 0) to bound storage growth.
        //   - unstake() zeros amount/weighted/rewardDebt and sets flags=1, leaving the slot recyclable.
        //   - all 8 Stake fields are overwritten on reuse so no stale state leaks across users
        //     (slot is per-user via userStakes mapping, but reusing avoids unbounded array growth).
        uint256 stakeId;
        {
            uint256 nSlots = userStakes.length;
            bool reused = false;
            for (uint256 i = 0; i < nSlots; i++) {
                if (userStakes[i].amount == 0) {
                    Stake storage rs = userStakes[i];
                    rs.amount     = uint128(amount);
                    rs.weighted   = uint128(weighted);
                    rs.startTs    = uint64(block.timestamp);
                    rs.unlockTs   = uint64(block.timestamp + t.duration);
                    rs.tierId     = uint64(tierId);
                    rs.flags      = 0;
                    rs.paidFee    = paidFee;
                    rs.rewardDebt = 0; // will set after we know the new rewardPerWeightedStored
                    stakeId = i;
                    reused = true;
                    break;
                }
            }
            if (!reused) {
                // N-3: cap check moved here so reuse path bypasses cap
                if (userStakes.length >= MAX_STAKES_PER_USER) revert MaxStakesReached(MAX_STAKES_PER_USER);
                userStakes.push(Stake({
                    amount: uint128(amount),
                    weighted: uint128(weighted),
                    startTs: uint64(block.timestamp),
                    unlockTs: uint64(block.timestamp + t.duration),
                    tierId: uint64(tierId),
                    flags: 0,
                    paidFee: paidFee,
                    rewardDebt: 0 // will set after we know the new rewardPerWeightedStored
                }));
                stakeId = userStakes.length - 1;
            }
        }

        bool wasEmpty = (totalWeightedStaked == 0);
        totalWeightedStaked += weighted;
        totalRawStaked      += amount;

        // Snapshot rewardDebt at PRE-absorption rewardPerWeightedStored so first staker
        // captures the C1-absorbed delta as earnings (not as pre-paid debt). For non-first
        // stakers, this is identical to setting after C1 since the C1 block does not run.
        userStakes[stakeId].rewardDebt = (uint256(weighted) * rewardPerWeightedStored) / SCALE;

        if (wasEmpty) {
            // C1 first-staker absorption: account any held delta against new totalWeightedStaked.
            uint256 bal  = address(this).balance;
            uint256 delta = bal - lastRewardBalance;
            if (delta > 0) {
                rewardPerWeightedStored += (delta * SCALE) / totalWeightedStaked;
                lastRewardBalance = bal;
                emit RewardAccrued(delta, rewardPerWeightedStored);
            }
        }

        emit Staked(msg.sender, stakeId, amount, weighted, uint64(block.timestamp + t.duration), uint64(tierId), paidFee);
    }

    /// @notice Claim accrued rewards for a single stake.
    function claim(uint256 stakeId) external nonReentrant whenNotPaused {
        _pullFromHubInternal();
        Stake[] storage userStakes = stakes[msg.sender];
        if (stakeId >= userStakes.length) revert StakeNotFound(stakeId);
        Stake storage s = userStakes[stakeId];
        uint256 reward = _earnedFor(s);
        if (reward == 0) return;
        s.rewardDebt = (uint256(s.weighted) * rewardPerWeightedStored) / SCALE;
        lastRewardBalance -= reward;
        (bool ok, ) = msg.sender.call{value: reward}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, reward);
    }

    /// @notice Claim accrued rewards across all of caller's stakes.
    function claimAll() external nonReentrant whenNotPaused {
        _pullFromHubInternal();
        Stake[] storage userStakes = stakes[msg.sender];
        uint256 n = userStakes.length;
        uint256 total = 0;
        uint256 rpw = rewardPerWeightedStored;
        for (uint256 i = 0; i < n; ++i) {
            Stake storage s = userStakes[i];
            if (s.weighted == 0) continue;
            uint256 acc = (uint256(s.weighted) * rpw) / SCALE;
            if (acc > s.rewardDebt) {
                total += (acc - s.rewardDebt);
                s.rewardDebt = acc;
            }
        }
        if (total == 0) return;
        lastRewardBalance -= total;
        (bool ok, ) = msg.sender.call{value: total}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, total);
    }

    /// @notice Unstake a position. If unlock has passed: full principal returned, no fee.
    ///         If early: principal * (10_000 - earlyFeeBps) / 10_000 returned to user, fee → burnVault.
    ///         Auto-claim accrued rewards before mutating.
    /// @dev C2: zero-don't-pop pattern. Stake slot is zeroed but kept (length never shrinks; cap protects gas).
    function unstake(uint256 stakeId) external nonReentrant whenNotPaused {
        _pullFromHubInternal();
        Stake[] storage userStakes = stakes[msg.sender];
        if (stakeId >= userStakes.length) revert StakeNotFound(stakeId);
        Stake storage s = userStakes[stakeId];
        if (s.weighted == 0) revert StakeNotFound(stakeId); // already-unstaked slot

        // Settle reward first.
        uint256 reward = _earnedFor(s);

        uint256 amount   = uint256(s.amount);
        uint256 weighted = uint256(s.weighted);
        uint64  unlockTs = s.unlockTs;
        uint64  tierId   = s.tierId;

        // Compute return / fee.
        // V2.1 dropout-penalty: if this is a free-tier (Monshi-gated, paidFee == false) stake and
        // the staker no longer holds >= MONSHI_GATE_AMOUNT MONSHI at unstake time, apply a flat
        // DROPOUT_PENALTY_BPS (20%) penalty regardless of whether the lock has matured. This
        // discourages gaming the gate (stake while holding 2M, dump MONSHI, withdraw clean).
        bool early = block.timestamp < unlockTs;
        bool dropoutPenalty = false;
        uint256 fee = 0;
        uint256 returned = amount;
        if (!s.paidFee && IERC20(monshiToken).balanceOf(msg.sender) < MONSHI_GATE_AMOUNT) {
            // Free-tier staker dropped below 2M MONSHI gate → 20% flat penalty (overrides early-fee).
            dropoutPenalty = true;
            fee = (amount * DROPOUT_PENALTY_BPS) / 10_000;
            returned = amount - fee;
        } else if (early) {
            uint64 feeBps = tiers[tierId].earlyFeeBps;
            fee = (amount * feeBps) / 10_000;
            returned = amount - fee;
        }

        // Mutate accounting BEFORE external calls.
        totalWeightedStaked -= weighted;
        totalRawStaked      -= amount;
        // Zero the slot (C2: keep, don't pop).
        s.amount     = 0;
        s.weighted   = 0;
        s.rewardDebt = 0;
        s.flags      = 1; // mark as closed for off-chain indexers

        // Pay reward (MON) if any.
        if (reward > 0) {
            lastRewardBalance -= reward;
            (bool okR, ) = msg.sender.call{value: reward}("");
            if (!okR) revert TransferFailed();
            emit Claimed(msg.sender, reward);
        }

        // Move fee to burnVault (creator-flushed via burn()).
        if (fee > 0) {
            burnVault += fee;
        }

        // Return principal tokens.
        bool okT = token.transfer(msg.sender, returned);
        if (!okT) revert TokenTransferFailed();

        emit Unstaked(msg.sender, stakeId, returned, fee, early, dropoutPenalty);
    }

    // ────────────────── Burn (creator-flush) ──────────────────
    /// @notice Flushes the burnVault. If burnsToCreator: tokens → creator. Else: tokens → DEAD.
    /// @dev C9: onlyCreator. nonReentrant for defense-in-depth (A9).
    function burn() external nonReentrant onlyCreator {
        uint256 amount = burnVault;
        if (amount == 0) revert ZeroAmount();
        burnVault = 0;
        address to = burnsToCreator ? creator : DEAD;
        bool ok = token.transfer(to, amount);
        if (!ok) revert TokenTransferFailed();
        emit Burned(amount, to);
    }

    // ────────────────── Timelocked admin ──────────────────
    /// @dev Generic queue/execute pattern. Owner queues, waits TIMELOCK_DELAY, then executes.
    bytes32 public constant SEL_SET_TIER       = keccak256("setTier");
    bytes32 public constant SEL_SET_EARLY_FEE  = keccak256("setEarlyFee");
    bytes32 public constant SEL_SET_CREATOR    = keccak256("setCreator");
    bytes32 public constant SEL_ADD_TIER       = keccak256("addTier");

    function _queue(bytes32 selector, bytes memory data) internal returns (bytes32 id) {
        id = keccak256(abi.encode(selector, data, block.timestamp));
        if (pendingOps[id].exists) revert OpExists(id);
        pendingOps[id] = Pending({
            selector: selector,
            data:     data,
            eta:      uint64(block.timestamp + TIMELOCK_DELAY),
            exists:   true
        });
        emit OpQueued(id, selector, uint64(block.timestamp + TIMELOCK_DELAY));
    }

    function _consume(bytes32 id) internal returns (Pending memory p) {
        p = pendingOps[id];
        if (!p.exists) revert OpUnknown(id);
        if (block.timestamp < p.eta) revert OpNotReady(id, p.eta);
        delete pendingOps[id];
        emit OpExecuted(id);
    }

    /// @notice Cancel a queued operation.
    function cancelOp(bytes32 id) external onlyOwner {
        if (!pendingOps[id].exists) revert OpUnknown(id);
        delete pendingOps[id];
        emit OpCancelled(id);
    }

    // ─── Tier admin (queue → wait → execute) ───
    function queueSetTier(uint256 tierId, uint64 duration, uint64 multBps, uint64 earlyFeeBps, bool enabled) external onlyOwner returns (bytes32) {
        if (tierId >= tiers.length) revert InvalidTier(tierId);
        if (multBps == 0 || multBps > 50_000) revert InvalidBps(multBps); // sanity: 0 < mult <= 5x
        if (earlyFeeBps > 5_000) revert InvalidBps(earlyFeeBps);          // <= 50%
        if (duration > 365 days) revert InvalidDuration(duration);
        return _queue(SEL_SET_TIER, abi.encode(tierId, duration, multBps, earlyFeeBps, enabled));
    }

    function executeSetTier(bytes32 id) external onlyOwner {
        Pending memory p = _consume(id);
        if (p.selector != SEL_SET_TIER) revert OpUnknown(id);
        (uint256 tierId, uint64 duration, uint64 multBps, uint64 earlyFeeBps, bool enabled) =
            abi.decode(p.data, (uint256, uint64, uint64, uint64, bool));
        Tier storage t = tiers[tierId];
        uint64 oldFee = t.earlyFeeBps;
        t.duration      = duration;
        t.multiplierBps = multBps;
        t.earlyFeeBps   = earlyFeeBps;
        t.enabled       = enabled;
        if (oldFee != earlyFeeBps) emit EarlyFeeChanged(tierId, oldFee, earlyFeeBps);
        emit TierSet(tierId, duration, multBps, earlyFeeBps, enabled);
    }

    function queueAddTier(uint64 duration, uint64 multBps, uint64 earlyFeeBps, bool enabled) external onlyOwner returns (bytes32) {
        if (multBps == 0 || multBps > 50_000) revert InvalidBps(multBps);
        if (earlyFeeBps > 5_000) revert InvalidBps(earlyFeeBps);
        if (duration > 365 days) revert InvalidDuration(duration);
        return _queue(SEL_ADD_TIER, abi.encode(duration, multBps, earlyFeeBps, enabled));
    }

    function executeAddTier(bytes32 id) external onlyOwner {
        Pending memory p = _consume(id);
        if (p.selector != SEL_ADD_TIER) revert OpUnknown(id);
        (uint64 duration, uint64 multBps, uint64 earlyFeeBps, bool enabled) =
            abi.decode(p.data, (uint64, uint64, uint64, bool));
        tiers.push(Tier({duration: duration, multiplierBps: multBps, earlyFeeBps: earlyFeeBps, enabled: enabled}));
        emit TierSet(tiers.length - 1, duration, multBps, earlyFeeBps, enabled);
    }

    // ─── Early-fee fast path (still timelocked) ───
    function queueSetEarlyFee(uint256 tierId, uint64 newBps) external onlyOwner returns (bytes32) {
        if (tierId >= tiers.length) revert InvalidTier(tierId);
        if (newBps > 5_000) revert InvalidBps(newBps);
        return _queue(SEL_SET_EARLY_FEE, abi.encode(tierId, newBps));
    }

    function executeSetEarlyFee(bytes32 id) external onlyOwner {
        Pending memory p = _consume(id);
        if (p.selector != SEL_SET_EARLY_FEE) revert OpUnknown(id);
        (uint256 tierId, uint64 newBps) = abi.decode(p.data, (uint256, uint64));
        uint64 old = tiers[tierId].earlyFeeBps;
        tiers[tierId].earlyFeeBps = newBps;
        emit EarlyFeeChanged(tierId, old, newBps);
    }

    // ─── Creator change (timelocked; affects burn() destination + buyback wallet sync risk noted) ───
    function queueSetCreator(address next) external onlyOwner returns (bytes32) {
        if (next == address(0)) revert ZeroAddress();
        return _queue(SEL_SET_CREATOR, abi.encode(next));
    }

    function executeSetCreator(bytes32 id) external onlyOwner {
        Pending memory p = _consume(id);
        if (p.selector != SEL_SET_CREATOR) revert OpUnknown(id);
        (address next) = abi.decode(p.data, (address));
        address prev = creator;
        creator = next;
        emit CreatorChanged(prev, next);
    }

    // ─── Pause (no timelock; emergency lever) ───
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    // ────────────────── 2-step ownership (A5/B6) ──────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address prev = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(prev, owner);
    }

    function renounceOwnership() external onlyOwner {
        // M-9 (V2.1-audit): renouncing ownership of this contract would brick admin paths
        // (tier mgmt, pause, treasury access). Explicitly disabled to prevent footgun.
        revert OwnershipCannotBeRenounced();
    }

    // ────────────────── Views ──────────────────
    function tiersLength() external view returns (uint256) { return tiers.length; }
    function stakesLength(address user) external view returns (uint256) { return stakes[user].length; }

    /// @notice Treasury wallet pulls accumulated paid-fee MON.
    /// @dev V2.1-10: resolves treasury live from factory. After Factory.executeSetTreasuryWallet,
    ///      the new treasury is the only address that can drain accumulated fees. Old treasury
    ///      loses access automatically. Pull pattern keeps stake() simple.
    function claimTreasury() external nonReentrant {
        address t = IFactoryRO_Pool(factoryRO).treasuryWallet();
        if (t == address(0)) revert ZeroAddress();
        if (msg.sender != t) revert NotTreasury();
        uint256 amt = treasuryPending;
        if (amt == 0) return;
        treasuryPending = 0;
        (bool ok, ) = t.call{value: amt}("");
        if (!ok) revert TransferFailed();
        emit TreasuryClaimed(t, amt);
    }

    /// @notice Returns the actual sum of raw token principals currently staked. (B7 fix)
    function getTotalRawStaked() external view returns (uint256) { return totalRawStaked; }

    /// @notice Returns the total weighted stake (used by Hub for reward share calc).
    function getTotalWeightedStaked() external view returns (uint256) { return totalWeightedStaked; }

    /// @notice Pending reward for a single stake (off-chain reads; does not include un-pulled Hub rewards).
    function pending(address user, uint256 stakeId) external view returns (uint256) {
        Stake[] storage userStakes = stakes[user];
        if (stakeId >= userStakes.length) return 0;
        return _earnedFor(userStakes[stakeId]);
    }

    /// @notice Pending reward across all of a user's stakes (off-chain reads).
    function pendingAll(address user) external view returns (uint256 total) {
        Stake[] storage userStakes = stakes[user];
        uint256 n = userStakes.length;
        uint256 rpw = rewardPerWeightedStored;
        for (uint256 i = 0; i < n; ++i) {
            Stake storage s = userStakes[i];
            if (s.weighted == 0) continue;
            uint256 acc = (uint256(s.weighted) * rpw) / SCALE;
            if (acc > s.rewardDebt) total += (acc - s.rewardDebt);
        }
    }

    function getTier(uint256 tierId) external view returns (Tier memory) {
        if (tierId >= tiers.length) revert InvalidTier(tierId);
        return tiers[tierId];
    }


    /* -------------------- Audit Admin recovery -------------------- */

    /// @notice Owner-only emergency unstake. Returns the principal to the user without
    ///         the unlock check or claim flow; pool MUST be paused so this only runs
    ///         during a halted state (e.g., security incident or migration).
    /// @dev    Zeros ALL Stake fields (amount, weighted, rewardDebt, startTs, unlockTs,
    ///         tierId, paidFee) and sets flags=1 (closed marker). This makes the slot
    ///         recyclable by the H-5 scan-then-reuse path on the next stake() and ensures
    ///         no stale state can leak. Reward accounting is decremented atomically.
    function adminEmergencyUnstake(address user, uint256 stakeId) external onlyOwner whenPaused nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        Stake[] storage userStakes = stakes[user];
        if (stakeId >= userStakes.length) revert StakeNotFound(stakeId);
        Stake storage s = userStakes[stakeId];
        uint256 principal = uint256(s.amount);
        if (principal == 0) revert StakeNotFound(stakeId); // already closed
        uint256 weightedAmt = uint256(s.weighted);

        // Decrement pool-wide accumulators (mirror unstake()).
        totalWeightedStaked -= weightedAmt;
        totalRawStaked      -= principal;

        // Zero ALL Stake fields (per H-5 cross-reference: amount==0 makes slot reusable;
        // other fields zeroed for hygiene so the next staker into this slot sees clean state).
        s.amount     = 0;
        s.weighted   = 0;
        s.rewardDebt = 0;
        s.startTs    = 0;
        s.unlockTs   = 0;
        s.tierId     = 0;
        s.paidFee    = false;
        s.flags      = 1; // closed marker for off-chain indexers (matches unstake())

        // Return principal tokens. No fee, no penalty, no reward payout: this is recovery, not claim.
        bool okT = token.transfer(user, principal);
        if (!okT) revert TokenTransferFailed();

        emit AdminEmergencyUnstaked(user, stakeId, principal);
    }

    // ────────────────── Receive / Fallback (A16) ──────────────────
    /// @notice Accepts MON only from the Hub (during pullFromHub) or as direct rewards top-up.
    /// @dev A16: Any inbound MON is accounted for via _accrue() on next pull/claim/unstake; nothing silently lost.
    receive() external payable {}
}

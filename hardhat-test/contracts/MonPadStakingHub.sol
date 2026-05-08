// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonPadStakingHub
 * @notice Receives sell-tax MON from every MonPad bonding curve and routes it:
 *           - `monshiShareBps` (default 40%) -> `buybackPending`, claimable by `buybackWallet`.
 *           - `othersShareBps` (default 60%) -> volume-weighted across registered pools
 *             (excluding MONSHI). Each pool's share lands in `pendingReward[token]`
 *             and is pulled via `claimReward(token)`.
 *
 *         All inbound paths are gated by `isCurve[msg.sender]` set by the factory at launch.
 *         All outbound paths are pull-based: a misbehaving pool cannot DOS distribution
 *         or strand any other pool's MON.
 */

/* ------------------------------------------------------------------ */
/*                      Inlined: ReentrancyGuard                       */
/* ------------------------------------------------------------------ */
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() { _status = _NOT_ENTERED; }

    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANT");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

/* ------------------------------------------------------------------ */
/*                          External Interfaces                        */
/* ------------------------------------------------------------------ */
interface IFactoryRO {
    function buybackWallet() external view returns (address);
    function poolFactory() external view returns (address);
}

interface IStakingPool {
    function token() external view returns (address);
}

/// @notice V2.1-16: Hub queries curve.token() at setCurveAuthorized time and stores the
///         binding. notifyReward then ignores the curve-supplied `token` arg in favor of
///         this authoritative mapping, removing any chance of a hostile/buggy curve crediting
///         volumeCache to the wrong token.
interface ICurveExt {
    function token() external view returns (address);
}

/* ------------------------------------------------------------------ */
/*                          MonPadStakingHub                           */
/* ------------------------------------------------------------------ */
contract MonPadStakingHub is ReentrancyGuard {
    /* ----------------------------- Constants --------------------------- */

    uint256 public constant MAX_POOLS         = 500;
    uint256 public constant TIMELOCK_DELAY    = 24 hours;
    uint16  public constant BPS_DENOM         = 10000;
    uint16  public constant SHARE_MIN_BPS     = 1000;   // 10%
    uint16  public constant SHARE_MAX_BPS     = 9000;   // 90%

    /* ---------------------------- Immutables --------------------------- */

    /// @notice MonPad factory (authoritative source for buybackWallet / poolFactory).
    address public immutable factory;

    /* ----------------------------- Storage ----------------------------- */

    /* --- Ownership (2-step) --- */
    address public owner;
    address public pendingOwner;

    /* --- Authorized callers --- */
    /// @notice Curves authorized to call `notifyReward`. Populated by factory at launch.
    mapping(address => bool) public isCurve;

    /// @notice V2.1-16: authoritative curve→token binding. Populated at setCurveAuthorized
    ///         time via ICurveExt(curve).token(). notifyReward uses this instead of the
    ///         caller-supplied token, defending against a hostile/buggy curve.
    mapping(address => address) public curveToken;

    /* --- Routing config --- */
    /// @notice Special token whose pool is excluded from volume-weighted distribution.
    ///         One-shot setter: only assignable while still address(0).
    address public monshiToken;

    /// @notice Share split (bps).
    uint16 public monshiShareBps;   // default 4000
    uint16 public othersShareBps;   // default 6000

    /* --- Pool registry --- */
    mapping(address => address) public tokenToPool;   // token => pool
    mapping(address => bool)    public isPool;        // pool  => registered
    address[] public allPools;

    /* --- Volume tracking (window: between distributes) --- */
    mapping(address => uint256) public volumeCache;   // token => MON volume since last distribute
    uint256 public totalVolumeCache;                  // sum of volumeCache (excluding MONSHI)

    /* --- Pull accumulators --- */
    /// @notice MONSHI portion accumulated for buyback wallet to pull.
    uint256 public buybackPending;

    /// @notice Per-pool-token pending MON, claimable via `claimReward(token)` by the pool.
    mapping(address => uint256) public pendingReward;

    /// @notice Sum of `pendingReward` over all tokens (for invariant checks / accounting).
    uint256 public totalPendingReward;

    /* --- Distribute scheduling --- */
    uint256 public distributeInterval;       // anti-spam window between auto-distributes
    uint256 public minDistributeBalance;     // min `othersAmt` required to trigger distribute
    uint256 public lastDistribute;

    /* --- Timelock --- */
    struct PendingChange {
        bytes32 kind;       // "shares" | "distInterval" | "minDist" | "monshiToken"
        uint256 valueA;     // primary value (or uint cast of address)
        uint256 valueB;     // secondary value (only used by "shares")
        uint256 readyAt;    // block.timestamp when execution becomes valid
        bool    pending;
    }
    mapping(bytes32 => PendingChange) public pendingChanges;

    /* ------------------------------ Events ----------------------------- */

    event CurveRegistered(address indexed curve, bool authorized);
    event PoolRegistered(address indexed token, address indexed pool);
    event PoolUnregistered(address indexed token, address indexed pool, uint256 reclaimedVolume);
    event RewardReceived(address indexed token, address indexed curve, uint256 amount, uint256 monshiPart, uint256 othersPart);
    event Distributed(uint256 othersAmt, uint256 distributedCount, uint256 timestamp);
    event RewardClaimed(address indexed token, address indexed pool, uint256 amount);
    event BuybackClaimed(address indexed wallet, uint256 amount);
    event MonshiTokenSet(address indexed token);
    event SharesChanged(uint16 monshiBps, uint16 othersBps);
    event DistributeIntervalChanged(uint256 newInterval);
    event MinDistributeBalanceChanged(uint256 newMin);
    event ChangeProposed(bytes32 indexed kind, uint256 valueA, uint256 valueB, uint256 readyAt);
    event ChangeCancelled(bytes32 indexed kind);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /* ------------------------------ Errors ----------------------------- */

    error NotOwner();
    error NotPendingOwner();
    error NotCurve(address caller);
    error NotPoolFactory(address caller);
    error NotFactory(address caller);
    error NotBuybackWallet(address caller);
    error NotPool(address caller, address token);
    error ZeroAddress();
    error ZeroAmount();
    error PlainMonRejected();
    error UnknownCall();
    error PoolAlreadyRegistered(address token);
    error PoolNotRegistered(address token);
    error TooManyPools(uint256 cap);
    error MonshiAlreadySet();
    error SharesOutOfRange(uint16 monshi, uint16 others);
    error WaitDistributeInterval(uint256 nextOk);
    error BelowMinBalance(uint256 have, uint256 need);
    error NoPendingChange(bytes32 kind);
    error ChangeNotReady(bytes32 kind, uint256 readyAt);
    error ChangeKindMismatch(bytes32 expected, bytes32 found);
    error TransferFailed();

    /* ----------------------------- Modifier ---------------------------- */

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPoolFactory() {
        if (msg.sender != IFactoryRO(factory).poolFactory()) revert NotPoolFactory(msg.sender);
        _;
    }

    modifier onlyBuybackWallet() {
        if (msg.sender != IFactoryRO(factory).buybackWallet()) revert NotBuybackWallet(msg.sender);
        _;
    }

    /* ---------------------------- Constructor -------------------------- */

    /**
     * @param _factory               MonPad factory address (immutable, source of buybackWallet/poolFactory).
     * @param _distributeInterval    Initial anti-spam window between auto-distributes (e.g. 1 hours).
     * @param _minDistributeBalance  Minimum `othersAmt` to trigger auto-distribute (e.g. 0.5 ether).
     */
    constructor(
        address _factory,
        uint256 _distributeInterval,
        uint256 _minDistributeBalance
    ) {
        if (_factory == address(0)) revert ZeroAddress();

        factory               = _factory;
        owner                 = msg.sender;
        monshiShareBps        = 4000;
        othersShareBps        = 6000;
        distributeInterval    = _distributeInterval;
        minDistributeBalance  = _minDistributeBalance;
        lastDistribute        = block.timestamp;

        emit OwnershipTransferred(address(0), msg.sender);
        emit SharesChanged(4000, 6000);
        emit DistributeIntervalChanged(_distributeInterval);
        emit MinDistributeBalanceChanged(_minDistributeBalance);
    }

    /* -------------------------- Curve registry ------------------------- */

    /// @notice Factory calls this on every curve launch to authorize the curve.
    /// @dev V2.1-16: when authorizing, also pin curveToken[curve] = curve.token(). Without this
    ///      binding, notifyReward had to trust the caller-supplied token argument, which a
    ///      hostile authorized curve could spoof to credit volumeCache to the wrong bucket.
    function setCurveAuthorized(address curve, bool authorized) external {
        if (msg.sender != factory) revert NotFactory(msg.sender);
        if (curve == address(0)) revert ZeroAddress();
        isCurve[curve] = authorized;
        if (authorized) {
            address tok = ICurveExt(curve).token();
            if (tok == address(0)) revert ZeroAddress();
            curveToken[curve] = tok;
        } else {
            delete curveToken[curve];
        }
        emit CurveRegistered(curve, authorized);
    }

    /* --------------------------- Notify reward ------------------------- */

    /**
     * @notice Called by an authorized curve on every sell-tax transfer.
     *         Splits incoming MON into MONSHI buyback + others-distribution accumulators.
     *
     *         If `token == monshiToken`, the entire `msg.value` is still split 40/60 — the
     *         token argument only drives the volume-weighting bucket. The MONSHI bucket is
     *         excluded from `volumeCache` because the MONSHI pool is not a beneficiary of
     *         the others-distribution; it is funded by the buyback wallet instead.
     */
    function notifyReward(address /* tokenArg */) external payable nonReentrant {
        if (!isCurve[msg.sender]) revert NotCurve(msg.sender);
        if (msg.value == 0)       revert ZeroAmount();

        // V2.1-16: trust the authoritative curve→token binding pinned at setCurveAuthorized,
        // not the caller's argument. The function parameter is kept for ABI compatibility
        // with the curve's encodeWithSignature("notifyReward(address)", token) call site.
        address token = curveToken[msg.sender];
        if (token == address(0)) revert ZeroAddress();

        // 40/60 split (defaults; adjustable under timelock)
        uint256 monshiPart = (msg.value * monshiShareBps) / BPS_DENOM;
        uint256 othersPart = msg.value - monshiPart;

        // MONSHI portion -> buyback accumulator (pull)
        if (monshiPart > 0) {
            buybackPending += monshiPart;
        }

        // Others portion -> volume-weighted bucket, but MONSHI's own token does NOT
        // contribute to volumeCache (MONSHI pool is not in the others distribution).
        if (othersPart > 0 && token != monshiToken) {
            volumeCache[token] += othersPart;
            totalVolumeCache   += othersPart;
        } else if (othersPart > 0 && token == monshiToken) {
            // MONSHI sells still produce an `othersPart`. Per spec, route it to buyback as well
            // (so MONSHI sellers don't subsidize other pools while MONSHI itself is excluded).
            buybackPending += othersPart;
            othersPart = 0; // for event clarity
            monshiPart = msg.value; // entire msg.value went to buyback in this case
        }

        emit RewardReceived(token, msg.sender, msg.value, monshiPart, othersPart);

        // Auto-distribute if interval elapsed AND we have a meaningful others bucket.
        if (
            block.timestamp >= lastDistribute + distributeInterval &&
            _othersAmtAvailable() >= minDistributeBalance
        ) {
            _distribute();
        }
    }

    /* --------------------------- Distribute ---------------------------- */

    /// @notice Permissionless trigger to flush the others-bucket out to per-pool pendingReward.
    function distribute() external nonReentrant {
        if (block.timestamp < lastDistribute + distributeInterval) {
            revert WaitDistributeInterval(lastDistribute + distributeInterval);
        }
        uint256 avail = _othersAmtAvailable();
        if (avail < minDistributeBalance) revert BelowMinBalance(avail, minDistributeBalance);
        _distribute();
    }

    /**
     * @dev Returns the MON currently sitting in `othersAmt` accumulator.
     *      Equal to: contract balance minus buybackPending minus totalPendingReward.
     *      All three accumulators are pull, so any leftover balance is the unallocated others bucket.
     */
    function _othersAmtAvailable() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 reserved = buybackPending + totalPendingReward;
        if (bal <= reserved) return 0;
        return bal - reserved;
    }

    /// @dev Splits `othersAmt` across registered non-MONSHI pools by volume weight.
    function _distribute() internal {
        // Snapshot the others bucket BEFORE crediting any pendingReward.
        uint256 othersAmt = _othersAmtAvailable();

        uint256 nPools = allPools.length;
        // Early return if nothing to do; preserve volumeCache state for the next attempt.
        if (othersAmt == 0 || nPools == 0 || totalVolumeCache == 0) {
            lastDistribute = block.timestamp;
            emit Distributed(othersAmt, 0, block.timestamp);
            return;
        }

        uint256 totalVol = totalVolumeCache;
        uint256 distributedCount = 0;
        uint256 creditedSum = 0;

        for (uint256 i = 0; i < nPools; i++) {
            address pool = allPools[i];
            if (!isPool[pool]) continue;

            address tkn = IStakingPool(pool).token();
            if (tkn == monshiToken) continue;

            uint256 vol = volumeCache[tkn];
            if (vol == 0) continue;

            // share = othersAmt * vol / totalVol  (no rounding rescue; dust stays in others bucket)
            uint256 share = (othersAmt * vol) / totalVol;
            if (share == 0) continue;

            pendingReward[tkn] += share;
            creditedSum        += share;
            volumeCache[tkn]    = 0;
            distributedCount++;
        }

        // Reset volume window. Any dust (< 1 wei per pool from integer division) stays in
        // the others bucket and rolls into the next round automatically.
        totalVolumeCache    = 0;
        totalPendingReward += creditedSum;
        lastDistribute      = block.timestamp;

        emit Distributed(othersAmt, distributedCount, block.timestamp);
    }

    /* ---------------------------- Pull paths --------------------------- */

    /// @notice Called by a registered pool to pull its accumulated MON.
    /// @param token Underlying staked token; pool is resolved via `tokenToPool[token]`.
    function claimReward(address token) external nonReentrant {
        address pool = tokenToPool[token];
        if (pool == address(0))    revert PoolNotRegistered(token);
        if (msg.sender != pool)    revert NotPool(msg.sender, token);

        uint256 amount = pendingReward[token];
        if (amount == 0) revert ZeroAmount();

        // CEI: zero state before external call.
        pendingReward[token] = 0;
        totalPendingReward  -= amount;

        (bool ok, ) = pool.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(token, pool, amount);
    }

    /// @notice Called by the factory's `buybackWallet` to pull accumulated MONSHI buyback funds.
    function claimBuyback() external nonReentrant onlyBuybackWallet {
        uint256 amount = buybackPending;
        if (amount == 0) revert ZeroAmount();

        buybackPending = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit BuybackClaimed(msg.sender, amount);
    }

    /* -------------------------- Pool registry -------------------------- */

    /// @notice Called by `MonPadPoolFactory` on graduation to register a new staking pool.
    function registerPool(address token, address pool) external onlyPoolFactory {
        if (token == address(0) || pool == address(0)) revert ZeroAddress();
        if (tokenToPool[token] != address(0))          revert PoolAlreadyRegistered(token);
        if (allPools.length >= MAX_POOLS)              revert TooManyPools(MAX_POOLS);

        tokenToPool[token] = pool;
        isPool[pool]       = true;
        allPools.push(pool);
        emit PoolRegistered(token, pool);
    }

    /// @notice Owner-controlled removal (e.g. compromised pool). Zeros volume and adjusts total.
    function unregisterPool(address token) external onlyOwner {
        address pool = tokenToPool[token];
        if (pool == address(0)) revert PoolNotRegistered(token);

        // Zero the volume bucket; refund tracked totalVolumeCache so subsequent distributes
        // don't over-weight the remaining pools.
        uint256 reclaimed = volumeCache[token];
        if (reclaimed > 0) {
            volumeCache[token] = 0;
            // safety: cap reduction at totalVolumeCache so we never underflow
            if (reclaimed > totalVolumeCache) reclaimed = totalVolumeCache;
            totalVolumeCache -= reclaimed;
        }

        // NOTE: any pendingReward[token] is preserved — it will simply remain unclaimable
        // by the unregistered pool. Owner can manually rescue via a future migration flow,
        // but we deliberately do NOT silently re-credit it here to keep CEI/invariants tight.

        isPool[pool] = false;
        delete tokenToPool[token];

        // Compact allPools[] by swap-and-pop
        uint256 n = allPools.length;
        for (uint256 i = 0; i < n; i++) {
            if (allPools[i] == pool) {
                if (i != n - 1) allPools[i] = allPools[n - 1];
                allPools.pop();
                break;
            }
        }

        emit PoolUnregistered(token, pool, reclaimed);
    }

    /* ---------------------- Timelock-gated setters --------------------- */

    /// @dev Common helper: stage a change under timelock.
    function _propose(bytes32 kind, uint256 valueA, uint256 valueB) internal {
        uint256 readyAt = block.timestamp + TIMELOCK_DELAY;
        pendingChanges[kind] = PendingChange({
            kind:    kind,
            valueA:  valueA,
            valueB:  valueB,
            readyAt: readyAt,
            pending: true
        });
        emit ChangeProposed(kind, valueA, valueB, readyAt);
    }

    function _consume(bytes32 kind) internal returns (uint256 a, uint256 b) {
        PendingChange memory c = pendingChanges[kind];
        if (!c.pending)               revert NoPendingChange(kind);
        if (c.kind != kind)           revert ChangeKindMismatch(kind, c.kind);
        if (block.timestamp < c.readyAt) revert ChangeNotReady(kind, c.readyAt);
        delete pendingChanges[kind];
        return (c.valueA, c.valueB);
    }

    function cancelChange(bytes32 kind) external onlyOwner {
        if (!pendingChanges[kind].pending) revert NoPendingChange(kind);
        delete pendingChanges[kind];
        emit ChangeCancelled(kind);
    }

    /* --- Shares --- */
    function proposeSetShares(uint16 _monshi, uint16 _others) external onlyOwner {
        if (_monshi + _others != BPS_DENOM)         revert SharesOutOfRange(_monshi, _others);
        if (_monshi < SHARE_MIN_BPS || _monshi > SHARE_MAX_BPS) revert SharesOutOfRange(_monshi, _others);
        if (_others < SHARE_MIN_BPS || _others > SHARE_MAX_BPS) revert SharesOutOfRange(_monshi, _others);
        _propose("shares", uint256(_monshi), uint256(_others));
    }
    function executeSetShares() external onlyOwner {
        (uint256 m, uint256 o) = _consume("shares");
        monshiShareBps = uint16(m);
        othersShareBps = uint16(o);
        emit SharesChanged(uint16(m), uint16(o));
    }

    /* --- Distribute interval --- */
    function proposeSetDistributeInterval(uint256 v) external onlyOwner { _propose("distInterval", v, 0); }
    function executeSetDistributeInterval() external onlyOwner {
        (uint256 v, ) = _consume("distInterval");
        distributeInterval = v;
        emit DistributeIntervalChanged(v);
    }

    /* --- Min distribute balance --- */
    function proposeSetMinDistributeBalance(uint256 v) external onlyOwner { _propose("minDist", v, 0); }
    function executeSetMinDistributeBalance() external onlyOwner {
        (uint256 v, ) = _consume("minDist");
        minDistributeBalance = v;
        emit MinDistributeBalanceChanged(v);
    }

    /* --- MONSHI token (one-shot) --- */
    function proposeSetMonshiToken(address t) external onlyOwner {
        if (monshiToken != address(0)) revert MonshiAlreadySet();
        if (t == address(0))           revert ZeroAddress();
        _propose("monshiToken", uint256(uint160(t)), 0);
    }
    function executeSetMonshiToken() external onlyOwner {
        if (monshiToken != address(0)) revert MonshiAlreadySet(); // double-guard against re-execute
        (uint256 v, ) = _consume("monshiToken");
        address t = address(uint160(v));
        if (t == address(0)) revert ZeroAddress();
        monshiToken = t;
        emit MonshiTokenSet(t);
    }

    /// @notice One-shot bootstrap for the very first MONSHI token assignment (skips 24h timelock).
    ///         Deploy ergonomics: the staking system needs `monshiToken` set immediately, otherwise
    ///         every sell of any token credits volumeCache for MONSHI sells too (since the
    ///         `token != monshiToken` branch never triggers when monshiToken == 0). After this is
    ///         called once, monshiToken is locked forever — no path can change it (mirrors
    ///         proposeSetMonshiToken's MonshiAlreadySet guard). Owner-only.
    function bootstrapMonshi(address t) external onlyOwner {
        if (monshiToken != address(0)) revert MonshiAlreadySet();
        if (t == address(0))           revert ZeroAddress();
        monshiToken = t;
        emit MonshiTokenSet(t);
    }

    /* --------------------------- Ownership ----------------------------- */

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    /* ------------------------------ Views ------------------------------ */

    function poolCount() external view returns (uint256) { return allPools.length; }

    function othersAmtAvailable() external view returns (uint256) { return _othersAmtAvailable(); }

    function pendingChange(bytes32 kind)
        external
        view
        returns (uint256 valueA, uint256 valueB, uint256 readyAt, bool isPending)
    {
        PendingChange memory c = pendingChanges[kind];
        return (c.valueA, c.valueB, c.readyAt, c.pending);
    }

    /* -------------------------- MON entry rules ------------------------ */

    /// @dev Plain MON sends are rejected. All inbound MON must arrive via `notifyReward`.
    receive() external payable {
        revert PlainMonRejected();
    }

    fallback() external payable {
        revert UnknownCall();
    }
}

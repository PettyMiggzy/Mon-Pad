// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadStakingPool.sol";

/* ============================================================
 *  MonPadPoolFactory.sol  —  Mon-Pad V2.1
 *  OZ-free. Inline ReentrancyGuard. 24h timelocked admin setters.
 *  2-step ownership. Custom errors. Pause lever. MAX_POOLS cap.
 *  Pool creation fee read from canonical buybackWallet on Factory.
 *  Hub.registerPool() MUST succeed (no try/catch swallow).
 * ============================================================ */

/* --------------------------- interfaces --------------------------- */

interface IFactory {
    function isLaunched(address token) external view returns (bool);
    function buybackWallet() external view returns (address);
    function creatorOf(address token) external view returns (address);
    function treasuryWallet() external view returns (address);
}

/// @notice Hub interface used here. Renamed from IHub to avoid a name collision with the
///         IHub declared inside MonPadStakingPool.sol (which has different methods —
///         claimReward/pendingReward — for the staker-side pull flow). Both interfaces
///         end up in the same compilation unit because PoolFactory imports StakingPool
///         to deploy it via `new`, so the two would collide if both were named IHub.
interface IHubAdmin {
    function registerPool(address token, address pool) external;
    function setPoolFactory(address pf) external;
}

interface IERC20Min {
    function balanceOf(address a) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/* --------------------------- contract --------------------------- */

contract MonPadPoolFactory {

    /* -------- ownership (2-step, no extra timelock per C15) -------- */
    address public owner;
    address public pendingOwner;

    /* -------- immutables -------- */
    address public immutable hub;
    address public immutable factory;
    address public monshiToken; // mutable via timelocked setter (C9)

    /* -------- params -------- */
    uint256 public freePoolMonshiThreshold = 1_000_000 ether;
    uint256 public poolCreationFee         = 100 ether;       // B8 lock
    bool    public paused;

    /* -------- constants -------- */
    uint256 public constant MAX_POOLS    = 500;
    uint256 public constant TIMELOCK_DELAY = 24 hours;

    /* -------- registry -------- */
    mapping(address => address) public tokenToPool;
    address[] public allPools;

    /* -------- reentrancy -------- */
    uint256 private _reentry; // 0 = unlocked, 1 = entered

    /* -------- timelock store -------- */
    struct Op { bytes32 selector; bytes data; uint256 eta; bool exists; }
    mapping(bytes32 => Op) public ops; // opId => Op

    /* -------- events -------- */
    event PoolCreated(address indexed token, address indexed pool, address indexed creator, bool burnsToCreator, bool freePath);
    event ParamChanged(bytes32 indexed key, uint256 oldVal, uint256 newVal);
    event MonshiTokenChanged(address indexed oldT, address indexed newT);
    event HubPoolFactoryNote(); // documentation event, no payload
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event OpQueued(bytes32 indexed opId, bytes32 indexed selector, uint256 eta);
    event OpExecuted(bytes32 indexed opId, bytes32 indexed selector);
    event OpCancelled(bytes32 indexed opId);
    event MaxPoolsCapHit(uint256 cap);

    /* -------- errors -------- */
    error NotOwner(address caller);
    error NotPendingOwner(address caller);
    error ZeroAddress();
    error PoolExists(address token);
    error InsufficientFee(uint256 sent, uint256 required);
    error FeeForwardFailed();
    error RefundFailed();
    error NotAContract(address token);
    error NotERC20(address token);
    error MaxPoolsReached(uint256 cap);
    error PausedErr();
    error Reentered();
    error OpNotFound(bytes32 opId);
    error OpNotReady(bytes32 opId, uint256 eta, uint256 nowTs);
    error OpAlreadyQueued(bytes32 opId);
    error AdminBurnsRequiresMonshi(address token);
    error HubRegistrationFailed(address token, address pool);

    /* -------- modifiers -------- */
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }
    modifier whenNotPaused() {
        if (paused) revert PausedErr();
        _;
    }
    modifier nonReentrant() {
        if (_reentry == 1) revert Reentered();
        _reentry = 1;
        _;
        _reentry = 0;
    }

    /* -------- constructor -------- */
    constructor(address _hub, address _factory, address _monshi) {
        if (_hub == address(0)) revert ZeroAddress();
        if (_factory == address(0)) revert ZeroAddress();
        if (_monshi == address(0)) revert ZeroAddress();
        owner       = msg.sender;
        hub         = _hub;
        factory     = _factory;
        monshiToken = _monshi;
    }

    /* ============================================================
     *                       PUBLIC CREATE PATH
     * ============================================================ */

    /// @notice Permissionless pool creation. Always burnsToCreator = false.
    function createPool(address token)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (address pool)
    {
        if (token == address(0)) revert ZeroAddress();
        if (tokenToPool[token] != address(0)) revert PoolExists(token);
        if (allPools.length >= MAX_POOLS) {
            emit MaxPoolsCapHit(MAX_POOLS);
            revert MaxPoolsReached(MAX_POOLS);
        }

        // Token sanity probe (A18)
        if (token.code.length == 0) revert NotAContract(token);
        try IERC20Min(token).totalSupply() returns (uint256) {
            // ok
        } catch {
            revert NotERC20(token);
        }

        // Eligibility: free path if msg.sender holds >= freePoolMonshiThreshold
        bool free = IERC20Min(monshiToken).balanceOf(msg.sender) >= freePoolMonshiThreshold;

        if (!free) {
            uint256 fee = poolCreationFee;
            if (msg.value < fee) revert InsufficientFee(msg.value, fee);

            // forward fee to canonical buybackWallet (read from Factory per B2)
            address bw = IFactory(factory).buybackWallet();
            if (bw == address(0)) revert ZeroAddress();
            (bool ok, ) = bw.call{value: fee}("");
            if (!ok) revert FeeForwardFailed();

            // refund excess
            if (msg.value > fee) {
                (bool rok, ) = msg.sender.call{value: msg.value - fee}("");
                if (!rok) revert RefundFailed();
            }
        } else {
            // free path: no fee taken. refund any sent value.
            if (msg.value > 0) {
                (bool rok, ) = msg.sender.call{value: msg.value}("");
                if (!rok) revert RefundFailed();
            }
        }

        // Creator determination (A8/C2)
        address poolCreator;
        if (IFactory(factory).isLaunched(token)) {
            poolCreator = IFactory(factory).creatorOf(token);
            if (poolCreator == address(0)) poolCreator = msg.sender; // safety fallback
        } else {
            poolCreator = msg.sender;
        }

        // Deploy pool. createPool is ALWAYS burnsToCreator = false (B3/C16).
        MonPadStakingPool p = new MonPadStakingPool(
            IERC20(token),
            hub,
            monshiToken,
            poolCreator,
            false,
            owner,
            factory  // V2.1-10: pool reads treasuryWallet live from factory at claim time
        );
        pool = address(p);

        tokenToPool[token] = pool;
        allPools.push(pool);

        // Hub registration MUST succeed (A11/B7) — no try/catch
        IHubAdmin(hub).registerPool(token, pool);

        emit PoolCreated(token, pool, poolCreator, false, free);
    }

    /* ============================================================
     *                        ADMIN CREATE PATH
     * ============================================================ */

    /// @notice Owner-only. burnsToCreator=true ONLY allowed when token == monshiToken (B3/C16).
    function adminCreatePool(address token, address creator, bool burnsToCreator)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
        returns (address pool)
    {
        if (token == address(0)) revert ZeroAddress();
        if (creator == address(0)) revert ZeroAddress();
        if (tokenToPool[token] != address(0)) revert PoolExists(token);
        if (allPools.length >= MAX_POOLS) {
            emit MaxPoolsCapHit(MAX_POOLS);
            revert MaxPoolsReached(MAX_POOLS);
        }
        if (burnsToCreator && token != monshiToken) revert AdminBurnsRequiresMonshi(token);

        // sanity probe
        if (token.code.length == 0) revert NotAContract(token);
        try IERC20Min(token).totalSupply() returns (uint256) {} catch {
            revert NotERC20(token);
        }

        MonPadStakingPool p = new MonPadStakingPool(
            IERC20(token),
            hub,
            monshiToken,
            creator,
            burnsToCreator,
            owner,
            factory  // V2.1-10: pool reads treasuryWallet live from factory at claim time
        );
        pool = address(p);

        tokenToPool[token] = pool;
        allPools.push(pool);

        IHubAdmin(hub).registerPool(token, pool);

        emit PoolCreated(token, pool, creator, burnsToCreator, true);
    }

    /* ============================================================
     *                        VIEW HELPERS
     * ============================================================ */

    function allPoolsCount() external view returns (uint256) {
        return allPools.length;
    }

    /// @notice Paginated reader (C13)
    function getPools(uint256 start, uint256 count) external view returns (address[] memory out) {
        uint256 len = allPools.length;
        if (start >= len) return new address[](0);
        uint256 end = start + count;
        if (end > len) end = len;
        out = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = allPools[i];
        }
    }

    /* ============================================================
     *                        PAUSE LEVER (A13)
     * ============================================================ */

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /* ============================================================
     *                  2-STEP OWNERSHIP (A7 / C15)
     * ============================================================ */

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

    /* ============================================================
     *                  TIMELOCKED ADMIN SETTERS (A6)
     *
     *  Pattern (mirrors Pool/Hub/Graduator):
     *    queue<X>(args)   -> stores Op with eta = now + 24h, returns opId
     *    execute<X>(args) -> requires Op exists, eta passed, applies change
     *    cancelOp(opId)   -> owner can cancel a queued op
     * ============================================================ */

    function _queue(bytes32 selector, bytes memory data) internal returns (bytes32 opId) {
        opId = keccak256(abi.encode(selector, data, block.timestamp));
        if (ops[opId].exists) revert OpAlreadyQueued(opId);
        uint256 eta = block.timestamp + TIMELOCK_DELAY;
        ops[opId] = Op({ selector: selector, data: data, eta: eta, exists: true });
        emit OpQueued(opId, selector, eta);
    }

    function _consume(bytes32 opId, bytes32 selector) internal {
        Op memory op = ops[opId];
        if (!op.exists) revert OpNotFound(opId);
        if (op.selector != selector) revert OpNotFound(opId);
        if (block.timestamp < op.eta) revert OpNotReady(opId, op.eta, block.timestamp);
        delete ops[opId];
        emit OpExecuted(opId, selector);
    }

    function cancelOp(bytes32 opId) external onlyOwner {
        if (!ops[opId].exists) revert OpNotFound(opId);
        delete ops[opId];
        emit OpCancelled(opId);
    }

    /* ---- setMonshiThreshold ---- */
    bytes32 private constant SEL_MONSHI_THRESHOLD = keccak256("setMonshiThreshold(uint256)");

    function queueSetMonshiThreshold(uint256 newVal) external onlyOwner returns (bytes32) {
        return _queue(SEL_MONSHI_THRESHOLD, abi.encode(newVal));
    }
    function executeSetMonshiThreshold(bytes32 opId, uint256 newVal) external onlyOwner {
        Op memory op = ops[opId];
        if (keccak256(op.data) != keccak256(abi.encode(newVal))) revert OpNotFound(opId);
        _consume(opId, SEL_MONSHI_THRESHOLD);
        uint256 old = freePoolMonshiThreshold;
        freePoolMonshiThreshold = newVal;
        emit ParamChanged("freePoolMonshiThreshold", old, newVal);
    }

    /* ---- setPoolCreationFee ---- */
    bytes32 private constant SEL_POOL_CREATION_FEE = keccak256("setPoolCreationFee(uint256)");

    function queueSetPoolCreationFee(uint256 newVal) external onlyOwner returns (bytes32) {
        return _queue(SEL_POOL_CREATION_FEE, abi.encode(newVal));
    }
    function executeSetPoolCreationFee(bytes32 opId, uint256 newVal) external onlyOwner {
        Op memory op = ops[opId];
        if (keccak256(op.data) != keccak256(abi.encode(newVal))) revert OpNotFound(opId);
        _consume(opId, SEL_POOL_CREATION_FEE);
        uint256 old = poolCreationFee;
        poolCreationFee = newVal;
        emit ParamChanged("poolCreationFee", old, newVal);
    }

    /* ---- setHub (factory's hub reference; existing pools keep their immutable hub) ---- */
    bytes32 private constant SEL_HUB = keccak256("setHub(address)");

    function queueSetHub(address newHub) external onlyOwner returns (bytes32) {
        if (newHub == address(0)) revert ZeroAddress();
        return _queue(SEL_HUB, abi.encode(newHub));
    }
    function executeSetHub(bytes32 opId, address newHub) external onlyOwner {
        if (newHub == address(0)) revert ZeroAddress();
        Op memory op = ops[opId];
        if (keccak256(op.data) != keccak256(abi.encode(newHub))) revert OpNotFound(opId);
        _consume(opId, SEL_HUB);
        // NOTE: `hub` is immutable on this contract per V2.1 lockdown; this setter is reserved
        // for a future upgrade where `hub` becomes mutable. Currently reverts.
        // Keeping the queue/execute scaffolding for a future redeploy with mutable hub.
        revert("hub immutable in this version");
    }

    /* ---- setMonshiToken (mutable, timelocked) ---- */
    bytes32 private constant SEL_MONSHI_TOKEN = keccak256("setMonshiToken(address)");

    function queueSetMonshiToken(address newT) external onlyOwner returns (bytes32) {
        if (newT == address(0)) revert ZeroAddress();
        return _queue(SEL_MONSHI_TOKEN, abi.encode(newT));
    }
    function executeSetMonshiToken(bytes32 opId, address newT) external onlyOwner {
        if (newT == address(0)) revert ZeroAddress();
        Op memory op = ops[opId];
        if (keccak256(op.data) != keccak256(abi.encode(newT))) revert OpNotFound(opId);
        _consume(opId, SEL_MONSHI_TOKEN);
        address old = monshiToken;
        monshiToken = newT;
        emit MonshiTokenChanged(old, newT);
    }

    /* -------- receive / fallback -------- */
    receive() external payable {}
}

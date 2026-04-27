// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ FLATTENED FROM: MonPadStakingHub.sol ============
// Compile with: solc 0.8.24, viaIR=true, optimizer=200, evmVersion=paris


interface IStakingPool {
    function notifyReward() external payable;
    function token() external view returns (address);
}

interface IFactoryRO {
    function isLaunched(address) external view returns (bool);
    function tokToCurve(address) external view returns (address);
    function owner() external view returns (address);
    function buybackWallet() external view returns (address);
    function monshiStakingPool() external view returns (address);
}

interface ICurveRO {
    function monRaised() external view returns (uint256);
}

/// @title MonPadStakingHub
/// @notice Receives sell-tax MON from all curves. Routes 40% to MONSHI pool,
///         60% to other token pools weighted by recent volume.
contract MonPadStakingHub {
    address public owner;
    address public factory;
    address public monshiToken;
    
    uint16 public monshiShareBps = 4000;  // 40% to MONSHI
    uint16 public othersShareBps = 6000;  // 60% to others
    
    // pool registry
    mapping(address => address) public tokenToPool;     // token => pool
    mapping(address => bool) public isPool;
    address[] public allPools;
    
    // volume tracking (recent — used for weighting)
    mapping(address => uint256) public volumeCache;     // token => MON volume since last distribute
    uint256 public totalVolumeCache;                    // sum of volumeCache (excluding MONSHI)
    
    // batched rewards waiting for distribution
    uint256 public pendingMonshi;
    uint256 public pendingOthers;
    
    // Distribute interval (anti-spam, batches small amounts)
    uint256 public distributeInterval = 1 hours;
    uint256 public lastDistribute;
    uint256 public minDistributeBalance = 0.5 ether;
    
    event PoolRegistered(address indexed token, address indexed pool);
    event RewardReceived(address indexed token, uint256 amount);
    event Distributed(uint256 toMonshi, uint256 toOthers, uint256 poolCount);
    event ParamChanged(string key, uint256 v);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    
    constructor(address _factory, address _monshi) {
        owner = msg.sender;
        factory = _factory;
        monshiToken = _monshi;
        lastDistribute = block.timestamp;
    }
    
    /// Called by curves on every sell — credits volume + accumulates MON
    function notifyReward(address token) external payable {
        require(msg.value > 0, "0");
        
        // Track volume (sell amount in MON)
        if (token == monshiToken) {
            // MONSHI rewards go straight to MONSHI pool (or buyback if no pool yet)
            pendingMonshi += msg.value;
        } else {
            volumeCache[token] += msg.value;
            totalVolumeCache += msg.value;
            pendingOthers += msg.value;
        }
        
        emit RewardReceived(token, msg.value);
        
        // Auto-distribute if conditions met (saves manual call)
        if (block.timestamp >= lastDistribute + distributeInterval && address(this).balance >= minDistributeBalance) {
            _distribute();
        }
    }
    
    /// Manual distribute trigger (anyone can call)
    function distribute() external {
        require(block.timestamp >= lastDistribute + distributeInterval, "wait");
        _distribute();
    }
    
    function _distribute() internal {
        uint256 monshiAmt = pendingMonshi;
        uint256 othersAmt = pendingOthers;
        
        // Send MONSHI rewards
        if (monshiAmt > 0) {
            address mPool = IFactoryRO(factory).monshiStakingPool();
            if (mPool == address(0)) mPool = IFactoryRO(factory).buybackWallet();
            if (mPool != address(0)) {
                (bool ok, ) = mPool.call{value: monshiAmt}("");
                if (ok) pendingMonshi = 0;
            }
        }
        
        // Distribute to others by volume weight
        uint256 distributedCount = 0;
        if (othersAmt > 0 && totalVolumeCache > 0) {
            for (uint256 i = 0; i < allPools.length; i++) {
                address pool = allPools[i];
                if (!isPool[pool]) continue;
                address tkn = IStakingPool(pool).token();
                if (tkn == monshiToken) continue;
                uint256 vol = volumeCache[tkn];
                if (vol == 0) continue;
                uint256 share = (othersAmt * vol) / totalVolumeCache;
                if (share == 0) continue;
                (bool ok, ) = pool.call{value: share}(abi.encodeWithSignature("notifyReward()"));
                if (ok) {
                    distributedCount++;
                    volumeCache[tkn] = 0;
                }
            }
            pendingOthers = 0;
            totalVolumeCache = 0;
        }
        
        lastDistribute = block.timestamp;
        emit Distributed(monshiAmt, othersAmt, distributedCount);
    }
    
    // Pool registration (called by pool deployer factory)
    function registerPool(address tokenAddr, address pool) external onlyOwner {
        require(tokenToPool[tokenAddr] == address(0), "exists");
        tokenToPool[tokenAddr] = pool;
        isPool[pool] = true;
        allPools.push(pool);
        emit PoolRegistered(tokenAddr, pool);
    }
    
    function unregisterPool(address tokenAddr) external onlyOwner {
        address pool = tokenToPool[tokenAddr];
        require(pool != address(0), "none");
        isPool[pool] = false;
        delete tokenToPool[tokenAddr];
    }
    
    // Admin setters
    function setShares(uint16 _monshi, uint16 _others) external onlyOwner {
        require(_monshi + _others == 10000, "must sum 100%");
        monshiShareBps = _monshi;
        othersShareBps = _others;
    }
    function setDistributeInterval(uint256 v) external onlyOwner {
        distributeInterval = v;
        emit ParamChanged("distInterval", v);
    }
    function setMinDistributeBalance(uint256 v) external onlyOwner {
        minDistributeBalance = v;
        emit ParamChanged("minDist", v);
    }
    function setMonshiToken(address t) external onlyOwner { monshiToken = t; }
    function transferOwnership(address n) external onlyOwner { owner = n; }
    
    function poolCount() external view returns (uint256) { return allPools.length; }
    
    receive() external payable {}
}


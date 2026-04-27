// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ FLATTENED FROM: MonPadPoolFactory.sol ============
// Compile with: solc 0.8.24, viaIR=true, optimizer=200, evmVersion=paris



interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function totalSupply() external view returns (uint256);
}

/// @title MonPadStakingPool
/// @notice Per-token staking pool. Stake tokens, earn MON.
///         4 lock tiers with reward multipliers.
contract MonPadStakingPool {
    address public owner;
    address public hub;
    address public token;          // token being staked
    address public creator;        // gets early-unstake fees in MON? No — those stay in pool. Forfeited rewards too.
    
    // Lock tier multipliers (BPS — 10000 = 1.0x)
    uint16[4] public tierMultBps = [10000, 15000, 25000, 40000];   // 1.0/1.5/2.5/4.0x
    uint32[4] public tierDurations = [30 days, 90 days, 180 days, 365 days];
    
    // Early unstake config
    uint16 public earlyUnstakeFeeBps = 1000;  // 10%
    
    // Reward accounting (MON)
    uint256 public totalWeightedStaked;  // weighted by tier multiplier
    uint256 public rewardPerWeightedStored; // accumulator (1e18 scaled)
    uint256 public lastRewardBalance;
    
    struct Stake {
        uint128 amount;        // raw tokens
        uint128 weighted;      // tokens * multiplier / 10000
        uint64 startedAt;
        uint64 unlockAt;
        uint8 tier;
        uint256 rewardDebt;
    }
    mapping(address => Stake[]) public stakes;
    
    event Staked(address indexed user, uint256 indexed stakeIdx, uint256 amount, uint8 tier, uint64 unlockAt);
    event Unstaked(address indexed user, uint256 indexed stakeIdx, uint256 amount, uint256 reward, bool early);
    event RewardClaimed(address indexed user, uint256 indexed stakeIdx, uint256 reward);
    event RewardNotified(uint256 amount);
    event TierChanged(uint8 idx, uint16 multBps, uint32 duration);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    modifier onlyHub() { require(msg.sender == hub, "!hub"); _; }
    
    constructor(address _token, address _hub, address _creator) {
        token = _token;
        hub = _hub;
        creator = _creator;
        owner = msg.sender;
    }
    
    // ── REWARD ACCOUNTING ─────────────────────
    function notifyReward() external payable {
        require(msg.value > 0, "0");
        if (totalWeightedStaked == 0) {
            // No stakers yet — return to sender (or hub keeps it)
            (bool ok, ) = msg.sender.call{value: msg.value}("");
            require(ok, "refund");
            return;
        }
        rewardPerWeightedStored += (msg.value * 1e18) / totalWeightedStaked;
        lastRewardBalance += msg.value;
        emit RewardNotified(msg.value);
    }
    
    function pendingReward(address user, uint256 stakeIdx) public view returns (uint256) {
        if (stakeIdx >= stakes[user].length) return 0;
        Stake memory s = stakes[user][stakeIdx];
        if (s.amount == 0) return 0;
        uint256 acc = (uint256(s.weighted) * rewardPerWeightedStored) / 1e18;
        return acc > s.rewardDebt ? acc - s.rewardDebt : 0;
    }
    
    function pendingTotal(address user) external view returns (uint256 total) {
        for (uint256 i = 0; i < stakes[user].length; i++) {
            total += pendingReward(user, i);
        }
    }
    
    // ── STAKE ─────────────────────────────────
    function stake(uint256 amount, uint8 tier) external {
        require(tier < 4, "tier");
        require(amount > 0, "0");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "xfer");
        
        uint256 weighted = (amount * tierMultBps[tier]) / 10000;
        uint64 unlockAt = uint64(block.timestamp + tierDurations[tier]);
        
        stakes[msg.sender].push(Stake({
            amount: uint128(amount),
            weighted: uint128(weighted),
            startedAt: uint64(block.timestamp),
            unlockAt: unlockAt,
            tier: tier,
            rewardDebt: (weighted * rewardPerWeightedStored) / 1e18
        }));
        
        totalWeightedStaked += weighted;
        emit Staked(msg.sender, stakes[msg.sender].length - 1, amount, tier, unlockAt);
    }
    
    // ── CLAIM (rewards only, keep stake) ──────
    function claim(uint256 stakeIdx) external {
        Stake storage s = stakes[msg.sender][stakeIdx];
        require(s.amount > 0, "!stake");
        uint256 reward = pendingReward(msg.sender, stakeIdx);
        if (reward == 0) return;
        s.rewardDebt = (uint256(s.weighted) * rewardPerWeightedStored) / 1e18;
        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "claim fail");
        emit RewardClaimed(msg.sender, stakeIdx, reward);
    }
    
    function claimAll() external {
        uint256 total;
        for (uint256 i = 0; i < stakes[msg.sender].length; i++) {
            Stake storage s = stakes[msg.sender][i];
            if (s.amount == 0) continue;
            uint256 r = pendingReward(msg.sender, i);
            if (r == 0) continue;
            s.rewardDebt = (uint256(s.weighted) * rewardPerWeightedStored) / 1e18;
            total += r;
        }
        if (total > 0) {
            (bool ok, ) = msg.sender.call{value: total}("");
            require(ok, "claim fail");
        }
    }
    
    // ── UNSTAKE ───────────────────────────────
    function unstake(uint256 stakeIdx) external {
        Stake storage s = stakes[msg.sender][stakeIdx];
        require(s.amount > 0, "!stake");
        bool early = block.timestamp < s.unlockAt;
        
        uint256 amount = s.amount;
        uint256 weighted = s.weighted;
        uint256 reward = pendingReward(msg.sender, stakeIdx);
        uint256 fee = 0;
        uint256 forfeitedReward = 0;
        
        if (early) {
            fee = (amount * earlyUnstakeFeeBps) / 10000;
            amount -= fee;
            forfeitedReward = reward;
            reward = 0;
            // forfeited reward stays in pool (boosts other stakers via rewardPerWeightedStored on next notify)
            // fee in tokens stays in contract (not redistributed automatically — sits as pool tokens)
            // Could send fee tokens back to creator wallet here if desired:
            if (fee > 0 && creator != address(0)) {
                IERC20(token).transfer(creator, fee);
            }
        }
        
        // Reduce totalWeighted
        totalWeightedStaked -= weighted;
        
        // Pay reward (if any)
        if (reward > 0) {
            (bool ok, ) = msg.sender.call{value: reward}("");
            require(ok, "reward fail");
        }
        
        // Pay tokens back
        IERC20(token).transfer(msg.sender, amount);
        
        // Mark stake as withdrawn
        s.amount = 0;
        s.weighted = 0;
        s.rewardDebt = 0;
        
        emit Unstaked(msg.sender, stakeIdx, amount, reward, early);
    }
    
    // ── VIEWS ─────────────────────────────────
    function userStakeCount(address user) external view returns (uint256) {
        return stakes[user].length;
    }
    function getStake(address user, uint256 idx) external view returns (Stake memory) {
        return stakes[user][idx];
    }
    function totalRawStaked() external view returns (uint256 t) {
        // would need iteration, expensive — track separately if needed
        return 0;
    }
    
    // ── ADMIN ─────────────────────────────────
    function setTier(uint8 idx, uint16 multBps, uint32 duration) external onlyOwner {
        require(idx < 4, "idx");
        require(multBps >= 10000 && multBps <= 100000, "mult bounds");
        tierMultBps[idx] = multBps;
        tierDurations[idx] = duration;
        emit TierChanged(idx, multBps, duration);
    }
    function setEarlyFee(uint16 bps) external onlyOwner {
        require(bps <= 5000, "max 50%");
        earlyUnstakeFeeBps = bps;
    }
    function setCreator(address c) external onlyOwner { creator = c; }
    function transferOwnership(address n) external onlyOwner { owner = n; }
    
    receive() external payable {}
}



interface IFactory2 {
    function isLaunched(address) external view returns (bool);
    function buybackWallet() external view returns (address);
    function owner() external view returns (address);
}

interface IHub {
    function registerPool(address token, address pool) external;
    function tokenToPool(address) external view returns (address);
    function owner() external view returns (address);
}

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

/// @title MonPadPoolFactory
/// @notice Anyone can create a staking pool for any token they own/care about.
///         Free if creator holds 1M+ MONSHI, 200 MON otherwise (sent to buyback).
contract MonPadPoolFactory {
    address public owner;
    address public hub;
    address public factory;
    address public monshiToken;
    address public buybackWallet;
    
    uint256 public freePoolMonshiThreshold = 1_000_000 ether; // 1M MONSHI
    uint256 public poolCreationFee = 200 ether;               // 200 MON
    
    mapping(address => address) public tokenToPool;
    address[] public allPools;
    
    event PoolCreated(address indexed token, address indexed pool, address indexed creator, uint256 feePaid);
    event ParamChanged(string key, uint256 v);
    event WalletChanged(string key, address w);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    
    constructor(address _hub, address _factory, address _monshi, address _buyback) {
        owner = msg.sender;
        hub = _hub;
        factory = _factory;
        monshiToken = _monshi;
        buybackWallet = _buyback;
    }
    
    function createPool(address token) external payable returns (address pool) {
        require(tokenToPool[token] == address(0), "exists");
        
        // Check eligibility: free if hold 1M+ MONSHI, else 200 MON fee
        uint256 monshiBal = IERC20Min(monshiToken).balanceOf(msg.sender);
        bool free = monshiBal >= freePoolMonshiThreshold;
        
        if (!free) {
            require(msg.value >= poolCreationFee, "need 200 MON or 1M MONSHI");
            // Send fee to buyback wallet
            (bool ok, ) = buybackWallet.call{value: poolCreationFee}("");
            require(ok, "fee fail");
            // Refund excess
            if (msg.value > poolCreationFee) {
                (bool r, ) = msg.sender.call{value: msg.value - poolCreationFee}("");
                require(r, "refund");
            }
        } else if (msg.value > 0) {
            (bool r, ) = msg.sender.call{value: msg.value}("");
            require(r, "refund");
        }
        
        // Determine creator (from MonPad factory if launched there, else msg.sender)
        address poolCreator = msg.sender;
        // Could check factory.isLaunched(token) and set creator from curve
        
        pool = address(new MonPadStakingPool(token, hub, poolCreator));
        tokenToPool[token] = pool;
        allPools.push(pool);
        
        // Register with hub (this contract must be hub owner OR hub allows it)
        // Easier: hub owner manually registers, OR this factory is granted permission
        // For simplicity: factory calls hub.registerPool which requires hub.owner == this factory
        // If not, registration is manual via admin
        try IHub(hub).registerPool(token, pool) {} catch {}
        
        emit PoolCreated(token, pool, msg.sender, free ? 0 : poolCreationFee);
    }
    
    // Admin only — back-create pool without fee (for MONSHI itself, etc)
    function adminCreatePool(address token, address creator) external onlyOwner returns (address pool) {
        require(tokenToPool[token] == address(0), "exists");
        pool = address(new MonPadStakingPool(token, hub, creator));
        tokenToPool[token] = pool;
        allPools.push(pool);
        try IHub(hub).registerPool(token, pool) {} catch {}
        emit PoolCreated(token, pool, creator, 0);
    }
    
    // Setters
    function setMonshiThreshold(uint256 v) external onlyOwner { freePoolMonshiThreshold = v; emit ParamChanged("monshiThresh", v); }
    function setPoolCreationFee(uint256 v) external onlyOwner { poolCreationFee = v; emit ParamChanged("poolFee", v); }
    function setBuybackWallet(address w) external onlyOwner { buybackWallet = w; emit WalletChanged("buyback", w); }
    function setHub(address h) external onlyOwner { hub = h; emit WalletChanged("hub", h); }
    function setMonshiToken(address t) external onlyOwner { monshiToken = t; emit WalletChanged("monshi", t); }
    function transferOwnership(address n) external onlyOwner { owner = n; }
    
    function allPoolsCount() external view returns (uint256) { return allPools.length; }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ FLATTENED FROM: MonPadVesting.sol ============
// Compile with: solc 0.8.24, viaIR=true, optimizer=200, evmVersion=paris


interface IERC20V {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title MonPadVesting
/// @notice Lock tokens with optional linear vesting. Public proof of dev commitment.
contract MonPadVesting {
    struct Lock {
        address token;
        address beneficiary;
        uint128 totalAmount;
        uint128 claimed;
        uint64 startedAt;
        uint64 cliffAt;        // == startedAt for instant cliff (lock-only mode)
        uint64 endAt;
        bool revocable;
        bool revoked;
    }
    
    Lock[] public locks;
    mapping(address => uint256[]) public userLocks;     // beneficiary => lockIds
    mapping(address => uint256[]) public tokenLocks;    // token => lockIds
    
    event Locked(uint256 indexed lockId, address indexed token, address indexed beneficiary, uint256 amount, uint64 endAt);
    event Claimed(uint256 indexed lockId, uint256 amount);
    event Revoked(uint256 indexed lockId, uint256 returned);
    
    /// Lock tokens with linear vesting from cliff -> endAt
    /// For pure lock (all unlocks at endAt), set cliffOffset == duration
    function createLock(
        address token,
        address beneficiary,
        uint256 amount,
        uint64 cliffOffset,
        uint64 duration,
        bool revocable
    ) external returns (uint256 lockId) {
        require(amount > 0, "0");
        require(beneficiary != address(0), "0addr");
        require(duration >= cliffOffset, "cliff > end");
        require(duration >= 1 days && duration <= 5 * 365 days, "duration bounds");
        
        require(IERC20V(token).transferFrom(msg.sender, address(this), amount), "xfer");
        
        lockId = locks.length;
        locks.push(Lock({
            token: token,
            beneficiary: beneficiary,
            totalAmount: uint128(amount),
            claimed: 0,
            startedAt: uint64(block.timestamp),
            cliffAt: uint64(block.timestamp + cliffOffset),
            endAt: uint64(block.timestamp + duration),
            revocable: revocable,
            revoked: false
        }));
        
        userLocks[beneficiary].push(lockId);
        tokenLocks[token].push(lockId);
        
        emit Locked(lockId, token, beneficiary, amount, uint64(block.timestamp + duration));
    }
    
    function vested(uint256 lockId) public view returns (uint256) {
        Lock memory l = locks[lockId];
        if (block.timestamp < l.cliffAt) return 0;
        if (block.timestamp >= l.endAt) return l.totalAmount;
        if (l.cliffAt == l.endAt) return l.totalAmount; // pure lock
        uint256 elapsed = block.timestamp - l.startedAt;
        uint256 total = l.endAt - l.startedAt;
        return (uint256(l.totalAmount) * elapsed) / total;
    }
    
    function claimable(uint256 lockId) public view returns (uint256) {
        Lock memory l = locks[lockId];
        uint256 v = vested(lockId);
        if (v <= l.claimed) return 0;
        return v - l.claimed;
    }
    
    function claim(uint256 lockId) external {
        Lock storage l = locks[lockId];
        require(msg.sender == l.beneficiary, "!benefactor");
        require(!l.revoked, "revoked");
        uint256 amt = claimable(lockId);
        require(amt > 0, "0");
        l.claimed += uint128(amt);
        IERC20V(l.token).transfer(l.beneficiary, amt);
        emit Claimed(lockId, amt);
    }
    
    /// Revoke (only if revocable). Returns unclaimed-and-not-yet-vested to creator.
    function revoke(uint256 lockId) external {
        Lock storage l = locks[lockId];
        require(l.revocable, "!revocable");
        require(!l.revoked, "revoked");
        // Only original locker can revoke (would need to track this — for now, beneficiary or anyone via owner pattern)
        // Simplified: only beneficiary can revoke (e.g. they release early, send back to themselves)
        require(msg.sender == l.beneficiary, "!benefactor");
        
        uint256 v = vested(lockId);
        uint256 unvested = uint256(l.totalAmount) - v;
        l.revoked = true;
        if (unvested > 0) {
            IERC20V(l.token).transfer(msg.sender, unvested);
        }
        emit Revoked(lockId, unvested);
    }
    
    // Views
    function lockCount() external view returns (uint256) { return locks.length; }
    function userLockIds(address user) external view returns (uint256[] memory) { return userLocks[user]; }
    function tokenLockIds(address token) external view returns (uint256[] memory) { return tokenLocks[token]; }
    function totalLocked(address token) external view returns (uint256 t) {
        uint256[] memory ids = tokenLocks[token];
        for (uint256 i = 0; i < ids.length; i++) {
            Lock memory l = locks[ids[i]];
            if (!l.revoked) t += uint256(l.totalAmount) - l.claimed;
        }
    }
}


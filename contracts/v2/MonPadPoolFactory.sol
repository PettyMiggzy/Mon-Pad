// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MonPadStakingPool.sol";

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
        
        // Public pools always have burnsToCreator=false → burn vault routes to DEAD (anti-rug)
        pool = address(new MonPadStakingPool(token, hub, poolCreator, false));
        tokenToPool[token] = pool;
        allPools.push(pool);
        
        // Register with hub (this contract must be hub owner OR hub allows it)
        // Easier: hub owner manually registers, OR this factory is granted permission
        // For simplicity: factory calls hub.registerPool which requires hub.owner == this factory
        // If not, registration is manual via admin
        try IHub(hub).registerPool(token, pool) {} catch {}
        
        emit PoolCreated(token, pool, msg.sender, free ? 0 : poolCreationFee);
    }
    
    // Admin only — back-create pool without fee (for MONSHI itself, etc).
    // burnsToCreator=true ONLY for MONSHI pool (vault routes to creator/buyback instead of DEAD).
    function adminCreatePool(address token, address creator, bool burnsToCreator) external onlyOwner returns (address pool) {
        require(tokenToPool[token] == address(0), "exists");
        pool = address(new MonPadStakingPool(token, hub, creator, burnsToCreator));
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

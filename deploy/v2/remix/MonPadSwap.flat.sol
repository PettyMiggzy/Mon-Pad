// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============ FLATTENED FROM: MonPadSwap.sol ============
// Compile with: solc 0.8.24, viaIR=true, optimizer=200, evmVersion=paris


interface IUniswapV2Router {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    function WETH() external view returns (address);
}

interface IERC20S {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

/// @title MonPadSwap
/// @notice Wrapper around an existing DEX router. Adds platform fee (default 0.3%) → buyback.
contract MonPadSwap {
    address public owner;
    address public router;          // underlying DEX router (e.g. Crust, Uniswap)
    address public WMON;            // wrapped MON
    address public buybackWallet;
    uint16 public platformFeeBps = 30; // 0.3%
    
    bool public paused;
    
    event SwappedETHForToken(address indexed user, address indexed token, uint256 monIn, uint256 fee);
    event SwappedTokenForETH(address indexed user, address indexed token, uint256 amountIn, uint256 fee);
    event SwappedTokenForToken(address indexed user, address indexed tokIn, address indexed tokOut, uint256 amtIn, uint256 fee);
    
    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }
    modifier notPaused() { require(!paused, "paused"); _; }
    
    constructor(address _router, address _wmon, address _buyback) {
        owner = msg.sender;
        router = _router;
        WMON = _wmon;
        buybackWallet = _buyback;
    }
    
    /// Swap MON for any token
    function swapMONForToken(address tokenOut, uint256 minOut, uint256 deadline) external payable notPaused {
        require(msg.value > 0, "0");
        uint256 fee = (msg.value * platformFeeBps) / 10000;
        uint256 swapAmount = msg.value - fee;
        
        // Send fee to buyback
        if (fee > 0) {
            (bool ok, ) = buybackWallet.call{value: fee}("");
            require(ok, "fee fail");
        }
        
        address[] memory path = new address[](2);
        path[0] = WMON;
        path[1] = tokenOut;
        
        IUniswapV2Router(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: swapAmount}(
            minOut, path, msg.sender, deadline
        );
        
        emit SwappedETHForToken(msg.sender, tokenOut, msg.value, fee);
    }
    
    /// Swap any token for MON
    function swapTokenForMON(address tokenIn, uint256 amountIn, uint256 minOut, uint256 deadline) external notPaused {
        require(amountIn > 0, "0");
        require(IERC20S(tokenIn).transferFrom(msg.sender, address(this), amountIn), "xfer");
        IERC20S(tokenIn).approve(router, amountIn);
        
        // Track balance before
        uint256 before = address(this).balance;
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = WMON;
        
        IUniswapV2Router(router).swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountIn, minOut, path, address(this), deadline
        );
        
        uint256 received = address(this).balance - before;
        uint256 fee = (received * platformFeeBps) / 10000;
        uint256 toUser = received - fee;
        
        if (fee > 0) {
            (bool ok, ) = buybackWallet.call{value: fee}("");
            require(ok, "fee fail");
        }
        (bool sent, ) = msg.sender.call{value: toUser}("");
        require(sent, "send fail");
        
        emit SwappedTokenForETH(msg.sender, tokenIn, amountIn, fee);
    }
    
    /// Token to token (via WMON intermediate)
    function swapTokenForToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 deadline
    ) external notPaused {
        require(amountIn > 0, "0");
        require(IERC20S(tokenIn).transferFrom(msg.sender, address(this), amountIn), "xfer");
        IERC20S(tokenIn).approve(router, amountIn);
        
        address[] memory path = new address[](3);
        path[0] = tokenIn;
        path[1] = WMON;
        path[2] = tokenOut;
        
        // Take fee from input
        uint256 fee = (amountIn * platformFeeBps) / 10000;
        uint256 swapAmount = amountIn - fee;
        // Send fee tokens to buyback
        if (fee > 0) IERC20S(tokenIn).transfer(buybackWallet, fee);
        
        IUniswapV2Router(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapAmount, minOut, path, msg.sender, deadline
        );
        
        emit SwappedTokenForToken(msg.sender, tokenIn, tokenOut, amountIn, fee);
    }
    
    // Admin
    function setRouter(address r) external onlyOwner { router = r; }
    function setWMON(address w) external onlyOwner { WMON = w; }
    function setBuybackWallet(address w) external onlyOwner { buybackWallet = w; }
    function setPlatformFeeBps(uint16 v) external onlyOwner { require(v <= 300, "max 3%"); platformFeeBps = v; }
    function setPaused(bool v) external onlyOwner { paused = v; }
    function transferOwnership(address n) external onlyOwner { owner = n; }
    
    // Rescue stuck tokens (admin only)
    function rescueToken(address token, address to) external onlyOwner {
        IERC20S(token).transfer(to, IERC20S(token).balanceOf(address(this)));
    }
    function rescueETH(address to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "fail");
    }
    
    receive() external payable {}
}


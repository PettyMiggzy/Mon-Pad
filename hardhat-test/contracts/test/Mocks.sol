// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ------------------------------------------------------------------ */
/*  Test-only mocks used by hardhat-test/test/v21-flow.js              */
/*  Not part of the production V2.1 contract set.                      */
/* ------------------------------------------------------------------ */

interface IToken {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Stand-in for MonPadGraduator that records inputs without touching Uniswap V3.
///         Lets us drive Curve._graduate end-to-end on a vanilla hardhat node.
contract MockGraduator {
    mapping(address => uint256) public lastMonReceived;
    mapping(address => uint256) public lastTokensReceived;
    mapping(address => bool) public graduated;
    bool public revertOnGraduate;

    event MockGraduated(address indexed token, uint256 monIn, uint256 tokenIn);

    function setRevert(bool v) external { revertOnGraduate = v; }

    function onGraduate(address token, uint256 /*lpTokens*/) external payable {
        require(!revertOnGraduate, "MockGraduator: forced revert");
        lastMonReceived[token] = msg.value;
        lastTokensReceived[token] = IToken(token).balanceOf(address(this));
        graduated[token] = true;
        emit MockGraduated(token, msg.value, lastTokensReceived[token]);
    }

    receive() external payable {}
}

/// @notice Stand-in for the Uniswap V3 NonfungiblePositionManager. Exposes `factory()`
///         so MonPadGraduator's constructor (which reads NPM.factory()) succeeds.
///         Does NOT implement mint/safeTransferFrom — tests that exercise the real
///         Graduator never call onGraduate end-to-end (auth check reverts first).
contract MockNPM {
    address public immutable factory;
    constructor(address _factory) { factory = _factory; }
}

/// @notice Minimal Uniswap V3 factory stub for MonPadGraduator constructor.
contract MockUniV3Factory {
    function getPool(address, address, uint24) external pure returns (address) { return address(0); }
    function createPool(address, address, uint24) external pure returns (address) { return address(0x1); }
}

/// @notice Minimal WMON for MonPadGraduator constructor.
contract MockWMON {
    mapping(address => uint256) public balanceOf;
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function approve(address, uint256) external pure returns (bool) { return true; }
    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// @notice ERC20 stub used as MONSHI in tests. Open mint so tests can fund any wallet.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _n, string memory _s) { name = _n; symbol = _s; }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allowance");
            allowance[from][msg.sender] = a - amount;
        }
        require(balanceOf[from] >= amount, "bal");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}


// --- V2.1 BATCH 4: Malicious reward router for T17 reentrancy test ---
interface ICurveSell {
    function sell(uint256 tokensIn, uint256 minMonOut) external returns (uint256);
}

contract MaliciousRewardRouter {
    address public target;
    bool public reentryAttempted;
    bool public reentryReverted;
    uint256 public lastReentryAttemptTokens;

    function setTarget(address t) external { target = t; }

    // Stub IStakingHub.setCurveAuthorized so factory _applySetRewardRouter does not revert
    function setCurveAuthorized(address /*c*/, bool /*ok*/) external pure {}

    // Matches the signature curve calls: notifyReward(address)
    function notifyReward(address /*token*/) external payable {
        if (target == address(0)) return;
        reentryAttempted = true;
        lastReentryAttemptTokens = 1;
        // Try to reenter sell with 1 wei tokensIn. Expect revert from nonReentrant.
        try ICurveSell(target).sell(1, 0) returns (uint256) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }

    receive() external payable {}
}

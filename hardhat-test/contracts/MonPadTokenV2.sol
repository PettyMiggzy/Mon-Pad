// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MonPadTokenV2
/// @notice ERC20 token launched by MonPad. All supply minted to curve at deploy.
contract MonPadTokenV2 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    
    address public curve;
    address public factory;
    bool private _curveSet;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint256 _supply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        factory = msg.sender;
        // Mint full supply to factory temporarily — factory transfers to curve in setCurve
        balanceOf[msg.sender] = _supply;
        emit Transfer(address(0), msg.sender, _supply);
    }
    
    function setCurve(address _curve) external {
        require(msg.sender == factory && !_curveSet, "set");
        curve = _curve;
        _curveSet = true;
        // Move all supply to curve
        uint256 bal = balanceOf[factory];
        balanceOf[factory] = 0;
        balanceOf[_curve] = bal;
        emit Transfer(factory, _curve, bal);
    }
    
    function transfer(address to, uint256 amt) external returns (bool) {
        return _transfer(msg.sender, to, amt);
    }
    
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amt, "!allowance");
            allowance[from][msg.sender] = a - amt;
        }
        return _transfer(from, to, amt);
    }
    
    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }
    
    function _transfer(address from, address to, uint256 amt) internal returns (bool) {
        require(to != address(0), "!to");
        require(balanceOf[from] >= amt, "!bal");
        unchecked {
            balanceOf[from] -= amt;
            balanceOf[to] += amt;
        }
        emit Transfer(from, to, amt);
        return true;
    }
}

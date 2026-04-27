// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MonPadToken
 * @notice Standard ERC20 minted to the curve. Curve handles all distribution.
 */
contract MonPadToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public immutable curve;
    address public immutable factory;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _supply, address _curve) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        curve = _curve;
        factory = msg.sender;
        balanceOf[_curve] = _supply;
        emit Transfer(address(0), _curve, _supply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allowance");
            allowance[from][msg.sender] = a - amount;
        }
        _transfer(from, to, amount);
        return true;
    }
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to=0");
        require(balanceOf[from] >= amount, "balance");
        unchecked { balanceOf[from] -= amount; balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
    }
}

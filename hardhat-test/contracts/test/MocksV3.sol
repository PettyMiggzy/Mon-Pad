// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ------------------------------------------------------------------ */
/*  Test-only mocks for the native-MON V3 set.                        */
/*  MockWMON: full ERC20 + deposit/withdraw so the functional NPM     */
/*  (MockNPMM in MocksMonshi.sol) can pull WMON via transferFrom and  */
/*  the real MonPadGraduatorV3 can be driven end-to-end.              */
/* ------------------------------------------------------------------ */

contract MockWMONV3 {
    string public name = "Wrapped MON (mock)";
    string public symbol = "WMON";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }
    receive() external payable { deposit(); }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "bal");
        balanceOf[msg.sender] -= wad;
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "send");
        emit Withdrawal(msg.sender, wad);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= amount, "allowance");
            allowance[from][msg.sender] = a - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

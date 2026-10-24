// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only USDC stand-in: block transfers to a configured recipient (e.g. PoolManager) to simulate mid-swap failure.
contract MockBlockableUsdc is ERC20 {
    address public blockRecipient;
    bool public blockEnabled;

    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function configureBlock(address recipient, bool enabled) external {
        blockRecipient = recipient;
        blockEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blockEnabled && to == blockRecipient && from != address(0)) {
            revert("MockUSDC: transfer blocked");
        }
        super._update(from, to, value);
    }
}

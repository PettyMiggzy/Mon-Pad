// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Clean launched token: fixed supply minted once to the launcher, no owner, no mint,
/// no tax, no blacklist, no pause, no transfer restrictions. Bots and snipers are welcome.
contract MonpadToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address to) ERC20(name_, symbol_) {
        _mint(to, supply);
    }
}

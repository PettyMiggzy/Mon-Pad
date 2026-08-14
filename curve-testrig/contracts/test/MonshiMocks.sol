// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for MONSHI (an 18-decimal ERC20 behind an EIP-1167 clone on mainnet).
contract MockMonshi is ERC20 {
    constructor() ERC20("MONSHI", "MONSHI") {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @notice Stand-in for nad.fun's DEX router, reproducing the behaviour observed against the live contract at
/// 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137:
///   - `buy` is payable and takes native MON (no WMON wrapping)
///   - a zero `amountOutMin` reverts `InvalidAmountOut()` (selector 0x4e969c58)
///   - an unmeetable bound reverts `InsufficientOutput()` (selector 0xbb2875c3)
///   - the bought token is delivered to `to`, which may be the burn address
/// Price is a settable linear rate so tests can drive slippage deterministically.
contract MockNadDexRouter {
    struct BuyParams {
        uint256 amountOutMin;
        address token;
        address to;
        uint256 deadline;
    }

    error InvalidAmountOut();
    error InsufficientOutput();
    error DeadlineExpired();

    MockMonshi public immutable monshi;
    uint256 public rate; // tokens out per 1e18 MON in

    constructor(address monshi_, uint256 rate_) {
        monshi = MockMonshi(monshi_);
        rate = rate_;
    }

    function setRate(uint256 r) external {
        rate = r;
    }

    function buy(BuyParams calldata p) external payable returns (uint256 amountOut) {
        if (p.amountOutMin == 0) revert InvalidAmountOut();
        if (p.deadline < block.timestamp) revert DeadlineExpired();
        amountOut = (msg.value * rate) / 1e18;
        if (amountOut < p.amountOutMin) revert InsufficientOutput();
        monshi.mint(p.to, amountOut);
    }
}

/// @notice A recipient that always rejects MON — used to prove neither splitter leg can block the other.
contract RejectingRecipient {
    receive() external payable {
        revert("no");
    }
}

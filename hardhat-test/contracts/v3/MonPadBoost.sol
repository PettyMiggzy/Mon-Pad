// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title MonPadBoost
 * @notice Pay-to-trend for the Mon-Pad trending bot. A project calls
 *         `boost(token)` with MON; the payment is forwarded to the treasury and a
 *         `Boosted` event is emitted. The Telegram bot watches `Boosted` and grants
 *         trending time proportional to the amount paid. The token address is an
 *         explicit argument, so a payment always maps to exactly one token.
 * @dev    Deliberately minimal: no funds are ever held here (forwarded in the same
 *         call), no per-token storage — the bot is the source of truth for active
 *         boosts, reconstructable from the event log.
 */
contract MonPadBoost {
    address public owner;
    address public pendingOwner;
    address public treasury;     // receives all boost payments
    uint256 public minBoostWei;  // minimum accepted payment

    event Boosted(address indexed token, address indexed payer, uint256 amount, uint256 timestamp);
    event TreasuryChanged(address indexed treasury);
    event MinBoostChanged(uint256 minBoostWei);
    event OwnershipTransferStarted(address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }

    constructor(address _treasury, uint256 _minBoostWei) {
        require(_treasury != address(0), "treasury=0");
        owner = msg.sender;
        treasury = _treasury;
        minBoostWei = _minBoostWei;
        emit TreasuryChanged(_treasury);
        emit MinBoostChanged(_minBoostWei);
    }

    /// @notice Pay MON to boost `token` into the trending feed. Amount → trend time.
    function boost(address token) external payable {
        require(token != address(0), "token=0");
        require(msg.value >= minBoostWei, "below min");
        emit Boosted(token, msg.sender, msg.value, block.timestamp);
        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "forward failed");
    }

    // ── admin ──────────────────────────────────────────────────────────────
    function setTreasury(address t) external onlyOwner { require(t != address(0), "treasury=0"); treasury = t; emit TreasuryChanged(t); }
    function setMinBoost(uint256 v) external onlyOwner { minBoostWei = v; emit MinBoostChanged(v); }
    function transferOwnership(address to) external onlyOwner { require(to != address(0), "to=0"); pendingOwner = to; emit OwnershipTransferStarted(to); }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
}

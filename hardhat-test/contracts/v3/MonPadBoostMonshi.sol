// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title MonPadBoostMonshi
 * @notice Pay-to-trend priced in $MONSHI. A project buys a fixed tier (e.g. 5M
 *         MONSHI → 48h, 10M → 5d); of the MONSHI paid, `burnBps` is burned (sent
 *         to dead) and the remainder goes to the treasury. Emits `Boosted` with
 *         the trend duration so the Mon-Pad bot + monpad.net can feature the token
 *         for exactly that long. This makes MONSHI a deflationary utility token.
 * @dev    Holds no funds — pull + split happen in the same call. Tiers are
 *         owner-configurable. Boost state (active/until) lives off-chain
 *         (bot/site), reconstructable from the `Boosted` log.
 */
contract MonPadBoostMonshi {
    address public owner;
    address public pendingOwner;
    address public treasury;                 // receives the non-burned share
    IERC20  public immutable monshi;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint16  public burnBps = 7000;           // 70% burned; remainder → treasury

    struct Tier { uint256 amount; uint32 durationSec; bool enabled; }
    Tier[] public tiers;

    event Boosted(
        address indexed token, address indexed payer, uint256 tierId,
        uint256 amount, uint32 durationSec, uint256 burned, uint256 toTreasury, uint256 timestamp
    );
    event TierSet(uint256 indexed tierId, uint256 amount, uint32 durationSec, bool enabled);
    event TreasuryChanged(address indexed treasury);
    event BurnBpsChanged(uint16 burnBps);
    event OwnershipTransferred(address indexed from, address indexed to);

    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }

    constructor(address _monshi, address _treasury) {
        require(_monshi != address(0) && _treasury != address(0), "zero addr");
        owner = msg.sender;
        monshi = IERC20(_monshi);
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
        // Seed the initial tiers (MONSHI has 18 decimals).
        tiers.push(Tier(5_000_000 ether, 48 hours, true));   // 5M MONSHI  → 48h
        tiers.push(Tier(10_000_000 ether, 5 days, true));    // 10M MONSHI → 5 days
    }

    function tierCount() external view returns (uint256) { return tiers.length; }

    /// @notice Buy a trending boost for `token` at `tierId`, paid in MONSHI.
    ///         Caller must approve this contract for the tier amount first.
    function boost(address token, uint256 tierId) external {
        require(token != address(0), "token=0");
        require(tierId < tiers.length, "bad tier");
        Tier memory t = tiers[tierId];
        require(t.enabled, "tier disabled");

        uint256 amt = t.amount;
        uint256 burnAmt = (amt * burnBps) / 10000;
        uint256 treAmt = amt - burnAmt;

        require(monshi.transferFrom(msg.sender, address(this), amt), "pull failed");
        if (burnAmt > 0) require(monshi.transfer(DEAD, burnAmt), "burn failed");
        if (treAmt > 0)  require(monshi.transfer(treasury, treAmt), "treasury failed");

        emit Boosted(token, msg.sender, tierId, amt, t.durationSec, burnAmt, treAmt, block.timestamp);
    }

    // ── admin ────────────────────────────────────────────────────────────────
    /// @notice Add (tierId == tiers.length) or update an existing tier.
    function setTier(uint256 tierId, uint256 amount, uint32 durationSec, bool enabled) external onlyOwner {
        require(amount > 0 && durationSec > 0, "bad params");
        if (tierId == tiers.length) tiers.push(Tier(amount, durationSec, enabled));
        else { require(tierId < tiers.length, "oob"); tiers[tierId] = Tier(amount, durationSec, enabled); }
        emit TierSet(tierId, amount, durationSec, enabled);
    }
    function setTreasury(address t) external onlyOwner { require(t != address(0), "0"); treasury = t; emit TreasuryChanged(t); }
    function setBurnBps(uint16 b) external onlyOwner { require(b <= 10000, "bps"); burnBps = b; emit BurnBpsChanged(b); }
    function transferOwnership(address to) external onlyOwner { require(to != address(0), "0"); pendingOwner = to; }
    function acceptOwnership() external { require(msg.sender == pendingOwner, "!pending"); emit OwnershipTransferred(owner, pendingOwner); owner = pendingOwner; pendingOwner = address(0); }
}

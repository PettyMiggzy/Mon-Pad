// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import {PadToken} from "../pads/PadToken.sol";
import {
    IUniswapV3Factory,
    INonfungiblePositionManager,
    IUniswapV3Pool,
    IWETH9
} from "../interfaces/IUniswapV3Minimal.sol";

/// @title RektPad — a research instrument for launch-visibility experiments
/// @notice A launchpad whose only purpose is to run CONTROLLED EXPERIMENTS on what makes a token launch get
/// picked up. It is not a product and it is not permissionless: only the owner and an owner-curated operator
/// set can launch.
///
/// WHY EVERY VARIABLE IS A PARAMETER. The reference pad this rig is designed to be comparable to
/// (0xD5F6c6Ab9B74Ef7211B683904FE85BF1f69C3d9A on Robinhood Chain) HARDCODED its seeding: all 6 of its launches
/// posted exactly 1,000,000,000 tokens and ZERO quote, so its launches differ only in dev-buy size — and
/// dev-buy size did not correlate with outcome (rank correlation ~0.2 over n=6; the second-largest dev buy
/// drew the fewest buyers). A pad that hardcodes a thing cannot test that thing. So every variable a chain
/// observer can see at launch is settable per launch: supply, decimals, name, symbol, sort side (via a mined
/// CREATE2 salt), fee tier, opening tick, both range bounds, seeded token, seeded quote, dev-buy size,
/// whether a dev buy happens at all, and who ends up holding the LP, the dev bag and the residual supply.
///
/// TWO DIMENSIONS ARE DELIBERATELY NOT VARIED, and this is a measured choice rather than an oversight:
///   1. `factory` / venue is an immutable constructor argument. Four V3 factories appear in the live feed and
///      they disagree on fee->tickSpacing; pooling them into one dataset is a worse failure than deploying a
///      second pad. Arm boundaries therefore fall on CONTRACT boundaries, and `factory` is emitted in every
///      row so a joined table can prove which venue a launch belongs to.
///   2. `sameTxAsBirth` is always true — the whole launch is ONE transaction. Of 66 mature births in the live
///      observational feed, 55 were seeded and 54 of those were seeded in the birth transaction. A staged
///      launch would land in a cell containing exactly ONE wild observation, so "delay" would be perfectly
///      confounded with "off-distribution transaction shape".
/// Also unfixable and worth stating: the reference pad's launch selector (0x4e60fe83) and its address cannot
/// be matched, so a bot keyed on either will not classify our launches as pad launches. That does not affect
/// the join (the watcher keys on POOL events), but it does mean the reference pad's 6 launches are a GEOMETRY
/// REFERENCE, not a control group.
///
/// WHAT THE OWNER KEY CAN DO — read this before choosing where to hold it. The owner can: add and revoke
/// operators (instantly, no timelock, because revoking a compromised hot key is a seconds-matter operation);
/// PROPOSE and, after RESCUE_TIMELOCK (2 days), COMMIT a new `rescueRecipient`; declare experiments; launch;
/// and transfer ownership (two-step, so a typo is inert until accepted). It CANNOT touch a live LP position —
/// the pad never holds one, because the position NFT is minted straight to its terminal owner — and it cannot
/// name a destination for a launch's value. `renounceOwnership` is disabled. Repointing `rescueRecipient` is
/// the owner's ONLY money-redirecting power, which is exactly why it is the only thing that is timelocked.
/// Hold and operate this key with root-admin security, not treasury-receiver security. PRIVATE_KEY in a .env
/// must only ever be an OPERATOR key.
///
/// WHAT A STOLEN OPERATOR KEY CAN DO: emit junk launch events (polluting the dataset) at its own expense.
/// That is all, and it is structural rather than merely bounded — launches are funded from `msg.value` so the
/// pad holds no standing float, no operator-callable function takes a destination address, and every value
/// sink is one of three fixed `Recipient` levels. `setOperator(key,false)` closes it in one owner tx.
contract RektPad is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------------

    /// @notice Value destinations. Deliberately an ENUM of three fixed levels rather than an address
    /// parameter: WHO holds the LP and WHO receives the dev bag are real observables that must stay variable,
    /// but an operator that can name a raw address is an operator that can drain. Three levels, zero new
    /// storage, and no owner transaction per sweep.
    enum Recipient {
        OPERATOR, // msg.sender (the launching operator)
        VAULT, // the immutable LP_VAULT set at deploy
        BURN // 0x...dEaD
    }

    /// @notice One experimental cell. 24 fields, all caller-supplied — see the contract header for why.
    struct LaunchParams {
        bytes32 experimentId; // keccak of a human label; must have been declared in an EARLIER tx
        bytes32 armId; // treatment cell, unique within experimentId
        uint32 replicate; // 1-based repeat index within the arm
        string name; // 1..64 bytes
        string symbol; // 1..64 bytes
        uint8 decimals; // 0..255, UNCAPPED on purpose (see A2 below)
        uint256 totalSupply; // RAW base units (1e27 == 1e9 tokens at 18dp, the reference pad's supply)
        bytes32 tokenSalt; // CREATE2 salt, mined off-chain to land the token on the wanted sort side
        bool wantTokenIsToken0; // asserted expectation for that salt
        uint24 fee; // hundredths of a bip; must be an ENABLED tier on this factory
        int24 openingTick; // POOL orientation; need NOT be spacing-aligned (initialize does not require it)
        int24 tickLower; // MUST be a multiple of tickSpacing
        int24 tickUpper; // MUST be a multiple of tickSpacing
        uint256 seedTokenAmount; // RAW token units, 1..totalSupply
        uint256 seedQuoteWei; // wei of WETH; 0 is the reference pad's regime and a first-class level
        uint256 seedTokenMin; // slippage floor; MUST be STRICTLY below seedTokenAmount
        uint256 seedQuoteMin; // slippage floor
        Recipient lpTo; // where the position NFT goes
        uint256 devBuyQuoteWei; // wei; 0 == no dev buy, a RECORDED LEVEL not a null
        uint256 devBuyMinTokensOut; // RAW token units
        uint160 devBuySqrtPriceLimitX96; // 0 == use the extreme bound for the direction
        Recipient devBuyTo; // dev bag destination — this is the Swap log's topic2 `buyer`
        Recipient residualTo; // where totalSupply - seedPulled goes
        uint64 deadline; // unix seconds
    }

    /// @notice The full observational row for one launch. FIELD ORDER IS FROZEN: topic0 of `Launched`
    /// depends on it, and a reorder silently breaks every consumer that already decoded a log. A schema
    /// change means a NEW PAD INSTANCE and a new arm boundary, never an edit in place.
    ///
    /// Units are chosen to match scripts/watch-launches.cjs EXACTLY so pad rows and wild rows join without a
    /// conversion step: `seedAmount0/1` are the RAW amounts the watcher reads out of the pool's first Mint,
    /// `devBuyAmount0/1` are SIGNED as the Swap log carries them, `fee` is hundredths of a bip, ticks are V3
    /// ticks in pool orientation.
    struct LaunchRecord {
        address pool; // JOIN KEY — equals watcher birth.pool
        address factory; // equals birth.factory. Emitted although immutable: four factories are in the feed
        address quoteToken;
        bool tokenIsToken0; // with token + quoteToken this reconstructs birth.token0 / birth.token1
        uint24 fee; // == birth.fee
        int24 tickSpacing; // == birth.tickSpacing; READ from the factory, never hardcoded
        int24 openingTick; // ACHIEVED (asserted equal to requested, or the launch reverted)
        int24 tickLower;
        int24 tickUpper;
        uint256 requestedSeedToken;
        uint256 requestedSeedQuote;
        uint256 seedAmount0; // ACHIEVED. MUST equal watcher seed.amount0 exactly.
        uint256 seedAmount1; // ACHIEVED. MUST equal watcher seed.amount1 exactly.
        uint128 seedLiquidity; // == the Mint event's liquidity field
        uint256 positionId;
        address lpRecipient; // resolved from Recipient
        uint256 requestedDevBuyQuote;
        bool devBought; // false is a LEVEL, not a null
        int256 devBuyAmount0; // SIGNED, as the Swap log carries it
        int256 devBuyAmount1;
        address devBuyRecipient; // == watcher devbuy.buyer (Swap topic2)
        uint256 totalSupply;
        uint8 decimals;
        uint256 residualTokens;
        address residualTo;
        uint256 nativeIn; // msg.value — makes the no-standing-float property auditable from logs alone
        uint256 nativeRefunded;
        bytes32 experimentId;
        bytes32 armId;
        uint32 replicate;
        address operator; // WHICH key fired it, so a sweep from a different machine stays attributable
        string name;
        string symbol;
    }

    /// @dev Internal working set. A memory struct rather than 11 locals so the geometry can be computed once
    /// and shared by `launch` and `previewLaunch` without drifting apart.
    struct Plan {
        address token; // CREATE2-predicted
        address token0;
        address token1;
        bool tokenIsToken0;
        int24 spacing;
        uint160 sqrtStart;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address predictedPool; // address(0) when POOL_INIT_CODE_HASH == 0 (getPool fallback)
    }

    /// @dev Achieved results, carried from the execution phases into the event builder.
    struct Res {
        address pool;
        uint256 positionId;
        uint128 seedLiquidity;
        uint256 seedAmount0;
        uint256 seedAmount1;
        int256 devBuyAmount0;
        int256 devBuyAmount1;
        uint256 residualTokens;
        address residualTo;
        address lpRecipient;
        address devBuyRecipient;
        uint256 refund;
    }

    // ---------------------------------------------------------------------------------------------------
    // Immutables, constants, storage
    // ---------------------------------------------------------------------------------------------------

    uint256 public immutable EXPECTED_CHAIN_ID;
    IUniswapV3Factory public immutable FACTORY;
    INonfungiblePositionManager public immutable NPM;
    IWETH9 public immutable WETH;
    /// @notice The non-operator destination level. MAY be BURN_ADDRESS; may NOT be zero.
    address public immutable LP_VAULT;
    /// @notice Offsets this pad's launch ids clear of the reference pad's 3..8 so the join key is unambiguous.
    uint256 public immutable START_LAUNCH_ID;
    /// @notice CREATE2 init code hash of the venue's pool. 0 == unmeasured, verify via factory.getPool instead.
    /// @dev A constructor immutable rather than a constant so the assertion is exercisable against a mock
    /// (whose pool bytecode can never hash to the canonical 0xe34f199b...) AND deployable against a fork whose
    /// hash has not been measured.
    bytes32 public immutable POOL_INIT_CODE_HASH;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant RESCUE_TIMELOCK = 2 days;

    /// @dev keccak256("RektPad.swapPool"). MUST be a literal uint256: solc rejects a
    /// `bytes32 constant X = keccak256(...)` inside inline assembly ("Only direct number constants ... are
    /// supported"), and the latch is read with `tload`.
    uint256 private constant SWAP_POOL_SLOT = 0xa894fe7419a48581a5a3a149af14226b29f433ecc568d25833b609745d234f0c;

    mapping(address => bool) public isOperator;

    address public rescueRecipient;
    address public pendingRescueRecipient;
    uint256 public pendingRescueEta; // 0 == no proposal

    uint256 public launchCount;
    mapping(uint256 => address) public tokenOfLaunch;
    mapping(address => uint256) public launchOfToken; // 0 == never launched

    // ---------------------------------------------------------------------------------------------------
    // Events — SCHEMA FROZEN ONCE THE FIRST LAUNCH FIRES
    // ---------------------------------------------------------------------------------------------------

    /// @notice The pad's ONE launch log. Topic layout mirrors the reference pad's own event (sequential id in
    /// topic1, token in topic2, creator in topic3) so both datasets index the same way.
    event Launched(uint256 indexed launchId, address indexed token, address indexed creator, LaunchRecord record);

    /// @notice Pre-registration. Emitted in its OWN transaction, deliberately: the launch tx then carries
    /// exactly one pad log, and the hypothesis is on-chain and timestamped BEFORE any launch in the arm.
    /// Block order is itself the evidence that the design was not retrofitted to the result.
    event ExperimentDeclared(bytes32 indexed experimentId, address indexed declaredBy, string note);
    event OperatorSet(address indexed operator, bool allowed);
    event RescueRecipientProposed(address indexed recipient, uint256 eta);
    event RescueRecipientCommitted(address indexed recipient);
    event RescueProposalCancelled(address indexed recipient);
    /// @param asset address(0) == native
    event Swept(address indexed asset, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------------

    error NotOperator();
    error WrongChain();
    error Expired();
    error BadToken();
    error BadSeed();
    error BadMins();
    error FeeTierDisabled(uint24 fee);
    error TickNotAligned(int24 tick, int24 spacing);
    error TickOutOfBounds(int24 tick);
    error BadRange();
    /// @dev Names the numbers so a sweep runner can correct and retry instead of guessing at a bare revert.
    error RangeSideMismatch(uint256 need0, uint256 need1, uint256 got0, uint256 got1);
    error SortSideMismatch(address predicted, bool got);
    error AlreadyLaunched();
    error TokenAddressMismatch();
    error PoolAddressMismatch(address predicted, address got);
    error SpacingMismatch();
    /// @dev The pool already existed before this launch, so the launch would not be atomic.
    error PoolAlreadyExists();
    error PoolAlreadyInit(uint160 found);
    error InsufficientValue(uint256 need, uint256 got);
    error DevBuyTooLittleOut(uint256 got, uint256 min);
    error BadLimitSide();
    error ResidualNotCleared();
    error NotPool();
    error RefundFailed();
    error ZeroAddress();
    /// @dev CONSTRUCTOR-ONLY, all five. They cost zero runtime bytes (constructor code is not deployed) and
    /// they exist because every one of them names a mistake that is UNRECOVERABLE once made: the values they
    /// guard are immutables, so the only fix is a redeploy of a pad that has already been announced.
    error BadStartLaunchId();
    error NpmFactoryMismatch(address expected, address got);
    error NpmWeth9Mismatch(address expected, address got);
    error PoolProbeRequired();
    error PoolProbeNotCanonical(address probe, address viaFactory);
    error PoolInitCodeHashMismatch(address probe, address derived);
    error NoProposal();
    error TimelockNotElapsed(uint256 eta);
    error RenounceDisabled();
    error NothingToSweep();

    // ---------------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------------

    /// @param poolProbe_ An EXISTING pool at this venue, used once to bind `poolInitCodeHash_` and `factory_`
    /// to reality. REQUIRED whenever `poolInitCodeHash_` is nonzero; ignored (and conventionally address(0))
    /// in the unmeasured-hash mode, where per-launch getPool verification does the same job at runtime.
    /// On Robinhood Chain pass 0x479a1d0d9aec941382d9cab3ba69dd3914d981e9.
    /// @dev WHY A PROBE AND NOT A SCRIPT CHECK. Every argument below is frozen the instant this runs, and two
    /// of them (`factory_`, `poolInitCodeHash_`) are unverifiable by inspection: a wrong 32-byte hash deploys
    /// perfectly cleanly and then makes EVERY launch revert PoolAddressMismatch, which is discovered with real
    /// money on the table. A check in deploy-experiment-pad.js protects deploy-experiment-pad.js and nothing
    /// else — scripts/rehearse-arm.js and the fork test each carry their own hardcoded copies of these
    /// constants, and a hand deploy carries none. So the invariant lives HERE, inside the artifact that is
    /// actually immutable, where it cannot be routed around.
    constructor(
        address initialOwner,
        address rescueRecipient_,
        address lpVault_,
        address factory_,
        address npm_,
        address weth_,
        uint256 expectedChainId_,
        uint256 startLaunchId_,
        bytes32 poolInitCodeHash_,
        address poolProbe_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || rescueRecipient_ == address(0) || lpVault_ == address(0)
                || factory_ == address(0) || npm_ == address(0) || weth_ == address(0)
        ) revert ZeroAddress();
        // LP_VAULT is immutable and this contract exposes NO ERC721 surface, so a position NFT minted to
        // the pad itself would be permanently unrecoverable — no transfer path, no rescue path, no fix.
        // The zero-address check above does not catch it. This one line closes the only unrecoverable
        // fund-loss case in the contract.
        if (lpVault_ == address(this)) revert ZeroAddress();
        // The REAL wrong-network guard. hardhat.config.js defaults a live-mainnet RPC and wires PRIVATE_KEY
        // straight into it, so a `--network` typo is one keystroke from real money; a script-level gate
        // protects one script and is bypassed by any other. Checked HERE ONLY, not per launch: a wrong-network
        // deploy then costs a failed tx instead of a live pad, and re-checking every launch protects nothing.
        if (block.chainid != expectedChainId_) revert WrongChain();

        // START_LAUNCH_ID exists ONLY to keep this pad's ids clear of the reference pad's 3..8, so a zero
        // start defeats the entire point: launchId would be 0 + (++launchCount), i.e. 1,2,3... colliding head
        // on with the very ids the immutable was introduced to avoid. This is a BACKSTOP, not the fix — the
        // real failure is a JS defaulting bug (`BigInt(process.env.X ?? 1000n)` yields 0n for an
        // exported-but-empty var) and it belongs in the deploy script, because START_LAUNCH_ID=1 collides too
        // and no constant compiled in here can know the reference pad's id range. One line, no runtime cost.
        if (startLaunchId_ == 0) revert BadStartLaunchId();

        // VENUE COHERENCE, checked once, here, while it is still free. FACTORY, NPM and WETH are three
        // independent immutables that must describe ONE venue; the real NPM publishes its own view of two of
        // them, so ask it rather than trusting three separate constructor arguments to have been typed
        // consistently. Both selectors were probed on the live NPM before this was written (see
        // IUniswapV3Minimal), so the strict form cannot brick the intended deploy — and if a future venue's
        // NPM lacks them, this reverts loudly BEFORE any money is committed, which is the correct direction
        // to fail in.
        {
            address npmFactory = INonfungiblePositionManager(npm_).factory();
            if (npmFactory != factory_) revert NpmFactoryMismatch(factory_, npmFactory);
            address npmWeth = INonfungiblePositionManager(npm_).WETH9();
            if (npmWeth != weth_) revert NpmWeth9Mismatch(weth_, npmWeth);
        }

        // BIND THE INIT CODE HASH TO THE VENUE. `poolInitCodeHash_` is the one argument that is both
        // load-bearing on every launch and impossible to sanity-check by looking at it. Reading an EXISTING
        // pool's own (token0, token1, fee) and requiring BOTH
        //   (a) factory_.getPool(t0,t1,fee) == poolProbe_   — the factory admits it minted this pool, and
        //   (b) create2(factory_, keccak(abi.encode(t0,t1,fee)), poolInitCodeHash_) == poolProbe_
        // reproduces the address turns a 32-byte guess into a measured fact. (a) additionally proves
        // `factory_` is the factory that actually minted this venue's pools, which no amount of script-side
        // checking gets at. The two together are exactly the prediction `_predictPool` will make on every
        // launch, so if this passes, PoolAddressMismatch can only fire for a real front-run.
        //
        // NOTE the derivation goes through `_poolFor` with LOCALS, never the immutables: an immutable is not
        // readable during construction, so a version reading FACTORY/POOL_INIT_CODE_HASH here would not
        // compile. `_predictPool` calls the same helper, so the constructor and the hot path can never drift.
        if (poolInitCodeHash_ != bytes32(0)) {
            if (poolProbe_ == address(0)) revert PoolProbeRequired();
            address t0 = IUniswapV3Pool(poolProbe_).token0();
            address t1 = IUniswapV3Pool(poolProbe_).token1();
            uint24 probeFee = IUniswapV3Pool(poolProbe_).fee();
            address viaFactory = IUniswapV3Factory(factory_).getPool(t0, t1, probeFee);
            if (viaFactory != poolProbe_) revert PoolProbeNotCanonical(poolProbe_, viaFactory);
            address derived = _poolFor(factory_, poolInitCodeHash_, t0, t1, probeFee);
            if (derived != poolProbe_) revert PoolInitCodeHashMismatch(poolProbe_, derived);
        }

        FACTORY = IUniswapV3Factory(factory_);
        NPM = INonfungiblePositionManager(npm_);
        WETH = IWETH9(weth_);
        LP_VAULT = lpVault_;
        EXPECTED_CHAIN_ID = expectedChainId_;
        START_LAUNCH_ID = startLaunchId_;
        POOL_INIT_CODE_HASH = poolInitCodeHash_;

        rescueRecipient = rescueRecipient_;
        emit RescueRecipientCommitted(rescueRecipient_);
    }

    /// @dev Verbatim MonshiBuyback.onlyKeeper semantics, widened from one address to a set. The owner is
    /// IMPLICITLY an operator, so revoking every hot key can never lock the user out of their own rig.
    /// An operator can NOT grant operator — the role is flat and un-escalatable.
    modifier onlyOperator() {
        if (!isOperator[msg.sender] && msg.sender != owner()) revert NotOperator();
        _;
    }

    // ---------------------------------------------------------------------------------------------------
    // The launch
    // ---------------------------------------------------------------------------------------------------

    /// @notice Deploy the token, create + initialize the pool, seed the position, optionally dev-buy, dispose
    /// of the residual and emit one fully-specified observational row — ALL IN ONE TRANSACTION.
    /// @dev Atomicity is what makes the data joinable: the watcher classifies a Mint as the `seed` only if it
    /// is the pool's FIRST, and a Swap as a `devbuy` only when its tx hash equals the birth tx. Splitting the
    /// legs across transactions would record our launches as birth + an ordinary later `swap`, which cannot be
    /// compared to the wild population.
    ///
    /// There is NO try/catch anywhere in this function. A failed seed or a failed dev buy MUST revert the
    /// whole launch rather than be swallowed into a partially-configured pad; the front-run guard is a slot0
    /// read-back (Phase D), which is sufficient precisely because createAndInitializePoolIfNecessary is
    /// idempotent.
    function launch(LaunchParams calldata p)
        external
        payable
        onlyOperator
        nonReentrant
        returns (uint256 launchId, address token, address pool, uint256 positionId)
    {
        Plan memory pl = _preflight(p);

        // PHASE B — claim state BEFORE the first external call. The AlreadyLaunched guard above only closes
        // the door if the write lands before anything can re-enter; otherwise a callback could slip a second
        // launch of the same predicted token past it inside one transaction.
        unchecked {
            launchId = START_LAUNCH_ID + (++launchCount);
        }
        tokenOfLaunch[launchId] = pl.token;
        launchOfToken[pl.token] = launchId;

        // PHASE C — deploy. `new X{salt:}` produces exactly creationCode ++ abi.encode(args), which is what
        // A8 predicted, so a mismatch here means the prediction math drifted and nothing further is trustworthy.
        PadToken t = new PadToken{salt: p.tokenSalt}(p.name, p.symbol, p.decimals, p.totalSupply, address(this));
        if (address(t) != pl.token) revert TokenAddressMismatch();

        Res memory r;
        r.pool = _createAndVerifyPool(p, pl);
        _seed(p, pl, r, t);
        _devBuy(p, pl, r);
        _disposeResidual(p, r, t);
        _settleAndEmit(p, pl, r, launchId, t);

        return (launchId, pl.token, r.pool, r.positionId);
    }

    /// @dev PHASE A — every cheap invariant, before a single wei is at risk. Fail here, not on the seed call
    /// with a token already deployed and gas already spent.
    function _preflight(LaunchParams calldata p) internal view returns (Plan memory pl) {
        // A1
        if (p.deadline < block.timestamp) revert Expired();

        // A2 — token shape. NOTE: `decimals` is deliberately UNCAPPED. It is cosmetic to the AMM (all
        // liquidity math is on RAW base units and nothing can overflow because of it) but highly visible to
        // explorers, scanners and price bots — i.e. exactly the kind of variable this rig exists to test.
        // A `decimals <= 18` require would encode a hypothesis as a safety check.
        if (p.totalSupply == 0) revert BadToken();
        if (bytes(p.name).length == 0 || bytes(p.name).length > 64) revert BadToken();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 64) revert BadToken();

        // A3
        if (p.seedTokenAmount == 0 || p.seedTokenAmount > p.totalSupply) revert BadSeed();

        // A4 — liquidity is rounded DOWN and the amounts re-derived from it, so min == desired ALWAYS reverts.
        // Measured shortfalls on real launches: 5,442 wei (BRACKETS) and 9,651 wei (a token0-side pool).
        if (p.seedTokenMin >= p.seedTokenAmount) revert BadMins();
        if (p.seedQuoteWei > 0 && p.seedQuoteMin >= p.seedQuoteWei) revert BadMins();

        // A5 — READ the spacing. Never hardcode it: the factories on this chain disagree.
        pl.spacing = FACTORY.feeAmountTickSpacing(p.fee);
        if (pl.spacing == 0) revert FeeTierDisabled(p.fee);

        // A6
        if (p.tickLower >= p.tickUpper) revert BadRange();
        if (p.tickLower % pl.spacing != 0) revert TickNotAligned(p.tickLower, pl.spacing);
        if (p.tickUpper % pl.spacing != 0) revert TickNotAligned(p.tickUpper, pl.spacing);
        // MAX_TICK is 887272 but it must be FLOORED to the spacing: at spacing 200 the usable full range is
        // exactly [-887200, 887200], observed live at pool 0x479a1d0d9aec941382d9cab3ba69dd3914d981e9.
        if (p.tickLower < TickMath.minUsableTick(pl.spacing)) revert TickOutOfBounds(p.tickLower);
        if (p.tickUpper > TickMath.maxUsableTick(pl.spacing)) revert TickOutOfBounds(p.tickUpper);

        // A7 — the opening tick is NOT required to be spacing-aligned (initialize does not require it).
        if (p.openingTick < TickMath.MIN_TICK || p.openingTick > TickMath.MAX_TICK) {
            revert TickOutOfBounds(p.openingTick);
        }
        pl.sqrtStart = TickMath.getSqrtPriceAtTick(p.openingTick);

        // A8 — predict the token, derive the sort side from it, and branch everything downstream on that.
        // WETH is a low address (token0 in 93.63% of cached WETH pools) but NOT always: the reference pad
        // itself hit the inverted case on its 5th launch. A pad that assumes it silently mis-maps
        // amount0/amount1 and inverts its range roughly one launch in sixteen.
        pl.token = _predictToken(p);
        pl.tokenIsToken0 = uint160(pl.token) < uint160(address(WETH));
        if (pl.tokenIsToken0 != p.wantTokenIsToken0) revert SortSideMismatch(pl.token, pl.tokenIsToken0);
        if (launchOfToken[pl.token] != 0) revert AlreadyLaunched();
        (pl.token0, pl.token1) =
            pl.tokenIsToken0 ? (pl.token, address(WETH)) : (address(WETH), pl.token);

        // A9 — map amounts into POOL orientation. The single most common place to get a V3 launch backwards.
        (pl.amount0Desired, pl.amount1Desired) =
            pl.tokenIsToken0 ? (p.seedTokenAmount, p.seedQuoteWei) : (p.seedQuoteWei, p.seedTokenAmount);
        (pl.amount0Min, pl.amount1Min) =
            pl.tokenIsToken0 ? (p.seedTokenMin, p.seedQuoteMin) : (p.seedQuoteMin, p.seedTokenMin);

        // A10 — side condition. This is a DATA-INTEGRITY guard at least as much as a safety one: without it
        // a caller can request a quote seed the NPM silently never pulls, and the event would then record a
        // parameter level the chain never actually saw.
        //
        // Price direction flips with sort order and this is the easy-to-reverse one. A V3 tick encodes the
        // price of token1 per token0. With WETH as token0 (the common case) the tick counts TOKENS PER WETH,
        // so the token getting MORE valuable moves the tick DOWN — which is why BRACKETS opened at tick 206800
        // and seeded [46000, 206800], entirely at-or-below the open, so buy pressure walks INTO the range.
        // If the token sorts as token0 the whole geometry mirrors.
        //
        // The required sides come from the GEOMETRY ALONE, never from the funded amounts. Deriving them from
        // the amounts is the trap: `getLiquidityForAmounts` on a straddling range with a zero side returns
        // L = 0, so both "needs" come back 0 and a zero-quote straddle would sail through as consistent —
        // then mint zero liquidity and record a launch the chain never really saw.
        {
            uint160 sLo = TickMath.getSqrtPriceAtTick(p.tickLower);
            uint160 sHi = TickMath.getSqrtPriceAtTick(p.tickUpper);
            (uint128 liq, uint256 need0, uint256 need1) =
                _geometry(pl.sqrtStart, sLo, sHi, pl.amount0Desired, pl.amount1Desired);
            bool want0 = pl.sqrtStart < sHi; // token0 is consumed whenever the range extends ABOVE spot
            bool want1 = pl.sqrtStart > sLo; // token1 is consumed whenever the range extends BELOW spot
            if (want0 != (pl.amount0Desired > 0) || want1 != (pl.amount1Desired > 0) || liq == 0) {
                revert RangeSideMismatch(need0, need1, pl.amount0Desired, pl.amount1Desired);
            }
        }

        // A11
        if (POOL_INIT_CODE_HASH != bytes32(0)) {
            pl.predictedPool = _predictPool(pl.token0, pl.token1, p.fee);
        }

        // A12 — the pad holds NO standing float, so a stolen operator key spends the ATTACKER's ETH.
        uint256 need = p.seedQuoteWei + p.devBuyQuoteWei;
        if (msg.value < need) revert InsufficientValue(need, msg.value);

        // A13 — a limit on the wrong side of the opening price would make the swap a silent no-op.
        if (p.devBuyQuoteWei > 0 && p.devBuySqrtPriceLimitX96 != 0) {
            uint160 limit = p.devBuySqrtPriceLimitX96;
            bool zeroForOne = !pl.tokenIsToken0; // we are always SELLING the quote
            if (zeroForOne) {
                if (!(limit < pl.sqrtStart && limit > TickMath.MIN_SQRT_PRICE)) revert BadLimitSide();
            } else {
                if (!(limit > pl.sqrtStart && limit < TickMath.MAX_SQRT_PRICE)) revert BadLimitSide();
            }
        }
    }

    /// @dev PHASE D — create, initialize and VERIFY. The front-run risk is real and specific: an observer can
    /// see this tx in the mempool, recompute the CREATE2 token address, and pre-create the pool at a hostile
    /// price (the factory does not require the token to exist). createAndInitializePoolIfNecessary is
    /// idempotent, so it would happily return that hostile pool. A slot0 read-back catches it; a try/catch is
    /// NOT needed here and would be strictly worse.
    function _createAndVerifyPool(LaunchParams calldata p, Plan memory pl) internal returns (address pool) {
        // ATOMICITY IS THE INSTRUMENT'S CORE INVARIANT, so it is enforced here rather than assumed.
        // createAndInitializePoolIfNecessary is idempotent: handed an already-existing pool it silently
        // ADOPTS it, and the launch then produces no Initialize log in this transaction. The observational
        // pipeline keys a launch on `sameTxAsBirth` (scripts/watch-launches.cjs), so an adopted pool joins
        // as a pool that was never born — it lands in the ignored/control arm by accident, at whatever
        // price a stranger already set. Silently mislabelling a treated launch as a control is the one
        // failure that corrupts results rather than merely losing them.
        if (FACTORY.getPool(pl.token0, pl.token1, p.fee) != address(0)) revert PoolAlreadyExists();
        pool = NPM.createAndInitializePoolIfNecessary(pl.token0, pl.token1, p.fee, pl.sqrtStart);
        if (POOL_INIT_CODE_HASH != bytes32(0)) {
            if (pool != pl.predictedPool) revert PoolAddressMismatch(pl.predictedPool, pool);
        } else {
            address viaFactory = FACTORY.getPool(pl.token0, pl.token1, p.fee);
            if (pool != viaFactory) revert PoolAddressMismatch(viaFactory, pool);
        }
        if (IUniswapV3Pool(pool).tickSpacing() != pl.spacing) revert SpacingMismatch();
        (uint160 sqrtNow,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (sqrtNow != pl.sqrtStart) revert PoolAlreadyInit(sqrtNow);
    }

    /// @dev PHASE E — wrap, approve, mint, measure. Amounts are BALANCE DELTAS, not the NPM's return values:
    /// deltas are scoped to this call, so a pre-existing donated balance cannot distort them, and they are
    /// what the chain observer actually sees in the Mint event.
    ///
    /// The pad NEVER holds the position NFT — it is minted straight to its terminal owner, so no rescue path
    /// can reach a live experiment's liquidity, and that guarantee is checkable from the ABI rather than by
    /// trusting a sweep implementation.
    function _seed(LaunchParams calldata p, Plan memory pl, Res memory r, PadToken t) internal {
        if (p.seedQuoteWei > 0) {
            WETH.deposit{value: p.seedQuoteWei}();
            IERC20(address(WETH)).forceApprove(address(NPM), p.seedQuoteWei);
        }
        IERC20(address(t)).forceApprove(address(NPM), p.seedTokenAmount);

        uint256 tokBefore = t.balanceOf(address(this));
        uint256 wethBefore = WETH.balanceOf(address(this));

        r.lpRecipient = _resolve(p.lpTo);
        (r.positionId, r.seedLiquidity,,) = NPM.mint(
            INonfungiblePositionManager.MintParams({
                token0: pl.token0,
                token1: pl.token1,
                fee: p.fee,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: pl.amount0Desired,
                amount1Desired: pl.amount1Desired,
                amount0Min: pl.amount0Min,
                amount1Min: pl.amount1Min,
                recipient: r.lpRecipient,
                deadline: p.deadline
            })
        );

        uint256 tokPulled = tokBefore - t.balanceOf(address(this));
        uint256 quotePulled = wethBefore - WETH.balanceOf(address(this));

        IERC20(address(t)).forceApprove(address(NPM), 0);
        if (p.seedQuoteWei > 0) IERC20(address(WETH)).forceApprove(address(NPM), 0);

        (r.seedAmount0, r.seedAmount1) =
            pl.tokenIsToken0 ? (tokPulled, quotePulled) : (quotePulled, tokPulled);
        // Stash the unspent seed quote in the refund accumulator; Phase H turns it back into native.
        r.refund = p.seedQuoteWei - quotePulled;
    }

    /// @dev PHASE F — the optional dev buy, routed DIRECTLY at the pool rather than through a router. No
    /// SwapRouter was measured on this chain, and calling the pool directly puts the PAD in the Swap log's
    /// topic1 (`sender`), which gives free unforgeable attribution: every pad trade is recoverable from the
    /// observational feed alone by filtering on sender == pad, with no pad events and no trust in pad
    /// bookkeeping.
    function _devBuy(LaunchParams calldata p, Plan memory pl, Res memory r) internal {
        r.devBuyRecipient = _resolve(p.devBuyTo);
        if (p.devBuyQuoteWei == 0) return;

        WETH.deposit{value: p.devBuyQuoteWei}();
        bool zeroForOne = !pl.tokenIsToken0;
        uint160 limit = p.devBuySqrtPriceLimitX96 != 0
            ? p.devBuySqrtPriceLimitX96
            : (zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);

        address pool = r.pool;
        assembly ("memory-safe") {
            tstore(SWAP_POOL_SLOT, pool)
        }
        (r.devBuyAmount0, r.devBuyAmount1) = IUniswapV3Pool(pool).swap(
            r.devBuyRecipient,
            zeroForOne,
            int256(p.devBuyQuoteWei),
            limit,
            abi.encode(!pl.tokenIsToken0) // quoteIsToken0; trusted because the SENDER is latched
        );
        assembly ("memory-safe") {
            tstore(SWAP_POOL_SLOT, 0)
        }

        uint256 quoteIn = uint256(zeroForOne ? r.devBuyAmount0 : r.devBuyAmount1);
        uint256 tokensOut = uint256(-(zeroForOne ? r.devBuyAmount1 : r.devBuyAmount0));
        if (tokensOut < p.devBuyMinTokensOut) revert DevBuyTooLittleOut(tokensOut, p.devBuyMinTokensOut);
        // Nonzero only when a sqrtPriceLimit bound the swap before the full input was consumed.
        r.refund += p.devBuyQuoteWei - quoteIn;
    }

    /// @dev PHASE G — the pad provably ends every launch holding ZERO of the launched token, enforced as an
    /// equality on the way out. `revert`, never `assert`: a failed Panic would burn all remaining gas.
    function _disposeResidual(LaunchParams calldata p, Res memory r, PadToken t) internal {
        r.residualTo = _resolve(p.residualTo);
        r.residualTokens = t.balanceOf(address(this));
        if (r.residualTokens > 0) IERC20(address(t)).safeTransfer(r.residualTo, r.residualTokens);
        if (t.balanceOf(address(this)) != 0) revert ResidualNotCleared();
    }

    /// @dev PHASE H — unwrap the leftover quote, emit, then refund. CEI: the untrusted call is last.
    ///
    /// The refund is SCOPED ARITHMETIC and never a balance read. `launch()` reads address(this).balance
    /// exactly zero times, so donated native and donated WETH are provably untouched by a launch. Do NOT add
    /// `require(address(this).balance == 0)` — anyone can donate one wei and that would brick every future
    /// launch. Stranded value is the permissionless sweeps' job.
    function _settleAndEmit(LaunchParams calldata p, Plan memory pl, Res memory r, uint256 launchId, PadToken t)
        internal
    {
        uint256 leftover = r.refund;
        if (leftover > 0) WETH.withdraw(leftover);
        uint256 refund = msg.value - (p.seedQuoteWei + p.devBuyQuoteWei) + leftover;
        r.refund = refund;

        emit Launched(
            launchId,
            address(t),
            msg.sender,
            LaunchRecord({
                pool: r.pool,
                factory: address(FACTORY),
                quoteToken: address(WETH),
                tokenIsToken0: pl.tokenIsToken0,
                fee: p.fee,
                tickSpacing: pl.spacing,
                openingTick: p.openingTick,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                requestedSeedToken: p.seedTokenAmount,
                requestedSeedQuote: p.seedQuoteWei,
                seedAmount0: r.seedAmount0,
                seedAmount1: r.seedAmount1,
                seedLiquidity: r.seedLiquidity,
                positionId: r.positionId,
                lpRecipient: r.lpRecipient,
                requestedDevBuyQuote: p.devBuyQuoteWei,
                devBought: p.devBuyQuoteWei > 0,
                devBuyAmount0: r.devBuyAmount0,
                devBuyAmount1: r.devBuyAmount1,
                devBuyRecipient: r.devBuyRecipient,
                totalSupply: p.totalSupply,
                decimals: p.decimals,
                residualTokens: r.residualTokens,
                residualTo: r.residualTo,
                nativeIn: msg.value,
                nativeRefunded: refund,
                experimentId: p.experimentId,
                armId: p.armId,
                replicate: p.replicate,
                operator: msg.sender,
                name: p.name,
                symbol: p.symbol
            })
        );

        if (refund > 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    // ---------------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------------

    /// @notice Dry-run the geometry of one experimental cell in ONE eth_call.
    /// @dev Exists because the RPC budget is a hard constraint: the sweep runner mines salts in pure JS and
    /// then confirms an entire arm cell with a single call, instead of probing the venue per parameter.
    /// Touches no state, moves no value, is not access-controlled. It returns numbers where `launch` would
    /// revert on the side condition, so a mis-specified cell is READABLE rather than merely rejected.
    /// `amount0Achieved` / `amount1Achieved` are the EXACT amounts the mint will pull — not the requested
    /// amounts, which always come back short because liquidity is rounded down first. `liquidity == 0` means
    /// the cell is DEGENERATE (the funded sides do not match what the range needs at this opening tick), and
    /// in that case the two amounts name what each side WOULD have to be — so a mis-specified cell is fixable
    /// from one call rather than by bisecting a revert.
    function previewLaunch(LaunchParams calldata p)
        external
        view
        returns (
            address predictedToken,
            address predictedPool,
            bool tokenIsToken0,
            int24 tickSpacing,
            uint160 sqrtStart,
            uint128 liquidity,
            uint256 amount0Achieved,
            uint256 amount1Achieved
        )
    {
        tickSpacing = FACTORY.feeAmountTickSpacing(p.fee);
        if (tickSpacing == 0) revert FeeTierDisabled(p.fee);

        predictedToken = _predictToken(p);
        tokenIsToken0 = uint160(predictedToken) < uint160(address(WETH));
        (address token0, address token1) =
            tokenIsToken0 ? (predictedToken, address(WETH)) : (address(WETH), predictedToken);
        if (POOL_INIT_CODE_HASH != bytes32(0)) predictedPool = _predictPool(token0, token1, p.fee);
        else predictedPool = FACTORY.getPool(token0, token1, p.fee);

        sqrtStart = TickMath.getSqrtPriceAtTick(p.openingTick);
        (uint256 a0, uint256 a1) =
            tokenIsToken0 ? (p.seedTokenAmount, p.seedQuoteWei) : (p.seedQuoteWei, p.seedTokenAmount);
        (liquidity, amount0Achieved, amount1Achieved) = _geometry(
            sqrtStart, TickMath.getSqrtPriceAtTick(p.tickLower), TickMath.getSqrtPriceAtTick(p.tickUpper), a0, a1
        );
    }

    // ---------------------------------------------------------------------------------------------------
    // Callback
    // ---------------------------------------------------------------------------------------------------

    /// @notice Pay the quote leg of the dev-buy swap.
    /// @dev THE TRANSIENT LATCH IS THE WHOLE AUTHENTICATION AND IT IS SUFFICIENT. The pool address it holds is
    /// the one that already passed the CREATE2 (or getPool) assertion in Phase D, and the slot is ZERO outside
    /// a launch, so an unsolicited call can never match.
    ///
    /// Do NOT "harden" this by re-deriving the pool via CREATE2 here: that check already happened, and the
    /// duplicate is dead code that invites a future editor to delete the half that matters. Equally, do NOT
    /// fall back to the canonical periphery `verifyCallback` pattern — it proves only that msg.sender is *a*
    /// factory pool, and an attacker can create a genuine (attackerToken, WETH) pool through the real factory
    /// and call this with a fabricated positive delta to drain any stray WETH.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        address expected;
        assembly ("memory-safe") {
            expected := tload(SWAP_POOL_SLOT)
        }
        if (expected == address(0) || msg.sender != expected) revert NotPool();

        bool quoteIsToken0 = abi.decode(data, (bool));
        int256 owedSigned = quoteIsToken0 ? amount0Delta : amount1Delta;
        if (owedSigned <= 0) revert NotPool(); // we always PAY the quote side; anything else is malformed
        IERC20(address(WETH)).safeTransfer(msg.sender, uint256(owedSigned));
    }

    // ---------------------------------------------------------------------------------------------------
    // Governance / rescue
    // ---------------------------------------------------------------------------------------------------

    /// @notice Pre-register a hypothesis. A separate transaction on purpose — see the ExperimentDeclared doc.
    function declareExperiment(bytes32 experimentId, string calldata note) external onlyOwner {
        emit ExperimentDeclared(experimentId, msg.sender, note);
    }

    /// @notice Add or revoke a launching key. DELIBERATELY NOT TIMELOCKED: revoking a compromised hot key is
    /// a seconds-matter operation and a delay here would be catastrophic. This is the inverse of the usual
    /// instinct — the timelock belongs on the rescue recipient, which is the only money-redirecting power.
    function setOperator(address op, bool allowed) external onlyOwner {
        if (op == address(0)) revert ZeroAddress();
        isOperator[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    function proposeRescueRecipient(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        pendingRescueRecipient = r;
        pendingRescueEta = block.timestamp + RESCUE_TIMELOCK;
        emit RescueRecipientProposed(r, pendingRescueEta);
    }

    function commitRescueRecipient() external onlyOwner {
        uint256 eta = pendingRescueEta;
        if (eta == 0) revert NoProposal();
        if (block.timestamp < eta) revert TimelockNotElapsed(eta);
        address r = pendingRescueRecipient;
        rescueRecipient = r;
        pendingRescueRecipient = address(0);
        pendingRescueEta = 0;
        emit RescueRecipientCommitted(r);
    }

    function cancelRescueProposal() external onlyOwner {
        if (pendingRescueEta == 0) revert NoProposal();
        address r = pendingRescueRecipient;
        pendingRescueRecipient = address(0);
        pendingRescueEta = 0;
        emit RescueProposalCancelled(r);
    }

    /// @notice Move a stranded ERC-20 to `rescueRecipient`. PERMISSIONLESS, and that is the safer choice:
    /// it cannot choose a destination, so there is nothing to gain by calling it and nothing to lose by
    /// anyone being able to. It also keeps rescue available exactly when the operator key is the compromised
    /// thing and the owner key is on hardware in a drawer.
    /// @dev Token-AGNOSTIC because this pad launches arbitrary tokens and a hardcoded list cannot work. Safe
    /// only BECAUSE the destination is not a parameter. No in-flight guard is needed: `launch()` ends holding
    /// zero of the launched token, and both functions share the ReentrancyGuard lock, so a sweep can never
    /// fire mid-launch.
    function sweepStrandedToken(address asset) external nonReentrant returns (uint256 amount) {
        amount = IERC20(asset).balanceOf(address(this));
        if (amount == 0) revert NothingToSweep();
        address to = rescueRecipient;
        IERC20(asset).safeTransfer(to, amount);
        emit Swept(asset, to, amount);
    }

    function sweepStrandedNative() external nonReentrant returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert NothingToSweep();
        address to = rescueRecipient;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert RefundFailed();
        emit Swept(address(0), to, amount);
    }

    /// @notice Disabled. Dropping ownership to zero would freeze the operator set and the rescue destination
    /// forever, and this pad has strictly more to lose than the registry the precedent came from.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Required so WETH.withdraw can return native mid-launch. Deliberately unrestricted and unable
    /// to revert; donations are handled by sweepStrandedNative and are never asserted away.
    receive() external payable {}

    // ---------------------------------------------------------------------------------------------------
    // Internal pure helpers
    // ---------------------------------------------------------------------------------------------------

    function _resolve(Recipient r) internal view returns (address) {
        if (r == Recipient.OPERATOR) return msg.sender;
        if (r == Recipient.VAULT) return LP_VAULT;
        return BURN_ADDRESS;
    }

    function _predictToken(LaunchParams calldata p) internal view returns (address) {
        // `type(PadToken).runtimeCode` does NOT compile — PadToken has an immutable, and solc forbids
        // .runtimeCode for such contracts. creationCode is both legal and what CREATE2 actually hashes.
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(PadToken).creationCode, abi.encode(p.name, p.symbol, p.decimals, p.totalSupply, address(this))
            )
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), p.tokenSalt, initHash))))
        );
    }

    function _predictPool(address token0, address token1, uint24 fee) internal view returns (address) {
        return _poolFor(address(FACTORY), POOL_INIT_CODE_HASH, token0, token1, fee);
    }

    /// @dev The V3 pool CREATE2 derivation, parameterised on (factory, initHash) rather than reading the
    /// immutables, for ONE reason: the constructor's probe-pool check needs this exact math before FACTORY and
    /// POOL_INIT_CODE_HASH are readable. Keeping it in a single `pure` helper is what makes the constructor's
    /// assertion and every launch's assertion provably the same computation — two copies would let a future
    /// edit fix one and leave the other quietly wrong.
    function _poolFor(address factory_, bytes32 initHash, address token0, address token1, uint24 fee)
        internal
        pure
        returns (address)
    {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), factory_, keccak256(abi.encode(token0, token1, fee)), initHash
                        )
                    )
                )
            )
        );
    }

    /// @dev The whole seed geometry in one place, shared by `_preflight` and `previewLaunch` so the two can
    /// never drift. `liq` is the TRUE liquidity the mint will produce — 0 when the funded sides do not match
    /// what the range needs. `need0`/`need1` are the amounts the mint will pull for that liquidity, EXCEPT in
    /// the degenerate `liq == 0` case, where they are sized off whichever side WAS funded so a caller can read
    /// the amount the MISSING side would have to be. That fallback is the difference between "your cell is
    /// wrong" and "your cell needs 3.09e18 of quote".
    function _geometry(uint160 sp, uint160 sLo, uint160 sHi, uint256 a0, uint256 a1)
        internal
        pure
        returns (uint128 liq, uint256 need0, uint256 need1)
    {
        liq = LiquidityAmounts.getLiquidityForAmounts(sp, sLo, sHi, a0, a1);
        uint128 probe = liq;
        if (probe == 0) {
            uint160 sc = sp < sLo ? sLo : (sp > sHi ? sHi : sp);
            if (a0 > 0 && sc < sHi) probe = LiquidityAmounts.getLiquidityForAmount0(sc, sHi, a0);
            else if (a1 > 0 && sLo < sc) probe = LiquidityAmounts.getLiquidityForAmount1(sLo, sc, a1);
        }
        (need0, need1) = _amountsForLiquidity(sp, sLo, sHi, probe);
    }

    /// @dev The exact inverse of LiquidityAmounts.getLiquidityForAmounts. v4-periphery has NO
    /// `getAmountsForLiquidity`, so the reverse direction comes from v4-core's SqrtPriceMath with
    /// roundUp = true — which is what the pool itself charges. This exact form reproduces both measured
    /// launches to the wei (BRACKETS: 0 / 999999999999999999999994558; token0-side:
    /// 999999999999999999999990349 / 0).
    function _amountsForLiquidity(uint160 sp, uint160 sLo, uint160 sHi, uint128 liq)
        internal
        pure
        returns (uint256 a0, uint256 a1)
    {
        if (liq == 0) return (0, 0);
        if (sp <= sLo) {
            a0 = SqrtPriceMath.getAmount0Delta(sLo, sHi, liq, true);
        } else if (sp < sHi) {
            a0 = SqrtPriceMath.getAmount0Delta(sp, sHi, liq, true);
            a1 = SqrtPriceMath.getAmount1Delta(sLo, sp, liq, true);
        } else {
            a1 = SqrtPriceMath.getAmount1Delta(sLo, sHi, liq, true);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MonpadPoolLib} from "./MonpadPoolLib.sol";

interface IMonpadHookLauncher {
    function launches(address token) external view returns (address creator, uint16 taxBps, uint64 lastBuyback, bytes32 poolId);
    function quoteAsset() external view returns (address);
}

/// @title MonpadV4Router
/// @notice Routes MON/USDC and USDC/Monpad-token swaps atomically on Uniswap V4.
contract MonpadV4Router is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable poolManager;
    IMonpadHookLauncher public immutable launcher;
    address public immutable monpadHook;
    address public immutable quoteAsset;
    uint24 public immutable monUsdcFee;
    int24 public immutable monUsdcTickSpacing;

    error Slippage();
    error NoValue();
    error TransferFailed();
    error Expired();
    error BadKey();
    error UnknownToken();
    error ExcessiveInput();

    constructor(
        IPoolManager poolManager_,
        IMonpadHookLauncher launcher_,
        address monpadHook_,
        address monpadQuoteAsset_,
        address monUsdcQuoteAsset_,
        PoolKey memory monUsdcKey_
    ) {
        require(
            address(poolManager_) != address(0) && address(launcher_) != address(0) && monpadHook_ != address(0)
                && monpadQuoteAsset_ != address(0) && monUsdcQuoteAsset_ != address(0),
            "zero addr"
        );
        require(Currency.unwrap(monUsdcKey_.currency0) == address(0), "monUsdc: c0=MON");
        require(Currency.unwrap(monUsdcKey_.currency1) == monUsdcQuoteAsset_, "monUsdc: c1=USDC");
        require(address(IHooks(monUsdcKey_.hooks)) == address(0), "monUsdc: hookless");
        poolManager = poolManager_;
        launcher = launcher_;
        monpadHook = monpadHook_;
        quoteAsset = monpadQuoteAsset_;
        monUsdcFee = monUsdcKey_.fee;
        monUsdcTickSpacing = monUsdcKey_.tickSpacing;
    }

    function monUsdcKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(quoteAsset),
            fee: monUsdcFee,
            tickSpacing: monUsdcTickSpacing,
            hooks: IHooks(address(0))
        });
    }

    receive() external payable {}

    function buyWithMon(
        PoolKey calldata tokenKey,
        uint256 minTokensOut,
        uint256 minUsdcOut,
        uint256 deadline,
        uint160 monUsdcLimit,
        uint160 tokenPoolLimit
    ) external payable nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert NoValue();
        address token = _validateMonpadKey(tokenKey);
        uint160 limMon = monUsdcLimit == 0 ? uint160(TickMath.MIN_SQRT_PRICE + 1) : monUsdcLimit;
        uint160 limTok = tokenPoolLimit == 0 ? _defaultQuoteInLimit(tokenKey) : tokenPoolLimit;

        bytes memory out = poolManager.unlock(
            abi.encode(uint8(0), tokenKey, msg.value, minTokensOut, minUsdcOut, limMon, limTok)
        );
        uint256 monSpent;
        uint256 usdcLeft;
        (tokensOut, monSpent, usdcLeft) = abi.decode(out, (uint256, uint256, uint256));
        IERC20(token).safeTransfer(msg.sender, tokensOut);
        if (usdcLeft > 0) IERC20(quoteAsset).safeTransfer(msg.sender, usdcLeft);
        uint256 monRefund = msg.value - monSpent;
        if (monRefund > 0) {
            (bool ok,) = msg.sender.call{value: monRefund}("");
            if (!ok) revert TransferFailed();
        }
    }

    function buyWithUsdc(PoolKey calldata tokenKey, uint256 usdcIn, uint256 minTokensOut, uint256 deadline, uint160 limit)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        address token = _validateMonpadKey(tokenKey);
        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), usdcIn);
        uint160 lim = limit == 0 ? _defaultQuoteInLimit(tokenKey) : limit;
        bytes memory out = poolManager.unlock(abi.encode(uint8(1), tokenKey, usdcIn, minTokensOut, lim));
        uint256 usdcRefund;
        (tokensOut, usdcRefund) = abi.decode(out, (uint256, uint256));
        IERC20(token).safeTransfer(msg.sender, tokensOut);
        if (usdcRefund > 0) IERC20(quoteAsset).safeTransfer(msg.sender, usdcRefund);
    }

    function sellToUsdc(PoolKey calldata tokenKey, uint256 tokensIn, uint256 minUsdcOut, uint256 deadline, uint160 limit)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (block.timestamp > deadline) revert Expired();
        address token = _validateMonpadKey(tokenKey);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint160 lim = limit == 0 ? _defaultTokenInLimit(tokenKey) : limit;
        bytes memory out = poolManager.unlock(abi.encode(uint8(2), tokenKey, tokensIn, minUsdcOut, lim));
        uint256 tokenRefund;
        (usdcOut, tokenRefund) = abi.decode(out, (uint256, uint256));
        IERC20(quoteAsset).safeTransfer(msg.sender, usdcOut);
        if (tokenRefund > 0) IERC20(token).safeTransfer(msg.sender, tokenRefund);
    }

    function sellToMon(
        PoolKey calldata tokenKey,
        uint256 tokensIn,
        uint256 minMonOut,
        uint256 minUsdcOut,
        uint256 deadline,
        uint160 tokenLimit,
        uint160 monLimit
    ) external nonReentrant returns (uint256 monOut) {
        if (block.timestamp > deadline) revert Expired();
        address token = _validateMonpadKey(tokenKey);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint160 limTok = tokenLimit == 0 ? _defaultTokenInLimit(tokenKey) : tokenLimit;
        uint160 limMon = monLimit == 0 ? uint160(TickMath.MAX_SQRT_PRICE - 1) : monLimit;
        bytes memory out = poolManager.unlock(
            abi.encode(uint8(3), tokenKey, tokensIn, minMonOut, minUsdcOut, limTok, limMon)
        );
        uint256 tokenRefund;
        uint256 usdcRefund;
        (monOut, tokenRefund, usdcRefund) = abi.decode(out, (uint256, uint256, uint256));
        (bool ok,) = msg.sender.call{value: monOut}("");
        if (!ok) revert TransferFailed();
        if (tokenRefund > 0) IERC20(token).safeTransfer(msg.sender, tokenRefund);
        if (usdcRefund > 0) IERC20(quoteAsset).safeTransfer(msg.sender, usdcRefund);
    }

    function _validateMonpadKey(PoolKey calldata key) internal view returns (address token) {
        if (address(IHooks(key.hooks)) != monpadHook) revert BadKey();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 == quoteAsset) token = c1;
        else if (c1 == quoteAsset) token = c0;
        else revert BadKey();
        (address creator,,,) = launcher.launches(token);
        if (creator == address(0)) revert UnknownToken();
    }

    function _defaultQuoteInLimit(PoolKey calldata key) internal view returns (uint160) {
        MonpadPoolLib.SortedKey memory s = _sorted(key);
        return MonpadPoolLib.quoteInZeroForOne(s) ? uint160(TickMath.MIN_SQRT_PRICE + 1) : uint160(TickMath.MAX_SQRT_PRICE - 1);
    }

    function _defaultTokenInLimit(PoolKey calldata key) internal view returns (uint160) {
        MonpadPoolLib.SortedKey memory s = _sorted(key);
        return MonpadPoolLib.tokenInZeroForOne(s) ? uint160(TickMath.MIN_SQRT_PRICE + 1) : uint160(TickMath.MAX_SQRT_PRICE - 1);
    }

    function _sorted(PoolKey calldata key) internal view returns (MonpadPoolLib.SortedKey memory s) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address token = c0 == quoteAsset ? c1 : c0;
        return MonpadPoolLib.buildMonpadKey(quoteAsset, token, monpadHook);
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pm");
        uint8 op = abi.decode(raw, (uint8));

        if (op == 0) {
            (, PoolKey memory tokenKey, uint256 monIn, uint256 minTokensOut, uint256 minUsdcOut, uint160 limMon, uint160 limTok) =
                abi.decode(raw, (uint8, PoolKey, uint256, uint256, uint256, uint160, uint160));

            PoolKey memory monKey = monUsdcKey();
            BalanceDelta d0 = poolManager.swap(
                monKey,
                SwapParams({zeroForOne: true, amountSpecified: -int256(monIn), sqrtPriceLimitX96: limMon}),
                ""
            );
            uint256 monSpent = uint256(uint128(-d0.amount0()));
            uint256 usdcGot = uint256(uint128(d0.amount1()));
            if (monSpent > monIn) revert ExcessiveInput();
            if (usdcGot < minUsdcOut) revert Slippage();
            if (monSpent > 0) {
                poolManager.sync(CurrencyLibrary.ADDRESS_ZERO);
                poolManager.settle{value: monSpent}();
            }
            if (usdcGot > 0) poolManager.take(monKey.currency1, address(this), usdcGot);

            (uint256 tokensOut, uint256 usdcSpent) = _swapQuoteExactIn(tokenKey, usdcGot, limTok);
            if (tokensOut < minTokensOut) revert Slippage();
            return abi.encode(tokensOut, monSpent, usdcGot - usdcSpent);
        }

        if (op == 1) {
            (, PoolKey memory tokenKey, uint256 usdcIn, uint256 minTokensOut, uint160 lim) =
                abi.decode(raw, (uint8, PoolKey, uint256, uint256, uint160));
            (uint256 tokensOut, uint256 usdcSpent) = _swapQuoteExactIn(tokenKey, usdcIn, lim);
            if (tokensOut < minTokensOut) revert Slippage();
            return abi.encode(tokensOut, usdcIn - usdcSpent);
        }

        if (op == 2) {
            (, PoolKey memory tokenKey, uint256 tokensIn, uint256 minUsdcOut, uint160 lim) =
                abi.decode(raw, (uint8, PoolKey, uint256, uint256, uint160));
            (uint256 usdcOut, uint256 tokenSpent) = _swapTokenExactIn(tokenKey, tokensIn, lim);
            if (usdcOut < minUsdcOut) revert Slippage();
            return abi.encode(usdcOut, tokensIn - tokenSpent);
        }

        (, PoolKey memory tokenKey, uint256 tokensIn, uint256 minMonOut, uint256 minUsdcOut, uint160 limTok, uint160 limMon) =
            abi.decode(raw, (uint8, PoolKey, uint256, uint256, uint256, uint160, uint160));
        (uint256 usdcOut, uint256 tokenSpent) = _swapTokenExactIn(tokenKey, tokensIn, limTok);
        if (usdcOut < minUsdcOut) revert Slippage();
        PoolKey memory monKey = monUsdcKey();
        BalanceDelta d1 = poolManager.swap(
            monKey,
            SwapParams({zeroForOne: false, amountSpecified: -int256(usdcOut), sqrtPriceLimitX96: limMon}),
            ""
        );
        uint256 usdcSpent = uint256(uint128(-d1.amount1()));
        uint256 monGot = uint256(uint128(d1.amount0()));
        if (usdcSpent > usdcOut) revert ExcessiveInput();
        if (usdcSpent > 0) {
            poolManager.sync(monKey.currency1);
            IERC20(quoteAsset).safeTransfer(address(poolManager), usdcSpent);
            poolManager.settle();
        }
        if (monGot > 0) poolManager.take(CurrencyLibrary.ADDRESS_ZERO, address(this), monGot);
        if (monGot < minMonOut) revert Slippage();
        return abi.encode(monGot, tokensIn - tokenSpent, usdcOut - usdcSpent);
    }

    function _tokenFromKey(PoolKey memory key) internal view returns (address) {
        address c0 = Currency.unwrap(key.currency0);
        return c0 == quoteAsset ? Currency.unwrap(key.currency1) : c0;
    }

    function _swapQuoteExactIn(PoolKey memory key, uint256 usdcIn, uint160 limit)
        internal
        returns (uint256 tokensOut, uint256 usdcSpent)
    {
        MonpadPoolLib.SortedKey memory s = MonpadPoolLib.buildMonpadKey(quoteAsset, _tokenFromKey(key), monpadHook);
        bool zeroForOne = MonpadPoolLib.quoteInZeroForOne(s);
        BalanceDelta sDelta = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(usdcIn), sqrtPriceLimitX96: limit}), ""
        );
        if (zeroForOne) {
            usdcSpent = uint256(uint128(-sDelta.amount0()));
            tokensOut = uint256(uint128(sDelta.amount1()));
            _settleQuote(usdcSpent);
            if (tokensOut > 0) poolManager.take(key.currency1, address(this), tokensOut);
        } else {
            usdcSpent = uint256(uint128(-sDelta.amount1()));
            tokensOut = uint256(uint128(sDelta.amount0()));
            _settleQuote(usdcSpent);
            if (tokensOut > 0) poolManager.take(key.currency0, address(this), tokensOut);
        }
        if (usdcSpent > usdcIn) revert ExcessiveInput();
    }

    function _swapTokenExactIn(PoolKey memory key, uint256 tokensIn, uint160 limit)
        internal
        returns (uint256 usdcOut, uint256 tokenSpent)
    {
        address token = _tokenFromKey(key);
        MonpadPoolLib.SortedKey memory s = MonpadPoolLib.buildMonpadKey(quoteAsset, token, monpadHook);
        bool zeroForOne = MonpadPoolLib.tokenInZeroForOne(s);
        BalanceDelta sDelta = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(tokensIn), sqrtPriceLimitX96: limit}), ""
        );
        if (zeroForOne) {
            tokenSpent = uint256(uint128(-sDelta.amount0()));
            usdcOut = uint256(uint128(sDelta.amount1()));
            _settleToken(token, tokenSpent);
            if (usdcOut > 0) poolManager.take(key.currency1, address(this), usdcOut);
        } else {
            tokenSpent = uint256(uint128(-sDelta.amount1()));
            usdcOut = uint256(uint128(sDelta.amount0()));
            _settleToken(token, tokenSpent);
            if (usdcOut > 0) poolManager.take(key.currency0, address(this), usdcOut);
        }
        if (tokenSpent > tokensIn) revert ExcessiveInput();
    }

    function _settleQuote(uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(Currency.wrap(quoteAsset));
        IERC20(quoteAsset).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _settleToken(address token, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(Currency.wrap(token));
        IERC20(token).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }
}

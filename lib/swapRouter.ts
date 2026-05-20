// lib/swapRouter.ts
// Route decision for the dual-router swap engine.
//
// Pre-graduation Mon-Pad tokens go through the curve contract directly.
// Graduated Mon-Pad tokens + all external tokens (MON, WMON, MONSHI, etc)
// go through the Monorail aggregator.
//
// Cross-curve direct swaps (Mon-Pad-A -> Mon-Pad-B) are disabled with a
// helpful two-step message. Auto-chaining is its own batch worth of work.

import { ZERO_ADDRESS, WMON } from './constants';

export type Route = 'curve' | 'monorail';

export type RouteToken = {
  address: string;
  symbol: string;
  isMonPadToken: boolean;
  graduated: boolean;
};

// Native MON sentinel and Wrapped MON - never have a Mon-Pad curve.
const NATIVE_AND_WRAPPED = new Set<string>([
  ZERO_ADDRESS.toLowerCase(),
  WMON.toLowerCase(),
]);

function isMonOrWmon(addr: string): boolean {
  return NATIVE_AND_WRAPPED.has(addr.toLowerCase());
}

export function routeFor(token: RouteToken): Route {
  // Native MON and WMON always route through aggregator - no curve exists.
  if (isMonOrWmon(token.address)) return 'monorail';

  // Mon-Pad token, pre-graduation: curve
  if (token.isMonPadToken && !token.graduated) return 'curve';

  // Mon-Pad token, graduated: aggregator (LP now lives on Uniswap)
  if (token.isMonPadToken && token.graduated) return 'monorail';

  // Unknown external token: let the aggregator find liquidity
  return 'monorail';
}

// Swap-wide decision. If EITHER side routes to curve, the curve branch wins
// because the curve contract is the only place that knows how to price
// a pre-graduation token. The aggregator has no liquidity there.
export function routeForSwap(from: RouteToken, to: RouteToken): Route {
  if (routeFor(from) === 'curve' || routeFor(to) === 'curve') return 'curve';
  return 'monorail';
}

// Returns disable info when both sides are Mon-Pad curve tokens.
// Curve contracts can't bridge A -> B directly in one tx.
export type CrossCurveCheck =
  | { disabled: false }
  | { disabled: true; reason: string };

export function checkCrossCurve(
  from: RouteToken,
  to: RouteToken
): CrossCurveCheck {
  const fromIsCurve = routeFor(from) === 'curve' && !isMonOrWmon(from.address);
  const toIsCurve = routeFor(to) === 'curve' && !isMonOrWmon(to.address);
  if (fromIsCurve && toIsCurve) {
    return {
      disabled: true,
      reason: `Two-step swap: sell ${from.symbol} for MON first, then buy ${to.symbol}. We are working on direct curve-to-curve routing.`,
    };
  }
  return { disabled: false };
}

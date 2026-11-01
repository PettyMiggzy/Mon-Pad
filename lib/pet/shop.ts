// Premium pet items paid in MONSHI. Shared by the page (to show prices) and the server (to verify payments).
// Prices are fixed token amounts on purpose: no price oracle to manipulate. Change them here when MONSHI's price moves.
export const PREMIUM = {
  crown: { label: 'Golden Crown', icon: '👑', priceMonshi: 300_000, kind: 'cosmetic' as const },
  cape: { label: 'Royal Cape', icon: '🦸', priceMonshi: 600_000, kind: 'cosmetic' as const },
  milkcrate: { label: 'Milk Crate (+10 milk)', icon: '📦', priceMonshi: 100_000, kind: 'food' as const, milk: 10 },
} as const;
export type PremiumItem = keyof typeof PREMIUM;
export const isPremium = (x: unknown): x is PremiumItem => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PREMIUM, x);

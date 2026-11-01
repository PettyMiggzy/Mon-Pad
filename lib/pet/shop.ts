// Everything you can buy is paid in MONSHI. Shared by the page (to show prices) and the server (to verify payments).
// Prices are fixed token amounts on purpose: no price oracle to manipulate. Change them here when MONSHI's price moves.
export const PREMIUM = {
  milkpack: { label: 'Milk x5', icon: '🥛', priceMonshi: 50_000, kind: 'food' as const, food: 'milk' as const, qty: 5 },
  cookiepack: { label: 'Cookies x5', icon: '🍪', priceMonshi: 40_000, kind: 'food' as const, food: 'cookie' as const, qty: 5 },
  fishpack: { label: 'Fish x5', icon: '🐟', priceMonshi: 60_000, kind: 'food' as const, food: 'fish' as const, qty: 5 },
  beanie: { label: 'Beanie', icon: '🧢', priceMonshi: 100_000, kind: 'cosmetic' as const },
  shades: { label: 'Shades', icon: '🕶️', priceMonshi: 150_000, kind: 'cosmetic' as const },
  scarf: { label: 'Scarf', icon: '🧣', priceMonshi: 120_000, kind: 'cosmetic' as const },
  crown: { label: 'Golden Crown', icon: '👑', priceMonshi: 300_000, kind: 'cosmetic' as const },
  cape: { label: 'Royal Cape', icon: '🦸', priceMonshi: 600_000, kind: 'cosmetic' as const },
} as const;
export type PremiumItem = keyof typeof PREMIUM;
export const isPremium = (x: unknown): x is PremiumItem => typeof x === 'string' && Object.prototype.hasOwnProperty.call(PREMIUM, x);

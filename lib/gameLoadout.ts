// Shared validation for Munchy Kart loadouts (mirrors the shape in public/games/munchy-kart/game.js).
export type Loadout = {
  car: number;
  cars: number[];
  inv: { nitro: number; shield: number; magnet: number };
  up: { engine: number; zap: number; tires: number };
};

const int = (v: unknown, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

/** Coerce untrusted input into a well-formed Loadout (clamped, deduped). */
export function sanitizeLoadout(raw: any): Loadout {
  const cars = Array.from(new Set<number>((Array.isArray(raw?.cars) ? raw.cars : [1]).map((c: unknown) => int(c, 1, 99))));
  if (!cars.includes(1)) cars.unshift(1);
  const car = cars.includes(int(raw?.car, 1, 99)) ? int(raw?.car, 1, 99) : 1;
  return {
    car,
    cars,
    inv: { nitro: int(raw?.inv?.nitro, 0, 99), shield: int(raw?.inv?.shield, 0, 99), magnet: int(raw?.inv?.magnet, 0, 99) },
    up: { engine: int(raw?.up?.engine, 0, 3), zap: int(raw?.up?.zap, 0, 3), tires: int(raw?.up?.tires, 0, 3) },
  };
}

export const loadoutMessage = (wallet: string, nonce: number) => `Mon-Pad Munchy Kart: save loadout for ${wallet} nonce ${nonce}`;

// ---- prices (mirror CARS / BOOSTS / UPGRADES in public/games/munchy-kart/game.js) ----
export const CAR_PRICE: Record<number, number> = { 1: 0, 2: 250, 3: 400, 4: 700, 5: 1500 };
export const BOOST_PRICE = { nitro: 30, shield: 25, magnet: 40 } as const;
export const UPGRADE_PRICES = { engine: [120, 260, 520], zap: [60, 140, 300], tires: [90, 200, 400] } as const;

/** Milk cost of moving from `prev` to `next`, or null if the change is not allowed (unknown/removed car, downgrade). */
export function loadoutCost(prev: Loadout, next: Loadout): number | null {
  let cost = 0;
  for (const id of prev.cars) if (!next.cars.includes(id)) return null;
  for (const id of next.cars) {
    if (prev.cars.includes(id)) continue;
    if (CAR_PRICE[id] === undefined) return null;
    cost += CAR_PRICE[id];
  }
  for (const k of ['nitro', 'shield', 'magnet'] as const) cost += Math.max(0, next.inv[k] - prev.inv[k]) * BOOST_PRICE[k];
  for (const k of ['engine', 'zap', 'tires'] as const) {
    if (next.up[k] < prev.up[k]) return null;
    for (let lvl = prev.up[k]; lvl < next.up[k]; lvl++) cost += UPGRADE_PRICES[k][lvl];
  }
  return cost;
}

// ---- races ----
export const RACE_SECS = 60;
export const MIN_CLAIM_SECS = 45;      // a real race lasts RACE_SECS; allow slack for load time
export const MAX_MILK_PER_RACE = 3000; // measured max over 75 seeds x 5 cars with maxed upgrades was 2226

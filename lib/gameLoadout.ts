// Shared validation for Monshi Kart loadouts (mirrors the shape in public/games/munchy-kart/game.js).
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

export const loadoutMessage = (wallet: string, nonce: number) => `Mon-Pad Monshi Kart: save loadout for ${wallet} nonce ${nonce}`;

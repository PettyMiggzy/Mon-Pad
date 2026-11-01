// Every balance number for the Monshi pet lives here. Change it here and the game follows.
export const PET = {
  storageKey: 'monshi-pet-v1',
  decayPerHour: { hunger: 2.1, happiness: 1.5, energy: 1.15, cleanliness: 1.25 },
  startNeeds: { hunger: 78, happiness: 78, energy: 82, cleanliness: 85 },
  startCoins: 20,
  startInventory: { milk: 2, cookie: 1, fish: 0 },
  foods: {
    milk: { label: 'Milk', icon: '🥛', hunger: 30, happiness: 9, price: 5, points: 2 },
    cookie: { label: 'Cookie', icon: '🍪', hunger: 18, happiness: 14, price: 4, points: 2 },
    fish: { label: 'Fish', icon: '🐟', hunger: 26, happiness: 7, price: 6, points: 2 },
  },
  wash: { cleanliness: 55, happiness: 4, energy: -2, coins: 1, points: 2 },
  sleep: { energyPerMinute: 3.3, options: [15, 30, 60], maxMinutes: 480 },
  play: { seconds: 20, targetTaps: 28, happiness: 20, energy: -9, coinsBase: 3, coinsPerPoint: 0.06, pointsDivisor: 12 },
  train: { seconds: 18, targetTaps: 16, energyCost: 12, minEnergy: 12, cooldownMinutes: 8, baseXp: 9, bonusXp: 10, coinsBase: 4, coinsPerPoint: 0.04 },
  level: { max: 20, xpBase: 35, xpGrowth: 1.24 },
  stages: [
    { id: 'kit', label: 'Kit', from: 0, room: 'Cozy Corner' },
    { id: 'teen', label: 'Teen', from: 90, room: 'Training Nook' },
    { id: 'adult', label: 'Adult', from: 260, room: 'Moonlit Loft' },
    { id: 'legend', label: 'Legend', from: 560, room: 'Legend Lounge' },
  ],
  daily: { coins: 12, food: 'milk' as const },
  mood: { sulkAfterHours: 24, sulkBelow: 65, hungry: 22, sleepy: 22, dirty: 22, sad: 25, happyAtLeast: 70 },
  // price = coins; premium items (price 0) are bought with MONSHI, see lib/pet/shop.ts
  cosmetics: {
    beanie: { label: 'Beanie', price: 18, slot: 'hat' },
    shades: { label: 'Shades', price: 24, slot: 'face' },
    scarf: { label: 'Scarf', price: 20, slot: 'neck' },
    crown: { label: 'Golden Crown', price: 0, slot: 'hat' },
    cape: { label: 'Royal Cape', price: 0, slot: 'back' },
  },
} as const;

export type Food = keyof typeof PET.foods;
export type Cosmetic = keyof typeof PET.cosmetics;
export type NeedKey = keyof typeof PET.decayPerHour;
export type SkillKey = 'speed' | 'strength' | 'brains' | 'charm';
export type StageId = (typeof PET.stages)[number]['id'];
export type Mood = 'happy' | 'ok' | 'hungry' | 'sleepy' | 'dirty' | 'sad' | 'sulking';

export const COIN_COSMETICS: Cosmetic[] = ['beanie', 'shades', 'scarf'];

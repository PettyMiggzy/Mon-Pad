// Every balance number for the Monshi pet lives here. Change it here and the game follows.
export const PET = {
  storageKey: 'monshi-pet-v1',
  decayPerHour: { hunger: 2.1, happiness: 1.5, energy: 1.15, cleanliness: 1.25 },
  startNeeds: { hunger: 78, happiness: 78, energy: 82, cleanliness: 85 },
  startInventory: { milk: 2, cookie: 1, fish: 0 },
  foods: {
    milk: { label: 'Milk', icon: '🥛', hunger: 30, happiness: 9, points: 2 },
    cookie: { label: 'Cookie', icon: '🍪', hunger: 18, happiness: 14, points: 2 },
    fish: { label: 'Fish', icon: '🐟', hunger: 26, happiness: 7, points: 2 },
  },
  wash: { cleanliness: 55, happiness: 4, energy: -2, points: 2 },
  sleep: { energyPerMinute: 3.3, options: [15, 30, 60], maxMinutes: 480 },
  play: { seconds: 20, targetTaps: 28, happiness: 20, energy: -9, pointsDivisor: 12 },
  train: { seconds: 18, targetTaps: 16, energyCost: 12, minEnergy: 12, cooldownMinutes: 8, baseXp: 9, bonusXp: 10 },
  level: { max: 20, xpBase: 35, xpGrowth: 1.24 },
  stages: [
    { id: 'kit', label: 'Kit', from: 0, room: 'Cozy Corner' },
    { id: 'teen', label: 'Teen', from: 90, room: 'Training Nook' },
    { id: 'adult', label: 'Adult', from: 260, room: 'Moonlit Loft' },
    { id: 'legend', label: 'Legend', from: 560, room: 'Legend Lounge' },
  ],
  daily: { food: 'milk' as const },
  talk: { freePerDay: 5, extraCost: 'cookie' as const, hardCapPerDay: 30, happiness: 2, points: 1 },
  mood: { sulkAfterHours: 24, sulkBelow: 65, hungry: 22, sleepy: 22, dirty: 22, sad: 25, happyAtLeast: 70 },
  // Everything wearable is bought with MONSHI, see lib/pet/shop.ts
  cosmetics: {
    beanie: { label: 'Beanie', slot: 'hat' },
    shades: { label: 'Shades', slot: 'face' },
    scarf: { label: 'Scarf', slot: 'neck' },
    crown: { label: 'Golden Crown', slot: 'hat' },
    cape: { label: 'Royal Cape', slot: 'back' },
  },
} as const;

export type Food = keyof typeof PET.foods;
export type Cosmetic = keyof typeof PET.cosmetics;
export type NeedKey = keyof typeof PET.decayPerHour;
export type SkillKey = 'speed' | 'strength' | 'brains' | 'charm';
export type StageId = (typeof PET.stages)[number]['id'];
export type Mood = 'happy' | 'ok' | 'hungry' | 'sleepy' | 'dirty' | 'sad' | 'sulking';


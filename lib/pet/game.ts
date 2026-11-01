import { PREMIUM } from './shop';
import { PET, type Cosmetic, type Food, type Mood, type NeedKey, type SkillKey, type StageId } from './config';

export type Pet = {
  version: 1;
  needs: Record<NeedKey, number>;
  skills: Record<SkillKey, { level: number; xp: number }>;
  coins: number;
  inventory: Record<Food, number>;
  owned: Cosmetic[];
  equipped: Cosmetic[];
  points: number;
  streak: number;
  lastDaily: string | null;
  lastSeen: number;
  lastCare: number;
  trainReadyAt: Record<SkillKey, number>;
  sleepingUntil: number | null;
  sleepStartedAt: number | null;
  applied: string[]; // tx hashes of MONSHI purchases already given to this pet
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const day = (t: number) => new Date(t).toLocaleDateString('en-CA');
const xpNeeded = (level: number) => Math.round(PET.level.xpBase * Math.pow(PET.level.xpGrowth, level - 1));
export const SKILL_KEYS: SkillKey[] = ['speed', 'strength', 'brains', 'charm'];

export function freshPet(now = Date.now()): Pet {
  return {
    version: 1,
    needs: { ...PET.startNeeds },
    skills: { speed: { level: 1, xp: 0 }, strength: { level: 1, xp: 0 }, brains: { level: 1, xp: 0 }, charm: { level: 1, xp: 0 } },
    coins: PET.startCoins, inventory: { ...PET.startInventory }, owned: [], equipped: [],
    points: 0, streak: 0, lastDaily: null, lastSeen: now, lastCare: now,
    trainReadyAt: { speed: 0, strength: 0, brains: 0, charm: 0 }, sleepingUntil: null, sleepStartedAt: null, applied: [],
  };
}

/** Bring a saved pet up to date: needs decay with real time, sleep restores energy. Safe to call often. */
export function tick(p: Pet, now = Date.now()): Pet {
  const hours = Math.max(0, now - p.lastSeen) / 3_600_000;
  const needs = { ...p.needs };
  (Object.keys(PET.decayPerHour) as NeedKey[]).forEach((k) => { needs[k] = clamp(needs[k] - PET.decayPerHour[k] * hours); });
  let { sleepingUntil, sleepStartedAt } = p;
  if (sleepingUntil) {
    const from = Math.max(p.lastSeen, sleepStartedAt ?? p.lastSeen);
    const mins = Math.max(0, Math.min(now, sleepingUntil) - from) / 60_000;
    needs.energy = clamp(needs.energy + mins * PET.sleep.energyPerMinute);
    if (now >= sleepingUntil) { sleepingUntil = null; sleepStartedAt = null; }
  }
  return { ...p, needs, lastSeen: now, sleepingUntil, sleepStartedAt };
}

export function moodOf(p: Pet, now = Date.now()): Mood {
  const m = PET.mood;
  if (p.sleepingUntil) return 'sleepy';
  if (now - p.lastCare >= m.sulkAfterHours * 3_600_000 && Math.min(...Object.values(p.needs)) < m.sulkBelow) return 'sulking';
  if (p.needs.hunger < m.hungry) return 'hungry';
  if (p.needs.energy < m.sleepy) return 'sleepy';
  if (p.needs.cleanliness < m.dirty) return 'dirty';
  if (p.needs.happiness < m.sad) return 'sad';
  return Object.values(p.needs).every((v) => v >= m.happyAtLeast) ? 'happy' : 'ok';
}

export function stageOf(p: Pet): StageId {
  return [...PET.stages].reverse().find((s) => p.points >= s.from)!.id;
}

const cared = (p: Pet, now = Date.now()): Pet => ({ ...p, lastCare: now });

export function feed(p: Pet, food: Food): Pet {
  const f = PET.foods[food];
  if (p.inventory[food] <= 0) return p;
  return cared({ ...p, needs: { ...p.needs, hunger: clamp(p.needs.hunger + f.hunger), happiness: clamp(p.needs.happiness + f.happiness) },
    inventory: { ...p.inventory, [food]: p.inventory[food] - 1 }, points: p.points + f.points });
}

export function wash(p: Pet): Pet {
  const w = PET.wash;
  return cared({ ...p, needs: { ...p.needs, cleanliness: clamp(p.needs.cleanliness + w.cleanliness), happiness: clamp(p.needs.happiness + w.happiness), energy: clamp(p.needs.energy + w.energy) },
    coins: p.coins + w.coins, points: p.points + w.points });
}

export function sleep(p: Pet, minutes: number, now = Date.now()): Pet {
  const mins = Math.min(PET.sleep.maxMinutes, Math.max(1, minutes));
  return cared({ ...p, sleepingUntil: now + mins * 60_000, sleepStartedAt: now }, now);
}
export function wake(p: Pet, now = Date.now()): Pet {
  const t = tick(p, now);
  return { ...t, sleepingUntil: null, sleepStartedAt: null };
}

/** score is 0 to 100 from the mini-game */
export function finishPlay(p: Pet, score: number): Pet {
  const c = PET.play;
  return cared({ ...p, needs: { ...p.needs, happiness: clamp(p.needs.happiness + c.happiness), energy: clamp(p.needs.energy + c.energy) },
    coins: p.coins + Math.round(c.coinsBase + score * c.coinsPerPoint), points: p.points + Math.max(1, Math.round(score / c.pointsDivisor)) });
}

export function canTrain(p: Pet, skill: SkillKey, now = Date.now()): string | null {
  if (p.sleepingUntil) return 'Monshi is asleep.';
  if (p.needs.energy < PET.train.minEnergy) return 'Monshi needs more energy.';
  if (now < p.trainReadyAt[skill]) return 'That drill is cooling down.';
  return null;
}

export function finishTrain(p: Pet, skill: SkillKey, score: number, now = Date.now()): Pet {
  const t = PET.train;
  let { level, xp } = p.skills[skill];
  xp += Math.round(t.baseXp + (score / 100) * t.bonusXp);
  while (level < PET.level.max && xp >= xpNeeded(level)) { xp -= xpNeeded(level); level++; }
  return cared({ ...p, skills: { ...p.skills, [skill]: { level, xp } }, needs: { ...p.needs, energy: clamp(p.needs.energy - t.energyCost) },
    trainReadyAt: { ...p.trainReadyAt, [skill]: now + t.cooldownMinutes * 60_000 },
    coins: p.coins + Math.round(t.coinsBase + score * t.coinsPerPoint), points: p.points + Math.max(1, Math.round(score / PET.play.pointsDivisor)) }, now);
}

export const dailyClaimed = (p: Pet, now = Date.now()) => p.lastDaily === day(now);
export function claimDaily(p: Pet, now = Date.now()): Pet {
  if (dailyClaimed(p, now)) return p;
  const streak = p.lastDaily === day(now - 86_400_000) ? p.streak + 1 : 1;
  return cared({ ...p, streak, lastDaily: day(now), coins: p.coins + PET.daily.coins, inventory: { ...p.inventory, [PET.daily.food]: p.inventory[PET.daily.food] + 1 } }, now);
}

export function buyFood(p: Pet, food: Food): Pet {
  const price = PET.foods[food].price;
  return p.coins < price ? p : { ...p, coins: p.coins - price, inventory: { ...p.inventory, [food]: p.inventory[food] + 1 } };
}
export function buyCosmetic(p: Pet, item: Cosmetic): Pet {
  const price = PET.cosmetics[item].price;
  return p.owned.includes(item) || p.coins < price ? p : { ...p, coins: p.coins - price, owned: [...p.owned, item] };
}
export function toggleCosmetic(p: Pet, item: Cosmetic): Pet {
  if (!p.owned.includes(item)) return p;
  if (p.equipped.includes(item)) return { ...p, equipped: p.equipped.filter((x) => x !== item) };
  const slot = PET.cosmetics[item].slot; // wearing a new hat replaces the old hat
  return { ...p, equipped: [...p.equipped.filter((x) => PET.cosmetics[x].slot !== slot), item] };
}

/** Give the pet the premium things it bought with MONSHI. Each payment is applied once, whatever device it is restored on. */
export function applyPurchases(p: Pet, purchases: { item: string; tx_hash: string }[]): Pet {
  let next = p;
  for (const buy of purchases) {
    if (next.applied.includes(buy.tx_hash)) continue;
    const def = (PREMIUM as Record<string, { kind: string; milk?: number }>)[buy.item];
    if (!def) continue;
    if (def.kind === 'cosmetic') next = { ...next, owned: next.owned.includes(buy.item as Cosmetic) ? next.owned : [...next.owned, buy.item as Cosmetic] };
    if (def.kind === 'food') next = { ...next, inventory: { ...next.inventory, milk: next.inventory.milk + (def.milk ?? 0) } };
    next = { ...next, applied: [...next.applied, buy.tx_hash] };
  }
  return next;
}
export const skillNeed = xpNeeded;

import { PET } from './config';
import { freshPet, tick, type Pet } from './game';

export function loadPet(): Pet {
  try {
    const raw = localStorage.getItem(PET.storageKey);
    if (!raw) return freshPet();
    const p = JSON.parse(raw) as Pet;
    return p.version === 1 ? tick({ ...p, applied: p.applied ?? [], talks: p.talks ?? { day: '', n: 0 } }) : freshPet();
  } catch { return freshPet(); }
}
export function savePet(p: Pet) { try { localStorage.setItem(PET.storageKey, JSON.stringify(p)); } catch { /* private mode */ } }
export function resetPet(): Pet { try { localStorage.removeItem(PET.storageKey); } catch { /* ignore */ } return freshPet(); }

// When should Monshi nudge the player? Pure function, so it can be tested; the page uploads the result for the push sender.
import { PET } from './config';
import type { Pet } from './game';
import type { Reason } from './server';

const MISS_AFTER_HOURS = 20;

export function nextReminder(p: Pet, now = Date.now()): { at: number; reason: Reason } {
  const missAt = p.lastCare + MISS_AFTER_HOURS * 3_600_000;
  const base = p.sleepingUntil ? Math.max(now, p.sleepingUntil) : now;
  const hoursToHungry = Math.max(0, (p.needs.hunger - PET.mood.hungry) / PET.decayPerHour.hunger);
  const hungryAt = base + hoursToHungry * 3_600_000 + 60_000;
  // never schedule in the past; an overdue "hungry" waits for the next visit instead of buzzing right away
  return hungryAt <= missAt ? { at: Math.max(hungryAt, now + 60_000), reason: 'hungry' } : { at: Math.max(missAt, now + 60_000), reason: 'miss' };
}

const KEY = 'monshi-pet-push';
export const pushEnabled = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const setFlag = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } };
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => !!VAPID;

const b64ToBytes = (b64: string) => { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

async function send(sub: PushSubscription, p: Pet) {
  const { at, reason } = nextReminder(p);
  await fetch('/api/pet/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), remindAt: at, reason }) });
}

export async function enablePush(p: Pet): Promise<string | null> {
  if (!pushSupported()) return 'This browser cannot do reminders.';
  if (!VAPID) return 'Reminders are not set up on the site yet.';
  if ((await Notification.requestPermission()) !== 'granted') return 'Notifications are blocked. Allow them in your browser settings.';
  const reg = await navigator.serviceWorker.register('/pet-sw.js', { scope: '/pet' });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
  await send(sub, p); setFlag(true); return null;
}
export async function disablePush() {
  setFlag(false);
  const reg = await navigator.serviceWorker.getRegistration('/pet');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await fetch('/api/pet/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
}
/** Call after the pet changes: moves the next reminder later while the player is active. */
export async function reschedulePush(p: Pet) {
  if (!pushEnabled() || !pushSupported()) return;
  try { const reg = await navigator.serviceWorker.getRegistration('/pet'); const sub = await reg?.pushManager.getSubscription(); if (sub) await send(sub, p); } catch { /* try again on the next change */ }
}

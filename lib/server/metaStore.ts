export type LaunchMeta = {
  token: string;
  curve?: string;
  creator?: string;
  name?: string;
  symbol?: string;
  imageUrl?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  description?: string;
  createdAt: number;
};

// In-memory metadata store (works instantly in dev).
// For production persistence on Netlify, wire this to a DB (Supabase recommended).
const store = new Map<string, LaunchMeta>();

export function setLaunchMeta(meta: LaunchMeta) {
  if (!meta?.token) return;
  store.set(meta.token.toLowerCase(), meta);
}

export function getLaunchMeta(token: string): LaunchMeta | null {
  if (!token) return null;
  return store.get(token.toLowerCase()) ?? null;
}

export function allLaunchMeta(): LaunchMeta[] {
  return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt);
}

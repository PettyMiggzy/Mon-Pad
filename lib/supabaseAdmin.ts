// Server-only Supabase client (service-role). NEVER import this into client code —
// the service-role key bypasses RLS and must stay on the server (API routes only).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** Returns a service-role client, or null if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset. */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

import { createBrowserClient } from '@supabase/ssr';
import { resilientFetch } from '@/lib/resilient-fetch';

// NEXT_PUBLIC_ vars are inlined by Next.js at build time, but only when
// referenced as a direct `process.env.NEXT_PUBLIC_X` member expression —
// funneling this through a dynamic helper (process.env[name]) would break
// the inlining and silently ship `undefined` to the browser. Keep these
// as static references and just add a clear check.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export function createClient() {
  // Every request this client makes — reads and RPC writes alike —
  // goes through resilientFetch, which retries a request that never
  // reached the server at all (weak/dropped connection) before
  // surfacing an error. See lib/resilient-fetch.ts for why this is
  // safe (only retries on fetch() throwing, never on a real HTTP
  // response) and its limits (not a substitute for true offline
  // support — this bridges a connectivity blip, not an outage).
  return createBrowserClient(supabaseUrl!, supabaseAnonKey!, {
    global: { fetch: resilientFetch }
  });
}

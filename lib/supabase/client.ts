import { createBrowserClient } from '@supabase/ssr';

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
  return createBrowserClient(supabaseUrl!, supabaseAnonKey!);
}

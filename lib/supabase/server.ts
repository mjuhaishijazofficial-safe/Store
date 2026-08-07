import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireEnv } from '@/lib/env';

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // called from a Server Component — middleware refreshes the session
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {}
        }
      }
    }
  );
}

// Admin client — service role key, server-only (webhooks, cron). NEVER expose to the browser.
export function createAdminClient() {
  const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
  return createSupabaseClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

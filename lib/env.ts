// Fails loudly and specifically the moment a required env var is missing,
// instead of letting `undefined` (from the old `process.env.X!` non-null
// assertions) flow into a third-party SDK and surface as a confusing
// low-level error somewhere deep inside Stripe/Supabase's own code.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

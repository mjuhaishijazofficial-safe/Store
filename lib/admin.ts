// Single check for "is this the person who runs the whole SaaS" — not a
// per-shop role (owner/staff are scoped to one shop each), a specific
// person identified by email via ADMIN_EMAIL. Kept as one function so the
// admin page, the activate-payment route, and the nav link can't drift
// out of sync on what "admin" means.
export function isAdmin(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  return !!adminEmail && !!email && email.toLowerCase() === adminEmail.toLowerCase();
}

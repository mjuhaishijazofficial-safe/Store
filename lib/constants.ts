// Single source of truth for values that were duplicated across
// components — change once here instead of hunting every usage.
export const SUPPORT_WHATSAPP_NUMBER = '923336687817';

// Master Spec §25-H: days a shop stays fully functional (with a
// warning banner) after a failed payment before actually going
// view-only — see app/api/stripe/webhook (sets shops.grace_ends_at)
// and app/api/cron/check-grace-periods (flips to 'suspended' once it
// passes).
export const GRACE_PERIOD_DAYS = 4;

// The app is built for Pakistani kiryana stores; "today" in reports must
// mean today in Pakistan Standard Time (UTC+5, no DST), not the server's
// local timezone. Vercel runs functions in UTC, so computing "midnight"
// with new Date().setHours(0,0,0,0) was silently off by 5 hours — evening
// entries after 7pm PKT would land in "tomorrow", and entries before 5am
// PKT would still show as "yesterday".

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

// Returns the UTC instant corresponding to today's midnight in PKT.
export function startOfTodayPKT(): Date {
  const nowShifted = new Date(Date.now() + PKT_OFFSET_MS);
  const y = nowShifted.getUTCFullYear();
  const m = nowShifted.getUTCMonth();
  const d = nowShifted.getUTCDate();
  return new Date(Date.UTC(y, m, d) - PKT_OFFSET_MS);
}

// Returns the UTC instant corresponding to the 1st of this month, midnight
// PKT.
export function startOfMonthPKT(): Date {
  const nowShifted = new Date(Date.now() + PKT_OFFSET_MS);
  const y = nowShifted.getUTCFullYear();
  const m = nowShifted.getUTCMonth();
  return new Date(Date.UTC(y, m, 1) - PKT_OFFSET_MS);
}

// Rolling N-day window ending now, anchored to PKT's start-of-day so
// "last 7 days" reads the same way a shopkeeper would count it.
export function daysAgoPKT(days: number): Date {
  const start = startOfTodayPKT();
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

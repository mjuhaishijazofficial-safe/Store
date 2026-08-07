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

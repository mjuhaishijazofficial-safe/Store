// Wraps every Supabase request (reads and writes alike) with retry on
// genuine network failure — a weak/patchy connection where a request
// never even reaches the server, not a real error response.
//
// Retries only on fetch() *throwing* (TypeError: Failed to fetch /
// NetworkError), never on an HTTP response that came back — a 400/401/
// 500 is a real answer from the server and retrying it would just repeat
// the same failure (or worse, resubmit a write the server already saw
// but whose response got lost, which is the one case retry could cause
// a duplicate). fetch() throwing specifically means the browser could
// not establish the connection at all, which is the reliable signal
// that the request never left — safe to retry.
//
// Backoff is capped around ~30s total across 5 attempts, chosen to
// bridge the kind of multi-second connectivity blip a shaky mobile
// connection actually produces, not to paper over an extended outage —
// this app is single-device per shop, so there's no queue to persist
// across a real offline stretch, just "keep trying a bit longer before
// giving up and telling the shopkeeper."
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      await sleep(BASE_DELAY_MS * 2 ** attempt); // 500ms, 1s, 2s, 4s, 8s
    }
  }

  throw lastError;
}

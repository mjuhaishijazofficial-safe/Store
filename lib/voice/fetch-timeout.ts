// Every network call in the voice pipeline goes through this.
//
// Without a timeout, a single hanging upstream request (Gemini's
// grounding endpoint is the usual culprit — it can stall indefinitely
// rather than erroring) leaves the whole voice flow stuck in "thinking"
// forever, since fetch() has no default timeout of its own. An
// assistant that answers wrongly in two seconds is far more usable than
// one that answers perfectly after five minutes, so everything here is
// bounded and falls back rather than waiting.
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

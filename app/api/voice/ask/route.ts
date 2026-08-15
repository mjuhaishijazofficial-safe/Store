import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';

// Grounded search is the slow leg (it does real web lookups); the plain
// call is fast. Bounding them separately means a stalled grounding
// request can't hold up an answer the plain call already has ready.
const GROUNDED_TIMEOUT_MS = 6000;
const PLAIN_TIMEOUT_MS = 8000;

// Voice Command feature, "general_query" leg: anything Eagle was asked
// that isn't Khata-shaped (a question, a search request, a
// calculation...). Tries Gemini with Google Search grounding first —
// real, live web results for anything current (rates, prices, news),
// not the model just guessing from its training data — and falls back
// to a plain (ungrounded) answer if grounding fails for any reason
// (quota, an older resolved model, a transient error). Either way this
// only ever answers out loud; it can't touch Khata/stock/anything else
// — that's the whole reason it's a separate action from khata_* in
// parse-command, kept on its own read-only path.
const SYSTEM_PROMPT = 'You are Eagle, a helpful voice assistant inside a Pakistani kiryana shop\'s management app. Answer briefly and naturally — this will be read aloud, not displayed as a document, so keep it to a few sentences, no markdown/bullet points. Reply in the same language mix (Roman Urdu / Urdu / English) the question was asked in.';

async function callGemini(apiKey: string, model: string, query: string, withSearch: boolean): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nQuestion: ${query}` }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {})
      })
    }, withSearch ? GROUNDED_TIMEOUT_MS : PLAIN_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p.text || '').join('').trim() : '';
    return text || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { query } = await req.json().catch(() => ({ query: null }));
  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  // Grounded and plain answers are fired in parallel, not one-then-the-
  // other — sequentially, a quota-exhausted/failing grounding call still
  // costs its own full round trip before the fallback even starts,
  // roughly doubling response time on every single general_query while
  // grounding stays unavailable. Racing them costs only the slower of
  // the two, and the grounded one wins whenever it actually succeeds.
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const q = query.trim();
  const [groundedResult, plainResult] = await Promise.all([
    callGemini(apiKey, model, q, true),
    callGemini(apiKey, model, q, false)
  ]);
  const answer = groundedResult || plainResult;
  const grounded = !!groundedResult;

  if (!answer) return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  return NextResponse.json({ answer, grounded });
}

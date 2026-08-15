import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nQuestion: ${query}` }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {})
      })
    });
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

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  let answer = await callGemini(apiKey, model, query.trim(), true);
  let grounded = !!answer;
  if (!answer) {
    // Grounding unavailable/quota-exhausted on this key/model — still
    // worth answering from the model's own knowledge rather than
    // failing outright; just not guaranteed current.
    answer = await callGemini(apiKey, model, query.trim(), false);
    grounded = false;
  }

  if (!answer) return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  return NextResponse.json({ answer, grounded });
}

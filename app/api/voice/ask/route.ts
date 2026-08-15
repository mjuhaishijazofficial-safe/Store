import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { askLlm, askWithWebSearch } from '@/lib/voice/llm';

// Voice Command feature, "general_query" leg: anything Eagle was asked
// that isn't a shop-record action (a question, a search request, a
// calculation...). This path only ever reads and answers — it cannot
// touch Khata/stock/anything else, which is exactly why it's kept
// separate from the acting paths in parse-command.
//
// The "never claim to have acted" rule below is not decoration: any
// "done, I've added it" reply is a lie the user will act on. That
// happened for real — "naya customer add kar do" reached this path and
// got a confident "add kar diya" while no customer existed. Refusing
// clearly is the only safe behavior here.
const SYSTEM_PROMPT = `You are Eagle, a helpful voice assistant inside a Pakistani kiryana shop's management app. Answer briefly and naturally — this will be read aloud, not displayed as a document, so keep it to a few sentences, no markdown/bullet points. Reply in the same language mix (Roman Urdu / Urdu / English) the question was asked in.

CRITICAL RULE: You can only answer questions and look things up. You CANNOT add, change, or delete anything in the app — you have no ability to do so. If the user asks you to perform an action (add a customer, record a sale, change stock, delete something), you MUST NOT claim you did it. Never say "done", "added", "kar diya", "ho gaya" or anything implying the action happened. Instead say plainly that you can't do that one yet and tell them which screen of the app to use for it. Claiming to have done something you did not do is the worst possible answer.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { query, history } = await req.json().catch(() => ({ query: null, history: null }));
  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  // Short-term memory (see parse-command's own copy of this) — lets a
  // follow-up like "iska matlab kya hai" or "aur bhi batao" refer back
  // to what Eagle just said instead of landing as a standalone,
  // context-free question.
  const historyLines = Array.isArray(history)
    ? history
        .slice(-4)
        .filter((h: any) => h && typeof h.user === 'string' && typeof h.eagle === 'string')
        .map((h: any) => `User: ${h.user}\nEagle: ${h.eagle}`)
        .join('\n')
    : '';
  const historyBlock = historyLines ? `\n\nRecent conversation:\n${historyLines}` : '';

  const prompt = `${SYSTEM_PROMPT}${historyBlock}\n\nNew question: ${query.trim()}`;

  // Both are fired together rather than one-then-the-other: web search
  // (Gemini's tool, the only live-results option here) is the slower
  // leg and is often unavailable, and waiting for it to fail before
  // starting the plain answer doubled the response time on every
  // question. Racing them costs only the slower of the two, and the
  // searched answer wins whenever it actually comes back.
  const [searched, plain] = await Promise.all([
    askWithWebSearch(prompt),
    askLlm(prompt)
  ]);

  const answer = searched || plain.text;
  if (!answer) {
    if (plain.rateLimited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }
  return NextResponse.json({ answer, grounded: !!searched });
}

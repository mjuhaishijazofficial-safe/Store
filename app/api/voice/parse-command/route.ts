import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { askLlm } from '@/lib/voice/llm';

// Voice Command feature: transcript text in, a structured action out.
// The LLM call itself lives in lib/voice/llm.ts (shared with
// /api/voice/ask) — see that file for why this runs on OpenAI by
// default rather than Gemini.
const PROMPT = `You are parsing one spoken voice command given to "Eagle", a voice assistant inside a Pakistani kiryana (grocery) shop's management app. The command was transcribed from speech and may be in Roman Urdu, Urdu, or English, or a mix. It may start with the wake word "Eagle" (or a mis-transcription of it, e.g. "Eagal", "Ego") — ignore that word entirely, it's not part of the command.

Recognize exactly these actions:
- "khata_purchase": a customer received/bought goods on credit (e.g. "Zuhair ke khata mein 4 kilo cheeni add karo", "Ali ko 2 packet biscuit diye", "Zuhair se 500 rupay ka saman gaya")
- "khata_payment": a customer paid money against their balance (e.g. "Zuhair ne 500 rupay diye", "Ali se payment mil gayi 1000 rupay". "Zuhair ne paisa nahi diya" is NOT a payment — only a clearly stated amount actually received counts)
- "khata_return": a customer returned goods (e.g. "Ali ne cheeni wapas ki", "Zuhair ka saman return ho gaya")
- "add_customer": create a NEW customer record (e.g. "naya customer add karo Zuhair", "Ali naam ka customer bana do", "naya khata kholo Bilal ka", "add a new customer named Ahmed"). A phone number may or may not be spoken.
- "check_balance": asking how much a customer owes (e.g. "Zuhair ka balance kitna hai", "Ali kitne ka udhaar hai", "how much does Bilal owe")
- "check_stock": asking how much of an item is in stock (e.g. "cheeni kitni bachi hai", "Dalda ka stock kya hai", "how much rice do we have")
- "general_query": anything else — a question, a search request, a calculation, general conversation (e.g. "aaj USD ka rate kya hai", "Google par ye search karo: ...", "2500 ka 15 percent kitna hota hai", "shukriya", "tum kaun ho")

If a command sounds like it's trying to be a money-affecting Khata action (mentions a customer and goods/money) but is missing the customer name or is too ambiguous to act on safely, return action "unknown" — never guess on those. Only fall back to "general_query" when the command clearly isn't about the shop's own records at all.

Fields:
- customer_name: the customer's name exactly as spoken, not invented. Used by khata_* actions, add_customer and check_balance.
- customer_phone: a phone number if one was spoken for add_customer, null otherwise.
- item_name: product name — for khata_purchase/khata_return and check_stock, null otherwise.
- qty: the numeric quantity spoken, null if not mentioned.
- unit: the unit as spoken (kg, packet, piece, litre, dozen...), null if not mentioned.
- amount: a rupee amount only if one was explicitly spoken (null otherwise — the app calculates it from the item's own price when qty + item are known instead).
- query: for "general_query" only — the question or request itself, cleaned up (wake word removed), as plain text. Null for every other action.

Reply with JSON only.`;

// Lowercase JSON Schema — what OpenAI's json_schema response format
// expects. Gemini accepts this shape too (it reads the same keys,
// case-insensitively for types).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['khata_purchase', 'khata_payment', 'khata_return', 'add_customer', 'check_balance', 'check_stock', 'general_query', 'unknown'] },
    customer_name: { type: ['string', 'null'] },
    customer_phone: { type: ['string', 'null'] },
    item_name: { type: ['string', 'null'] },
    qty: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    query: { type: ['string', 'null'] }
  },
  required: ['action'],
  additionalProperties: false
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { transcript } = await req.json().catch(() => ({ transcript: null }));
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript required' }, { status: 400 });
  }

  const { text, rateLimited } = await askLlm(`${PROMPT}\n\nCommand: "${transcript.trim()}"`, RESPONSE_SCHEMA);

  // A spent quota is a different problem from "the AI couldn't
  // understand you" — the user needs to know to wait, not to try
  // rephrasing a sentence that was never the issue.
  if (rateLimited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!text) return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    console.error('[voice/parse-command] non-JSON reply', text.slice(0, 300));
    return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }
}

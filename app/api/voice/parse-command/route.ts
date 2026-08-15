import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';

// Intent parsing is a small text-only call and should be fast; if it
// isn't back in this long something is wrong upstream and waiting
// longer only makes the assistant feel broken.
const PARSE_TIMEOUT_MS = 7000;

// Voice Command feature: transcript text in, a structured Khata action
// out. Same Gemini generateContent + responseSchema pattern as AI
// Slip-Scan (app/api/stock-in/slip-scan/route.ts) — reused deliberately,
// not a new integration to maintain.
const PROMPT = `You are parsing one spoken voice command given to "Eagle", a voice assistant inside a Pakistani kiryana (grocery) shop's management app. The command was transcribed from speech and may be in Roman Urdu, Urdu, or English, or a mix. It may start with the wake word "Eagle" (or a mis-transcription of it, e.g. "Eagal", "Ego") — ignore that word entirely, it's not part of the command.

Recognize exactly these actions:
- "khata_purchase": a customer received/bought goods on credit (e.g. "Zuhair ke khata mein 4 kilo cheeni add karo", "Ali ko 2 packet biscuit diye", "Zuhair se 500 rupay ka saman gaya")
- "khata_payment": a customer paid money against their balance (e.g. "Zuhair ne 500 rupay diye", "Ali se payment mil gayi 1000 rupay", "Zuhair ne paisa nahi diya" is NOT a payment — only a clearly stated amount actually received counts)
- "khata_return": a customer returned goods (e.g. "Ali ne cheeni wapas ki", "Zuhair ka saman return ho gaya")
- "add_customer": create a NEW customer record (e.g. "naya customer add karo Zuhair", "Ali naam ka customer bana do", "naya khata kholo Bilal ka", "add a new customer named Ahmed"). A phone number may or may not be spoken.
- "check_balance": asking how much a customer owes (e.g. "Zuhair ka balance kitna hai", "Ali kitne ka udhaar hai", "how much does Bilal owe")
- "check_stock": asking how much of an item is in stock (e.g. "cheeni kitni bachi hai", "Dalda ka stock kya hai", "how much rice do we have")
- "general_query": anything else that isn't one of the above — a question, a search request, a calculation, general conversation (e.g. "aaj USD ka rate kya hai", "Google par ye search karo: ...", "2500 ka 15 percent kitna hota hai", "shukriya", "tum kaun ho")

If a command sounds like it's trying to be a money-affecting Khata action (mentions a customer and goods/money) but is missing the customer name or is too ambiguous to act on safely, return action "unknown" — never guess on those. Only fall back to "general_query" when the command clearly isn't about the shop's own records at all.

Fields:
- customer_name: the customer's name exactly as spoken, not invented. Used by khata_* actions, add_customer and check_balance.
- customer_phone: a phone number if one was spoken for add_customer, null otherwise.
- item_name: product name — for khata_purchase/khata_return and check_stock, null otherwise.
- qty: the numeric quantity spoken, null if not mentioned.
- unit: the unit as spoken (kg, packet, piece, litre, dozen...), null if not mentioned.
- amount: a rupee amount only if one was explicitly spoken (null otherwise — the app calculates it from the item's own price when qty + item are known instead).
- query: for "general_query" only — the question or request itself, cleaned up (wake word removed), as plain text. Null for every other action.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['khata_purchase', 'khata_payment', 'khata_return', 'add_customer', 'check_balance', 'check_stock', 'general_query', 'unknown'] },
    customer_name: { type: 'STRING', nullable: true },
    customer_phone: { type: 'STRING', nullable: true },
    item_name: { type: 'STRING', nullable: true },
    qty: { type: 'NUMBER', nullable: true },
    unit: { type: 'STRING', nullable: true },
    amount: { type: 'NUMBER', nullable: true },
    query: { type: 'STRING', nullable: true }
  },
  required: ['action']
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { transcript } = await req.json().catch(() => ({ transcript: null }));
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript required' }, { status: 400 });
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nCommand: "${transcript.trim()}"` }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      })
    }, PARSE_TIMEOUT_MS);
    if (!res.ok) return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(aiText.trim());
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Voice Command feature: transcript text in, a structured Khata action
// out. Same Gemini generateContent + responseSchema pattern as AI
// Slip-Scan (app/api/stock-in/slip-scan/route.ts) — reused deliberately,
// not a new integration to maintain.
const PROMPT = `You are parsing one spoken voice command from a Pakistani kiryana (grocery) shop owner into a structured Khata (customer credit ledger) action. The command was transcribed from speech and may be in Roman Urdu, Urdu, or English, or a mix. It may start with the wake word "Eagle" (or a mis-transcription of it, e.g. "Eagal", "Ego") — ignore that word entirely, it's not part of the command.

Recognize exactly three actions:
- "khata_purchase": the customer received/bought goods on credit (e.g. "Zuhair ke khata mein 4 kilo cheeni add karo", "Ali ko 2 packet biscuit diye", "Zuhair se 500 rupay ka saman gaya")
- "khata_payment": the customer paid money against their balance (e.g. "Zuhair ne 500 rupay diye", "Ali se payment mil gayi 1000 rupay", "Zuhair ne paisa nahi diya" is NOT a payment — only a clearly stated amount actually received counts)
- "khata_return": the customer returned goods (e.g. "Ali ne cheeni wapas ki", "Zuhair ka saman return ho gaya")

If the command doesn't clearly match one of these three, is missing a customer name, or is too ambiguous to act on safely, return action "unknown" — never guess.

Fields:
- customer_name: the customer's name exactly as spoken, not invented.
- item_name: product name — only for khata_purchase/khata_return, null for khata_payment.
- qty: the numeric quantity spoken, null if not mentioned.
- unit: the unit as spoken (kg, packet, piece, litre, dozen...), null if not mentioned.
- amount: a rupee amount only if one was explicitly spoken (null otherwise — the app calculates it from the item's own price when qty + item are known instead).`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['khata_purchase', 'khata_payment', 'khata_return', 'unknown'] },
    customer_name: { type: 'STRING', nullable: true },
    item_name: { type: 'STRING', nullable: true },
    qty: { type: 'NUMBER', nullable: true },
    unit: { type: 'STRING', nullable: true },
    amount: { type: 'NUMBER', nullable: true }
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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\nCommand: "${transcript.trim()}"` }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      })
    });
    if (!res.ok) return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(aiText.trim());
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }
}

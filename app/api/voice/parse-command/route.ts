import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { askLlm } from '@/lib/voice/llm';

// Voice Command feature: transcript text in, a structured action out.
// The LLM call itself lives in lib/voice/llm.ts (shared with
// /api/voice/ask) — see that file for why this runs on OpenAI by
// default rather than Gemini.
const PROMPT = `You are parsing one spoken voice command given to "Eagle", a voice assistant inside a Pakistani kiryana (grocery) shop's management app. The command was transcribed from speech and may be in Roman Urdu, Urdu, or English, or a mix. It may start with the wake word "Eagle" (or a mis-transcription of it, e.g. "Eagal", "Ego") — ignore that word entirely, it's not part of the command.

Recognize exactly these actions:
- "khata_purchase": a customer received/bought goods on credit (e.g. "Zuhair ke khata mein 4 kilo cheeni add karo", "Ali ko 2 packet biscuit diye", "Zuhair se 500 rupay ka saman gaya", "Ali Abdullah ke khata mein 2 headphones ke paise add kar do", "Bilal ke khata mein 3 shampoo daal do"). The customer's khata is named in these, always with a customer_name — that's the giveaway even when the wording talks about "paisa"/"rupay" (the price of the goods), since it's still goods going out on THIS customer's credit, not the shop's own spending. Contrast with "add_expense" below, which never names a customer at all — it's the shop's own bill/rent/salary.
- "khata_payment": the shop RECEIVED money from a customer — a repayment, a part payment, or an advance paid up front (e.g. "Zuhair ne 500 rupay diye", "Ali se payment mil gayi 1000 rupay", "Ali ne mujhe 1000 rupay advance diya", "Bilal ne 2000 jama karaye"). An advance counts here exactly like any other payment: money came in. "Zuhair ne paisa nahi diya" is NOT a payment — only a clearly stated amount actually received counts.
- "khata_return": a customer returned goods (e.g. "Ali ne cheeni wapas ki", "Zuhair ka saman return ho gaya")
- "add_customer": create a NEW customer record, OR set/update an existing customer's phone number — both go through this same action (e.g. "naya customer add karo Zuhair", "Ali naam ka customer bana do", "Irshad Khan ka contact add karo, 03049444902", "Zuhair ka number update karo 0300xxxxxxx"). A phone number may or may not be spoken.
- "check_balance": asking how much a customer owes (e.g. "Zuhair ka balance kitna hai", "Ali kitne ka udhaar hai", "how much does Bilal owe")
- "check_stock": asking how much of one specific item is in stock (e.g. "cheeni kitni bachi hai", "Dalda ka stock kya hai", "how much rice do we have")
- "inventory_summary": asking about overall inventory health rather than one item — how many products, what's low/out of stock (e.g. "poori inventory ka haal batao", "kitne items kam stock mein hain", "kya kya khatam ho gaya hai", "stock ki overall situation kya hai")
- "print_statement": print / show / open a customer's full khata statement, no mention of WhatsApp/sending (e.g. "Ahsan ka khata nikal ke sara data print kar do", "Zuhair ka statement print karo", "Ali ka poora hisaab nikalo", "print Bilal's account statement")
- "send_statement_whatsapp": send a customer's khata summary over WhatsApp (e.g. "Ali Abdullah ka khata print karke is number pe WhatsApp kar do, 03001234567", "Zuhair ka hisaab whatsapp kar do", "Bilal ke number par uska statement bhej do"). If a phone number was spoken in the command, put it in target_phone; if none was spoken, leave target_phone null (the app falls back to the customer's own saved number).
- "stock_in": new stock arrived for an item already (or about to be) in inventory — a purchase into the shop's own stock, NOT a customer's khata (e.g. "Dalda cooking oil ka 10 piece stock mein add karo", "cheeni ke 5 bori aaye hain add kar do", "20 packet biscuit stock in karo")
- "stock_out": stock leaving inventory for a reason OTHER than a normal counter sale — damage, personal use, a correction (e.g. "2 packet biscuit kharab ho gaye, stock se nikal do", "5 piece cheeni adjust kar do stock mein se"). A normal walk-in cash sale belongs on the Billing/POS screen, not here — if the command sounds like ringing up a sale rather than removing damaged/miscounted stock, treat it as "unknown".
- "add_expense": a shop expense being logged — the shop's OWN spending (rent, bills, salary...), never a customer's khata (e.g. "500 rupay bijli ka bill add karo", "2000 rupay dukaan ka kiraya expense mein daal do", "salary ka 5000 add karo"). If a customer's name is mentioned at all, it isn't this — it's khata_purchase instead. expense_category must be one of: rent, salary, utility, marketing, other — pick the closest match, default "other" if unclear.
- "check_expense_total": asking today's/this-shop's total expenses (e.g. "aaj ka expense kitna hua", "is mahine ka kharcha kitna hai")
- "check_sales_total": asking today's total sales revenue (e.g. "aaj ki sale kitni hui", "aaj kitna kama liya")
- "check_supplier_balance": asking how much the shop owes a supplier (e.g. "XYZ supplier ka kitna udhaar hai", "hum ne supplier ko kitne dene hain")
- "supplier_payment": the shop PAID a supplier (e.g. "supplier ko 1000 rupay de diye", "ABC ko 500 rupay payment kar do")
- "general_query": anything else — a question, a search request, a calculation, general conversation (e.g. "aaj USD ka rate kya hai", "Google par ye search karo: ...", "2500 ka 15 percent kitna hota hai", "shukriya", "tum kaun ho")

If a command sounds like it's trying to be a money- or stock-affecting action (mentions a customer/supplier/item and goods/money) but is missing a needed name or is too ambiguous to act on safely, return action "unknown" — never guess on those. Only fall back to "general_query" when the command clearly isn't about the shop's own records at all.

Fields:
- customer_name: the customer's name exactly as spoken, not invented. Used by khata_* actions, add_customer, check_balance and print_statement.
- customer_phone: a phone number if one was spoken for add_customer, null otherwise.
- target_phone: a phone number if one was spoken for send_statement_whatsapp, null otherwise.
- supplier_name: the supplier's name exactly as spoken. Used by check_supplier_balance and supplier_payment, null otherwise.
- item_name: product name — for khata_purchase/khata_return/check_stock/stock_in/stock_out, null otherwise.
- qty: the numeric quantity spoken, null if not mentioned.
- unit: the unit as spoken (kg, packet, piece, litre, dozen...), null if not mentioned.
- amount: a rupee amount only if one was explicitly spoken (null otherwise — the app calculates it from the item's own price when qty + item are known instead, for the actions where that applies).
- expense_category: only for add_expense — one of rent/salary/utility/marketing/other. Null otherwise.
- query: for "general_query" only — the question or request itself, cleaned up (wake word removed), as plain text. Null for every other action.

You may be given the last few turns of this same conversation before the new command. Use them ONLY to resolve a vague reference in the new command — a pronoun ("usay", "ussi ko", "unhe") or an implied repeat ("aur 500 bhi de do", "wapas wahi karo") that refers to a customer or item named in a recent turn. Never carry a customer/item name forward when the new command already names someone/something different, and never use history to fill in a customer name for an action that doesn't mention a customer reference at all.

Reply with JSON only.`;

// Lowercase JSON Schema — what OpenAI's json_schema response format
// expects. Gemini accepts this shape too (it reads the same keys,
// case-insensitively for types).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'khata_purchase', 'khata_payment', 'khata_return', 'add_customer', 'check_balance', 'check_stock', 'inventory_summary', 'print_statement', 'send_statement_whatsapp',
        'stock_in', 'stock_out', 'add_expense', 'check_expense_total', 'check_sales_total', 'check_supplier_balance', 'supplier_payment',
        'general_query', 'unknown'
      ]
    },
    customer_name: { type: ['string', 'null'] },
    customer_phone: { type: ['string', 'null'] },
    target_phone: { type: ['string', 'null'] },
    supplier_name: { type: ['string', 'null'] },
    item_name: { type: ['string', 'null'] },
    qty: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] },
    expense_category: { type: ['string', 'null'], enum: ['rent', 'salary', 'utility', 'marketing', 'other', null] },
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

  const { transcript, history } = await req.json().catch(() => ({ transcript: null, history: null }));
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript required' }, { status: 400 });
  }

  // Short-term memory: the last few exchanges, sent by the client
  // (VoicePage keeps this in memory only — nothing persisted server-
  // side). Capped defensively here too in case a caller ever sends
  // more; each turn is one short line, so even the max cost is small.
  const historyLines = Array.isArray(history)
    ? history
        .slice(-4)
        .filter((h: any) => h && typeof h.user === 'string' && typeof h.eagle === 'string')
        .map((h: any) => `User: ${h.user}\nEagle: ${h.eagle}`)
        .join('\n')
    : '';
  const historyBlock = historyLines ? `\n\nRecent conversation:\n${historyLines}` : '';

  const { text, rateLimited } = await askLlm(`${PROMPT}${historyBlock}\n\nNew command: "${transcript.trim()}"`, RESPONSE_SCHEMA);

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

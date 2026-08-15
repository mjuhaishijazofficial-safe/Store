import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// AI Slip-Scan (Master Handoff Spec §10 / §23): a photo of a supplier
// slip → structured {item, qty, price} rows, via Gemini's vision
// capability directly — no separate OCR pipeline, same as the spec's
// own recommendation for a vision-capable LLM. Gemini (not Claude) is
// deliberate here — free-tier API key, no billing setup needed to get
// this feature working. A plain fetch() against the generateContent
// endpoint rather than pulling in @google/generative-ai as a new
// dependency for one call. Swap back to Claude (or any other
// vision-capable model) later just by changing this one route.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // stop well before Gemini's inline-image limit with a clear error instead of a rejected API call.

const EXTRACTION_PROMPT = `You are reading a photo of a handwritten or printed supplier delivery slip / invoice for a small Pakistani kiryana (grocery) shop.

Extract every line item. "name" is the product name as written (don't translate or invent a brand you can't read). "qty" is the quantity of that line (a plain number, no units in the string). "unit_price" is the price per unit/piece for that line (not the line total) — if only a line total is written, divide it by qty. Skip lines that are clearly not products (totals, dates, supplier letterhead, signatures). If the photo is too blurry/dark/rotated to read confidently, return an empty items array with confidence "low". Numbers may be in Urdu or English digits — always output plain Arabic numerals.`;

// Constrains Gemini's output to exactly this shape (responseSchema) —
// more reliable than a "return only JSON" prompt instruction alone,
// and Gemini still returns it as a JSON *string* in the response body
// (see aiText below), not a separately-typed field.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          unit_price: { type: 'NUMBER' }
        },
        required: ['name', 'qty', 'unit_price']
      }
    },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }
  },
  required: ['items', 'confidence']
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  // Stock-in / Slip Scan is Owner-only per the permissions matrix (spec
  // §17 — Cashier has no Stock-in access at all).
  if (!profile || profile.role !== 'owner') {
    return NextResponse.json({ error: 'owners only' }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Graceful, specific failure (spec §33 edge case: never a blank
    // confirm screen or a crash) — Barcode Scan / Manual Add stay
    // available as the fallback this feature was always meant to have.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { image, mediaType } = await req.json().catch(() => ({ image: null, mediaType: null }));
  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'image required' }, { status: 400 });
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) {
    return NextResponse.json({ error: 'unsupported image type' }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_BYTES * 4 / 3) {
    return NextResponse.json({ error: 'image too large' }, { status: 400 });
  }

  let aiText: string;
  try {
    // A Google-maintained alias, not a pinned
    // snapshot — verified live against this key's account (2026-08):
    // 'gemini-2.0-flash' itself has been retired for new API keys
    // ("no longer available to new users"), the alias keeps this
    // working without needing a code change on Google's next model bump.
    const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType, data: image } },
            { text: EXTRACTION_PROMPT }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      })
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
    }
    const data = await res.json();
    aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    return NextResponse.json({ error: 'ai_request_failed' }, { status: 502 });
  }

  let parsed: { items?: { name: string; qty: number; unit_price: number }[]; confidence?: string };
  try {
    parsed = JSON.parse(aiText.trim());
  } catch {
    return NextResponse.json({ error: 'unreadable_slip' }, { status: 422 });
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'unreadable_slip' }, { status: 422 });
  }

  // Match against this shop's own inventory by exact case-insensitive
  // name (spec §10's "Maujood"/"Naya Item" badge) — a fuzzier match
  // risks silently attaching a delivery to the wrong existing item,
  // which is worse than asking the owner to confirm one more "Naya
  // Item" than strictly necessary.
  const { data: existing } = await supabase.from('items').select('id, name').eq('shop_id', profile.shop_id);
  const byName = new Map((existing || []).map(i => [i.name.trim().toLowerCase(), i.id]));

  const items = rawItems
    .filter(r => r && typeof r.name === 'string' && r.name.trim())
    .map(r => {
      const matchedId = byName.get(r.name.trim().toLowerCase()) || null;
      return {
        name: r.name.trim(),
        qty: Number(r.qty) > 0 ? Number(r.qty) : 1,
        unit_price: Number(r.unit_price) >= 0 ? Number(r.unit_price) : 0,
        matched_item_id: matchedId
      };
    });

  return NextResponse.json({ items, confidence: parsed.confidence || 'medium' });
}

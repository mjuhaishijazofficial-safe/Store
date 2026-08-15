import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchWithTimeout } from '@/lib/voice/fetch-timeout';

// A few seconds of audio transcribes in about a second normally —
// anything past this is a stall, and waiting it out just leaves the
// user staring at a spinner.
const WHISPER_TIMEOUT_MS = 15000;

// Voice Command feature, Whisper leg: audio in, transcript out. Runs
// server-side deliberately (not a direct client -> OpenAI call) so
// OPENAI_API_KEY never reaches the browser — same reasoning as every
// other third-party key in this app (Gemini, Stripe).
//
// Privacy (spec requirement for this feature): the audio blob only ever
// exists in memory for this one request — never written to disk or a
// table, forwarded to OpenAI and then discarded the moment this handler
// returns. No audio-retention code exists anywhere in this route.
// Generous ceiling — the point isn't limiting real usage (a shop
// speaking 200 voice commands in one day is implausible), it's making
// sure a stuck recorder / retry loop / bug can't quietly run up real
// Whisper API cost overnight with nobody noticing.
const DAILY_LIMIT_PER_SHOP = 200;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Graceful, specific failure (same pattern as Slip-Scan's Gemini
    // key check) — the mic button surfaces this as "Whisper abhi
    // configure nahi hai" rather than a generic error.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: usedToday } = await supabase
    .from('voice_command_log')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', profile.shop_id)
    .gte('created_at', todayStart.toISOString());
  if ((usedToday || 0) >= DAILY_LIMIT_PER_SHOP) {
    console.warn('[voice/transcribe] daily limit reached', { shopId: profile.shop_id, usedToday });
    return NextResponse.json({ error: 'daily_limit_reached' }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!audio || !(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'audio required' }, { status: 400 });
  }
  // A stuck/misfiring recorder sending minutes of audio would otherwise
  // burn API cost silently — a single voice command is a few seconds.
  const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'audio too large' }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('file', audio, 'command.webm');
  upstream.append('model', 'whisper-1');
  // Language is deliberately NOT pinned. It used to be forced to 'ur',
  // which made Whisper try to hear every command as Urdu — an English
  // sentence then came back mangled into Urdu-ish nonsense that nothing
  // downstream could parse. Left unset, Whisper detects the language
  // itself per recording, so Urdu, English and the Roman-Urdu mix real
  // shopkeepers actually speak all transcribe correctly.
  //
  // The prompt below is Whisper's own context hint — it biases spelling
  // toward the vocabulary this app expects (Urdu shop terms and the
  // wake word) without constraining the language.
  upstream.append('prompt', 'Eagle, khata, udhaar, customer, stock, balance, rupay, kilo, packet, advance, payment.');

  let res: Response;
  try {
    res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream
    }, WHISPER_TIMEOUT_MS);
  } catch (e: any) {
    console.error('[voice/transcribe] fetch to OpenAI threw', e?.message || e);
    return NextResponse.json({ error: 'transcribe_failed' }, { status: 502 });
  }

  if (!res.ok) {
    // Logged server-side (visible in Vercel's function logs) — OpenAI's
    // actual error text (bad/revoked key, no billing on the account,
    // unsupported audio format...) is what actually explains a 502 here;
    // a bare 'transcribe_failed' with nothing else was undiagnosable
    // from the browser console alone, which is exactly what happened.
    const upstreamBody = await res.text().catch(() => '');
    console.error('[voice/transcribe] OpenAI responded', res.status, upstreamBody.slice(0, 500));
    return NextResponse.json({ error: 'transcribe_failed', upstreamStatus: res.status }, { status: 502 });
  }
  const data = await res.json().catch(() => null);

  // Logged after a successful call, not before — a request that never
  // reaches Whisper (missing key, oversized audio, rate-limited) never
  // actually cost anything, so it shouldn't count against the cap.
  await supabase.from('voice_command_log').insert({ shop_id: profile.shop_id });
  console.log('[voice/transcribe] whisper call', { shopId: profile.shop_id, usedToday: (usedToday || 0) + 1 });

  return NextResponse.json({ transcript: data?.text || '' });
}

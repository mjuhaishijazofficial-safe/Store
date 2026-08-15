'use client';

// Free text-to-speech: the browser's own SpeechSynthesis API — zero
// cost, no API key, same "free by default" choice already made for
// speech-to-text's fallback provider (web-speech-stt.ts).
//
// Two things make this API unreliable if used naively, and both were
// why Eagle showed its reply as text but never actually said it:
//
// 1. getVoices() returns an EMPTY array on the first call in Chrome —
//    the voice list loads asynchronously and only then fires
//    'voiceschanged'. Code that reads it once at speak() time sees
//    nothing and picks no voice.
// 2. Setting utterance.lang to a language the device has NO voice for
//    (ur-PK on essentially every desktop) makes Chrome silently drop
//    the utterance rather than falling back to a default voice. So
//    "no Urdu voice installed" became "no speech at all", not
//    "speech in an English accent".
//
// Both are handled below: wait for the real voice list, then only ever
// set a lang we actually have a voice for.

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise(resolve => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) { resolve(existing); return; }
    // Fires once the list is actually populated. The timeout is a
    // backstop for browsers that never fire it (some Android WebViews)
    // — resolving with whatever is available beats hanging forever and
    // never speaking at all.
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
  return voicesPromise;
}

// Chrome only allows speech after the page has seen a user gesture.
// Called from the mic button's own click handler (a real gesture) so
// the first actual reply isn't the one that gets swallowed.
export function primeTts() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  loadVoices();
  // A zero-length utterance is enough to satisfy the gesture
  // requirement without making any audible sound.
  try {
    const warmup = new SpeechSynthesisUtterance('');
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  } catch {
    // Non-fatal — worst case the first reply is silent and later ones work.
  }
}

export async function speak(text: string, lang: 'ur' | 'en') {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text.trim()) return;
  const voices = await loadVoices();

  // Prefer a voice in the requested language; fall back to any English
  // voice, then to whatever the browser's default is. Urdu text read by
  // an English voice is imperfect but understandable — and far better
  // than the silence that setting an unsupported lang produces.
  const preferred =
    voices.find(v => v.lang.toLowerCase().startsWith(lang === 'ur' ? 'ur' : 'en')) ||
    voices.find(v => v.lang.toLowerCase().startsWith('en')) ||
    voices[0];

  // Cancel first — without this, moving through several stages quickly
  // (e.g. an error right after a confirm) queues utterances instead of
  // replacing them, and Eagle ends up talking over itself.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  if (preferred) {
    utterance.voice = preferred;
    // Match lang to the voice we actually chose — never leave it as a
    // language with no installed voice (see the note at the top).
    utterance.lang = preferred.lang;
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
}

export function isTtsSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis;
}

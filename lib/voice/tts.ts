'use client';

// Free text-to-speech: the browser's own SpeechSynthesis API — zero
// cost, no API key, same "free by default" choice already made for
// speech-to-text's fallback provider (web-speech-stt.ts). Picks a voice
// matching the requested language if the device has one installed;
// still speaks with the default voice otherwise (just not in an Urdu
// accent) rather than staying silent.
export function speak(text: string, lang: 'ur' | 'en') {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text.trim()) return;
  // Cancel first — without this, tapping through several stages fast
  // (e.g. an error right after a confirm) queues utterances instead of
  // replacing them, and Eagle ends up talking over itself.
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find(v => v.lang.toLowerCase().startsWith(lang === 'ur' ? 'ur' : 'en'));
  if (match) utterance.voice = match;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
}

export function isTtsSupported() {
  return typeof window !== 'undefined' && !!window.speechSynthesis;
}

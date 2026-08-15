import type { SttProvider } from './types';
import { webSpeechStt } from './web-speech-stt';
import { whisperStt } from './whisper-stt';

// Whisper is the chosen default (better Roman-Urdu/Urdu accuracy than
// the browser's free Web Speech API, and cheap — only the few seconds
// of audio after the mic button is tapped ever gets sent, not
// continuous listening). Falls back to the free Web Speech API if
// NEXT_PUBLIC_VOICE_STT_PROVIDER=webspeech is set explicitly — e.g. to
// keep testing at zero cost before OPENAI_API_KEY is configured
// server-side (whisperStt already degrades to a clear
// "whisper_not_configured" error if that key is missing, so leaving
// this on 'whisper' without the key set is still safe, just not
// functional yet).
export function getSttProvider(): SttProvider {
  return process.env.NEXT_PUBLIC_VOICE_STT_PROVIDER === 'webspeech' ? webSpeechStt : whisperStt;
}

'use client';

import type { SttProvider } from './types';

// Free default: the browser's own native SpeechRecognition (Chrome/Edge/
// Android — "webkitSpeechRecognition" is the vendor-prefixed name every
// shipping implementation still uses). Zero cost, no API key, no server
// round-trip for audio at all — the browser does its own cloud
// recognition and hands back text directly. Not supported in Firefox/
// Safari; isSupported below is what the UI checks before offering it.
let recognition: any = null;

export const webSpeechStt: SttProvider = {
  get isSupported() {
    if (typeof window === 'undefined') return false;
    return !!((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
  },

  listen(lang, onInterim) {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      if (!SpeechRecognition) { reject(new Error('not_supported')); return; }

      recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.interimResults = !!onInterim;
      recognition.maxAlternatives = 1;
      // Not continuous — one command per tap, matches how the mic
      // button is meant to be used ("Eagle, <command>", then done).
      // The browser auto-stops on its own after a pause in speech, so a
      // second tap to stop is a manual override, not the normal path.
      recognition.continuous = false;

      let finalTranscript = '';
      recognition.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) finalTranscript += result[0].transcript;
          else onInterim?.(result[0].transcript);
        }
      };
      recognition.onerror = (e: any) => reject(new Error(e.error || 'speech_error'));
      recognition.onend = () => {
        if (finalTranscript.trim()) resolve(finalTranscript.trim());
        else reject(new Error('no_speech'));
      };
      recognition.start();
    });
  },

  stop() {
    recognition?.stop();
  }
};

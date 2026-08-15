'use client';

// True hands-free activation: the browser's own SpeechRecognition (same
// free engine web-speech-stt.ts uses) running continuously, but only to
// catch the wake word — the actual command still goes through whichever
// STT provider is configured (Whisper by default). This is a real web
// page limitation, not something worth hiding: it only listens while
// this tab is open and in the foreground, unlike a phone assistant's
// always-on background wake word. isWakeWordSupported() is what the UI
// checks before offering the toggle at all (Firefox/Safari have none of
// this API).
const WAKE_PATTERNS = [/\beagle\b/i, /\beagal\b/i, /\bego\b/i, /\bigal\b/i, /\baigal\b/i, /ایگل/, /ای گل/];

export type WakeWordHandle = { stop: () => void };

export function isWakeWordSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
}

export function startWakeWordListener(lang: string, onWake: () => void, onError?: (reason: string) => void): WakeWordHandle {
  const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
  let recognition: any = null;
  let stopped = false;

  function begin() {
    if (stopped) return;
    recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text: string = e.results[i][0]?.transcript || '';
        if (WAKE_PATTERNS.some(p => p.test(text))) {
          // Stops itself and does not restart — the caller takes the mic
          // from here (Whisper's own getUserMedia). Leaving this
          // recognizer running would fight it for the microphone.
          stopped = true;
          try { recognition.stop(); } catch { /* already stopping */ }
          onWake();
          return;
        }
      }
    };

    recognition.onerror = (e: any) => {
      // 'no-speech' and 'aborted' are routine on a continuous listener —
      // it naturally times out during silence and Chrome fires these
      // constantly in normal idle use. Restart quietly rather than
      // surfacing them as real errors.
      if (e.error === 'no-speech' || e.error === 'aborted') { scheduleRestart(); return; }
      onError?.(e.error || 'wake_error');
    };

    recognition.onend = () => { if (!stopped) scheduleRestart(); };

    try { recognition.start(); } catch { scheduleRestart(); }
  }

  function scheduleRestart() {
    if (stopped) return;
    setTimeout(() => { if (!stopped) begin(); }, 300);
  }

  begin();

  return {
    stop() {
      stopped = true;
      try { recognition?.stop(); } catch { /* already stopped */ }
    }
  };
}

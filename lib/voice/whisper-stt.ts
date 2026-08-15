'use client';

import type { SttProvider } from './types';

// Paid upgrade path (once there's budget): records raw audio and sends
// it to /api/voice/transcribe, which calls OpenAI Whisper server-side
// (OPENAI_API_KEY). Same SttProvider shape as webSpeechStt — swapping
// the active provider is a one-line env change
// (NEXT_PUBLIC_VOICE_STT_PROVIDER), nothing else in the voice-command
// feature has to change.
//
// Auto-stops on its own once the speaker goes quiet, via a Web Audio
// AnalyserNode watching the mic's own volume level — MediaRecorder has
// no built-in "stopped talking" signal the way SpeechRecognition does,
// so this is hand-rolled. stop() is still exposed for an early manual
// cut-off (a second tap on the mic button), but nobody should actually
// need it in normal use — that's the whole fix for "it just sits there
// listening and never responds" (silence used to require a second tap
// the UI only hinted at in small text under the button).
const SILENCE_THRESHOLD = 10; // 0-255 volume scale (analyser byte data) — below this counts as quiet. Tune up if a noisy shop floor trips silence detection while someone is still mid-sentence.
const SILENCE_DURATION_MS = 900; // how long it has to stay quiet after real speech was heard before auto-stopping. Was 1400ms — trimmed since every extra ms here is pure dead air on top of the transcribe+parse round trips that follow, and 900ms is still comfortably longer than a natural mid-sentence breath.
const MAX_RECORDING_MS = 20000; // hard ceiling regardless of silence detection — never records forever even if silence detection somehow never fires.

let mediaRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let stopFn: (() => void) | null = null;

export const whisperStt: SttProvider = {
  get isSupported() {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!(window as any).MediaRecorder;
  },

  async listen(lang, _onInterim, onPhase) {
    // Surfaces the real reason instead of a generic "could not access
    // microphone" — getUserMedia's DOMException.name is what actually
    // distinguishes "you said no", "no mic exists", "another app has it
    // open", and "this page isn't secure enough to even ask" from each
    // other; VoicePage maps each to its own message.
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      throw new Error(`mic_${e?.name || 'unknown'}`);
    }

    // Everything from here on is NOT a mic-access problem even though
    // it happens right after getting the mic — a bug here used to fall
    // through to the same generic "could not access microphone" message
    // as an actual getUserMedia denial, which is actively misleading
    // (that's exactly what made this hard to diagnose from a user
    // report alone). Each stage below now throws its own distinct code.
    let blob: Blob;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(activeStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const levelData = new Uint8Array(analyser.frequencyBinCount);

      const chunks: BlobPart[] = [];
      mediaRecorder = new MediaRecorder(activeStream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const recorded = new Promise<Blob>(resolve => {
        mediaRecorder!.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
      });
      mediaRecorder.start();

      let rafId = 0;
      let silenceStartedAt: number | null = null;
      let speechHeard = false;
      const startedAt = Date.now();

      stopFn = () => {
        cancelAnimationFrame(rafId);
        audioCtx.close().catch(() => {});
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      };

      function watchLevel() {
        analyser.getByteFrequencyData(levelData);
        const avg = levelData.reduce((sum, v) => sum + v, 0) / levelData.length;
        const now = Date.now();

        if (avg > SILENCE_THRESHOLD) {
          speechHeard = true;
          silenceStartedAt = null;
        } else if (speechHeard) {
          if (silenceStartedAt === null) silenceStartedAt = now;
          else if (now - silenceStartedAt > SILENCE_DURATION_MS) { stopFn?.(); return; }
        }
        if (now - startedAt > MAX_RECORDING_MS) { stopFn?.(); return; }
        rafId = requestAnimationFrame(watchLevel);
      }
      watchLevel();

      blob = await recorded;
      stopFn = null;
    } catch (e: any) {
      stopFn = null;
      activeStream?.getTracks().forEach(t => t.stop());
      activeStream = null;
      throw new Error(`recording_failed: ${e?.message || e?.name || 'unknown'}`);
    }

    activeStream?.getTracks().forEach(t => t.stop());
    activeStream = null;
    onPhase?.('transcribing');

    try {
      const form = new FormData();
      form.append('audio', blob, 'command.webm');
      form.append('lang', lang);
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error === 'not_configured' ? 'whisper_not_configured' : 'transcribe_failed');
      }
      const data = await res.json();
      if (!data.transcript || !String(data.transcript).trim()) throw new Error('no_speech');
      return String(data.transcript).trim();
    } catch (e: any) {
      if (e?.message === 'whisper_not_configured' || e?.message === 'transcribe_failed' || e?.message === 'no_speech') throw e;
      // fetch() itself throwing (offline, DNS, CORS...) rather than
      // resolving with a non-ok response — a genuinely different
      // problem from "Whisper said no".
      throw new Error('network_error');
    }
  },

  stop() {
    stopFn?.();
  }
};

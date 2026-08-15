'use client';

import type { SttProvider } from './types';
import { fetchWithTimeout } from './fetch-timeout';

// Bounded so a stalled upload can't leave the UI sitting in
// "transcribing" indefinitely — slightly above the route's own Whisper
// timeout so the server still gets to answer first when it can.
const TRANSCRIBE_TIMEOUT_MS = 18000;

// Records mic audio and sends it to /api/voice/transcribe, which calls
// OpenAI Whisper server-side (OPENAI_API_KEY). Same SttProvider shape as
// webSpeechStt — swapping the active provider is a one-line env change
// (NEXT_PUBLIC_VOICE_STT_PROVIDER), nothing else in the voice-command
// feature has to change.
//
// Voice-activity detection is hand-rolled (MediaRecorder has no
// "stopped talking" signal the way SpeechRecognition does) and modelled
// on how Google's mic behaves: calibrate the room's own noise floor
// first, treat anything meaningfully above it as speech, and stop
// shortly after the speaker goes quiet. A fixed absolute threshold
// (what this used to do) can't work across a silent room and a busy
// shop floor at once — too high and a soft speaker never registers at
// all, too low and background hum reads as endless speech.
const CALIBRATION_MS = 250;        // ambient-noise sampling window at the very start, before speech is expected.
const NOISE_MARGIN = 0.006;        // how far above the measured noise floor RMS must rise to count as speech. Deliberately small — a soft or distant speaker barely clears the room's own floor, and missing their speech entirely is a far worse failure than briefly treating a cough as speech (the transcript just ignores it).
const MIN_SPEECH_RMS = 0.008;      // absolute floor — protects against a near-silent calibration making the threshold hair-trigger.
const SILENCE_DURATION_MS = 650;   // quiet time after speech before auto-stopping. Trimmed from 800ms — every ms here is dead air stacked on top of the upload+transcribe+parse round trips that follow, and 650ms is still comfortably past a natural mid-sentence breath.
const NO_SPEECH_TIMEOUT_MS = 7000; // if nothing is ever heard, give up rather than recording (and later uploading) 20s of silence.
const MAX_RECORDING_MS = 20000;    // hard ceiling regardless of everything above.

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
      activeStream = await navigator.mediaDevices.getUserMedia({
        // Browser-side cleanup before the audio ever reaches the
        // detector below — the same processing that makes a laptop mic
        // usable on a video call, and what keeps the noise floor low
        // enough for a soft speaker to clear it.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e: any) {
      throw new Error(`mic_${e?.name || 'unknown'}`);
    }

    // Everything from here on is NOT a mic-access problem even though
    // it happens right after getting the mic — a bug here used to fall
    // through to the same generic "could not access microphone" message
    // as an actual getUserMedia denial, which is actively misleading.
    // Each stage below now throws its own distinct code.
    let blob: Blob;
    let heardSpeech = false;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      // Safari/iOS hands back a suspended context when it wasn't opened
      // directly inside a user gesture — without this the analyser
      // silently reads pure zeros forever, which looks exactly like
      // "it never hears me".
      if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
      const source = audioCtx.createMediaStreamSource(activeStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      // Time-domain samples, not frequency bins: RMS over the raw
      // waveform tracks how loud someone actually is, whereas averaging
      // frequency magnitudes across every bin dilutes a voice (which
      // occupies a narrow band) into the noise around it — the reason
      // normal speech could sit under a fixed frequency-average
      // threshold and never register.
      const samples = new Uint8Array(analyser.fftSize);

      const chunks: BlobPart[] = [];
      mediaRecorder = new MediaRecorder(activeStream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const recorded = new Promise<Blob>(resolve => {
        mediaRecorder!.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
      });
      mediaRecorder.start();

      let rafId = 0;
      let silenceStartedAt: number | null = null;
      let noiseFloor = 0;
      let calibrationSamples = 0;
      const startedAt = Date.now();

      stopFn = () => {
        cancelAnimationFrame(rafId);
        audioCtx.close().catch(() => {});
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      };

      function watchLevel() {
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
          const centered = (samples[i] - 128) / 128; // byte range is 0-255 centered on 128
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        const now = Date.now();
        const elapsed = now - startedAt;

        if (elapsed < CALIBRATION_MS) {
          // Rolling average of the room before anyone speaks.
          noiseFloor = (noiseFloor * calibrationSamples + rms) / (calibrationSamples + 1);
          calibrationSamples++;
          rafId = requestAnimationFrame(watchLevel);
          return;
        }

        const threshold = Math.max(noiseFloor + NOISE_MARGIN, MIN_SPEECH_RMS);
        if (rms > threshold) {
          heardSpeech = true;
          silenceStartedAt = null;
        } else if (heardSpeech) {
          if (silenceStartedAt === null) silenceStartedAt = now;
          else if (now - silenceStartedAt > SILENCE_DURATION_MS) { stopFn?.(); return; }
        } else if (elapsed > NO_SPEECH_TIMEOUT_MS) {
          // Nothing was ever heard — stop now instead of running out the
          // full ceiling and then uploading 20s of silence to Whisper.
          stopFn?.();
          return;
        }

        if (elapsed > MAX_RECORDING_MS) { stopFn?.(); return; }
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

    // Skip the upload entirely when the detector never heard anyone —
    // Whisper happily "transcribes" silence into a plausible-looking
    // hallucinated sentence, which is far worse than admitting nothing
    // was heard, and it costs an API call to get that wrong answer.
    if (!heardSpeech) throw new Error('no_speech');

    onPhase?.('transcribing');

    try {
      const form = new FormData();
      form.append('audio', blob, 'command.webm');
      form.append('lang', lang);
      const res = await fetchWithTimeout('/api/voice/transcribe', { method: 'POST', body: form }, TRANSCRIBE_TIMEOUT_MS);
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

'use client';

import type { SttProvider } from './types';

// Paid upgrade path (once there's budget): records raw audio and sends
// it to /api/voice/transcribe, which calls OpenAI Whisper server-side
// (OPENAI_API_KEY). Push-to-talk, not silence-detection — MediaRecorder
// has no built-in "stopped talking" signal the way SpeechRecognition
// does, so the caller (VoiceCommandButton) calls stop() itself on the
// second tap. Same SttProvider shape as webSpeechStt — swapping the
// active provider is a one-line env change (NEXT_PUBLIC_VOICE_STT_PROVIDER),
// nothing else in the voice-command feature has to change.
let mediaRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;

export const whisperStt: SttProvider = {
  get isSupported() {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!(window as any).MediaRecorder;
  },

  async listen(lang) {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: BlobPart[] = [];
    mediaRecorder = new MediaRecorder(activeStream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const recorded = new Promise<Blob>(resolve => {
      mediaRecorder!.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
    });
    mediaRecorder.start();

    const blob = await recorded;
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;

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
  },

  stop() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }
};

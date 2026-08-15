// Shared shape both speech-to-text providers implement — kept in its own
// file (not inside either provider) so stt-provider.ts can import both
// providers plus this type without any circular-import risk.

// 'recording' = still capturing audio; 'transcribing' = recording ended,
// waiting on the network round trip to turn it into text. Whisper's
// provider fires both (there's a real gap between them — the upload +
// OpenAI call); webSpeechStt never fires 'transcribing' since it has no
// separate step, the browser resolves straight to text.
export type SttPhase = 'recording' | 'transcribing';

export type SttProvider = {
  // Cheap to check up-front (no permission prompt) so the mic button can
  // grey itself out with a clear reason instead of failing after a tap.
  isSupported: boolean;
  // Starts listening in the given BCP-47 language, resolves with the
  // final transcript once the user (or the provider's own silence
  // detection) stops. onInterim is optional live-partial-text feedback
  // while listening (cosmetic only, callers must not act on it);
  // onPhase lets the UI show "transcribing" instead of implying it's
  // still hearing you during that dead-air network wait — without it,
  // a several-second Whisper round trip looks indistinguishable from
  // the button just not responding.
  listen: (lang: string, onInterim?: (text: string) => void, onPhase?: (phase: SttPhase) => void) => Promise<string>;
  // Stops an in-flight listen() early (user tapped the mic again).
  stop: () => void;
};

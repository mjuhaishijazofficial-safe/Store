// Shared shape both speech-to-text providers implement — kept in its own
// file (not inside either provider) so stt-provider.ts can import both
// providers plus this type without any circular-import risk.

export type SttProvider = {
  // Cheap to check up-front (no permission prompt) so the mic button can
  // grey itself out with a clear reason instead of failing after a tap.
  isSupported: boolean;
  // Starts listening in the given BCP-47 language, resolves with the
  // final transcript once the user (or the provider's own silence
  // detection) stops. onInterim is optional live-partial-text feedback
  // while listening — cosmetic only, callers must not act on it.
  listen: (lang: string, onInterim?: (text: string) => void) => Promise<string>;
  // Stops an in-flight listen() early (user tapped the mic again).
  stop: () => void;
};

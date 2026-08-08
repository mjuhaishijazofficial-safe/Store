// A tiny localStorage read-cache — not a general offline database, just
// "if the last load worked, remember it, so a failed refresh shows the
// shop's real numbers from a minute ago instead of a blank/broken page."
// Scoped to the two screens that most need to work at the counter
// (Inventory, Khata) rather than applied everywhere, since most pages
// are fine to just show a loading/error state.

export function saveCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(`cache:${key}`, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Storage full or unavailable (private browsing) — caching is a
    // nice-to-have, never worth failing the actual page over.
  }
}

export function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    return (JSON.parse(raw).data as T) ?? null;
  } catch {
    return null;
  }
}

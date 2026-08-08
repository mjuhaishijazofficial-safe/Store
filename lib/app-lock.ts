// App Lock — a device-local "quick relock" PIN, not a second Supabase
// auth factor. The threat this defends against is the shop's shared
// counter phone being left unlocked with the dashboard still open, not
// a determined attacker: the PIN and its hash never leave the browser,
// there's no server round trip to check it, and it's scoped per browser
// profile via localStorage/sessionStorage — logging into the same
// account on a different device needs its own PIN setup. Real account
// security is still Supabase auth + RLS; this only gates the UI.

const HASH_KEY = 'applock:hash';
const SALT_KEY = 'applock:salt';
const UNLOCKED_KEY = 'applock:unlocked';

// Sliding idle timeout: any tracked activity while unlocked pushes this
// back out, so an actively-used counter never locks mid-sale, but a
// phone set down and forgotten does.
export const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

const PBKDF2_ITERATIONS = 100_000;

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer);
}

// PBKDF2-SHA256 rather than a raw digest — a 4-6 digit PIN has only
// 10,000-1,000,000 possibilities, so the hash needs to be deliberately
// slow to brute-force even though the "attacker" here is just someone
// poking at localStorage in devtools.
export async function derivePinHash(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

export function isAppLockEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(HASH_KEY);
}

export async function enableAppLock(pin: string): Promise<void> {
  const salt = randomSaltHex();
  const hash = await derivePinHash(pin, salt);
  localStorage.setItem(SALT_KEY, salt);
  localStorage.setItem(HASH_KEY, hash);
  markUnlocked();
}

export function disableAppLock(): void {
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(HASH_KEY);
  sessionStorage.removeItem(UNLOCKED_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const salt = localStorage.getItem(SALT_KEY);
  const hash = localStorage.getItem(HASH_KEY);
  if (!salt || !hash) return false;
  const attempt = await derivePinHash(pin, salt);
  return attempt === hash;
}

export function markUnlocked(): void {
  sessionStorage.setItem(UNLOCKED_KEY, String(Date.now()));
}

// sessionStorage (not localStorage) is deliberate: closing the tab/app
// and reopening always re-locks, on top of the idle timeout below.
export function lockNow(): void {
  sessionStorage.removeItem(UNLOCKED_KEY);
}

export function isCurrentlyUnlocked(): boolean {
  const raw = sessionStorage.getItem(UNLOCKED_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) <= IDLE_TIMEOUT_MS;
}

export function touchActivity(): void {
  if (sessionStorage.getItem(UNLOCKED_KEY)) markUnlocked();
}

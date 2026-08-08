// Hand-rolled EAN-13 generation + SVG rendering — no new dependency,
// matching the app's existing preference for native/hand-built over a
// library (native BarcodeDetector for scanning, a hand-rolled icon set).
// EAN-13 is a well-documented, stable spec; nothing here needs updates.

// Prefix 20-29 is the GS1-reserved "internal/in-store use" range — the
// same block supermarkets use for scale-computed or shop-only barcodes,
// meaning we're not minting a number that could collide with a real
// manufacturer's registered product code.
const INTERNAL_PREFIX = '20';

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateInternalBarcode(): string {
  let body = '';
  for (let i = 0; i < 10; i++) body += Math.floor(Math.random() * 10);
  const first12 = INTERNAL_PREFIX + body;
  return first12 + ean13CheckDigit(first12);
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

// Standard EAN-13 encoding tables — L (odd parity) and G (even parity)
// for the left 6 digits, R for the right 6 (always the same, R is L's
// bitwise complement). Which of L/G each left-side digit uses is chosen
// by the first digit's parity pattern below — that's how the 13th digit
// (the first one) gets encoded without ever becoming its own set of bars.
const L_CODE: Record<string, string> = {
  '0': '0001101', '1': '0011001', '2': '0010011', '3': '0111101', '4': '0100011',
  '5': '0110001', '6': '0101111', '7': '0111011', '8': '0110111', '9': '0001011'
};
const G_CODE: Record<string, string> = {
  '0': '0100111', '1': '0110011', '2': '0011011', '3': '0100001', '4': '0011101',
  '5': '0111001', '6': '0000101', '7': '0010001', '8': '0001001', '9': '0010111'
};
const R_CODE: Record<string, string> = {
  '0': '1110010', '1': '1100110', '2': '1101100', '3': '1000010', '4': '1011100',
  '5': '1001110', '6': '1010000', '7': '1000100', '8': '1001000', '9': '1110100'
};
const PARITY_PATTERN: Record<string, string> = {
  '0': 'LLLLLL', '1': 'LLGLGG', '2': 'LLGGLG', '3': 'LLGGGL', '4': 'LGLLGG',
  '5': 'LGGLLG', '6': 'LGGGLL', '7': 'LGLGLG', '8': 'LGLGGL', '9': 'LGGLGL'
};

// Returns the full black/white module string (1 = bar, 0 = space) for a
// valid 13-digit code, guards included — ready to draw as fixed-width
// rects. Doesn't validate; callers should check isValidEan13 first.
export function ean13Modules(code: string): string {
  const first = code[0];
  const left = code.slice(1, 7);
  const right = code.slice(7, 13);
  const pattern = PARITY_PATTERN[first];

  let bits = '101'; // start guard
  for (let i = 0; i < 6; i++) {
    bits += pattern[i] === 'L' ? L_CODE[left[i]] : G_CODE[left[i]];
  }
  bits += '01010'; // middle guard
  for (let i = 0; i < 6; i++) {
    bits += R_CODE[right[i]];
  }
  bits += '101'; // end guard
  return bits;
}

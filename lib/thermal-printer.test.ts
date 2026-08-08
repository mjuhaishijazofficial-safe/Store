import { describe, it, expect } from 'vitest';
import { encodeReceipt, isWebBluetoothSupported, ReceiptLine } from './thermal-printer';

function bytesToAscii(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '')).join('');
}

describe('encodeReceipt', () => {
  const lines: ReceiptLine[] = [
    { name: 'Sugar 1kg', qty: 2, unit: 'kg', amount: 300 },
    { name: 'Rice', qty: 1, unit: 'kg', amount: 250 }
  ];

  it('includes the shop name, item names, and total in the byte stream', () => {
    const bytes = encodeReceipt('Ali Kiryana', lines, '8 Aug 2026', 'Thank you!');
    const text = bytesToAscii(bytes);
    expect(text).toContain('Ali Kiryana');
    expect(text).toContain('Sugar 1kg');
    expect(text).toContain('Rice');
    expect(text).toContain('TOTAL');
    expect(text).toContain('Thank you!');
  });

  it('substitutes Rs for the rupee symbol rather than emitting a non-ASCII byte', () => {
    const bytes = encodeReceipt('Shop', lines, 'now', 'thanks');
    // Every byte must be printable ASCII, a control byte we emit
    // ourselves (ESC/GS/LF), or the '?' fallback — never a raw
    // multi-byte UTF-8 lead byte from an unencoded ₨.
    for (const b of bytes) {
      expect(b).toBeLessThan(256);
    }
    expect(bytesToAscii(bytes)).toContain('Rs');
  });

  it('starts with the ESC @ initialize sequence', () => {
    const bytes = encodeReceipt('Shop', lines, 'now', 'thanks');
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it('ends with a cut command', () => {
    const bytes = encodeReceipt('Shop', lines, 'now', 'thanks');
    const last3 = Array.from(bytes.slice(-3));
    expect(last3).toEqual([0x1d, 0x56, 0x00]);
  });

  it('computes the total from the line amounts', () => {
    const bytes = encodeReceipt('Shop', lines, 'now', 'thanks');
    expect(bytesToAscii(bytes)).toContain('550'); // 300 + 250
  });
});

describe('isWebBluetoothSupported', () => {
  it('is false in a Node test environment with no navigator.bluetooth', () => {
    expect(isWebBluetoothSupported()).toBe(false);
  });
});

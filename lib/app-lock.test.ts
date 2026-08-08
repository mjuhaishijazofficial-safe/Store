import { describe, it, expect } from 'vitest';
import { isValidPinFormat, randomSaltHex, derivePinHash } from './app-lock';

describe('isValidPinFormat', () => {
  it('accepts 4-6 digit PINs', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
    expect(isValidPinFormat('12345')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
    expect(isValidPinFormat('12 34')).toBe(false);
  });
});

describe('randomSaltHex', () => {
  it('produces distinct 32-char hex strings', () => {
    const a = randomSaltHex();
    const b = randomSaltHex();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('derivePinHash', () => {
  it('is deterministic for the same PIN and salt', async () => {
    const salt = randomSaltHex();
    const a = await derivePinHash('1234', salt);
    const b = await derivePinHash('1234', salt);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when the PIN differs', async () => {
    const salt = randomSaltHex();
    const a = await derivePinHash('1234', salt);
    const b = await derivePinHash('4321', salt);
    expect(a).not.toBe(b);
  });

  it('differs when the salt differs, same PIN', async () => {
    const a = await derivePinHash('1234', randomSaltHex());
    const b = await derivePinHash('1234', randomSaltHex());
    expect(a).not.toBe(b);
  });
});

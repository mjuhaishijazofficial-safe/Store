import { describe, expect, it } from 'vitest';
import { generateInternalBarcode, isValidEan13, ean13Modules } from './barcode';

describe('EAN-13', () => {
  it('validates a known-correct real-world EAN-13 (a Coca-Cola can, widely published example)', () => {
    expect(isValidEan13('5449000000996')).toBe(true);
  });

  it('rejects a code with a wrong check digit', () => {
    expect(isValidEan13('5449000000990')).toBe(false);
  });

  it('rejects anything that is not exactly 13 digits', () => {
    expect(isValidEan13('12345')).toBe(false);
    expect(isValidEan13('abcdefghijklm')).toBe(false);
  });

  it('generates a code that is internally consistent (valid check digit)', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidEan13(generateInternalBarcode())).toBe(true);
    }
  });

  it('generates codes in the GS1 internal-use prefix (20-29), never a real registered range', () => {
    const code = generateInternalBarcode();
    const prefix = Number(code.slice(0, 2));
    expect(prefix).toBeGreaterThanOrEqual(20);
    expect(prefix).toBeLessThanOrEqual(29);
  });

  it('produces a 95-module bar pattern (3 + 42 + 5 + 42 + 3, the fixed EAN-13 width)', () => {
    expect(ean13Modules('5449000000996').length).toBe(95);
  });

  it('always starts and ends with the guard pattern 101', () => {
    const modules = ean13Modules('5449000000996');
    expect(modules.slice(0, 3)).toBe('101');
    expect(modules.slice(-3)).toBe('101');
  });
});

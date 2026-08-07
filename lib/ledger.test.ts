import { describe, expect, it } from 'vitest';
import { ledgerBalance, ledgerBalancesById } from './ledger';

describe('ledgerBalance', () => {
  it('is zero for no entries', () => {
    expect(ledgerBalance([])).toBe(0);
  });

  it('matches the PDF example: Coca Cola 120, then Cigarette 200 + Sugar 120', () => {
    const rows = [
      { type: 'purchase' as const, amount: 120 },
      { type: 'purchase' as const, amount: 200 },
      { type: 'purchase' as const, amount: 120 }
    ];
    expect(ledgerBalance(rows)).toBe(440);
  });

  it('subtracts payments from purchases', () => {
    const rows = [
      { type: 'purchase' as const, amount: 500 },
      { type: 'payment' as const, amount: 200 }
    ];
    expect(ledgerBalance(rows)).toBe(300);
  });

  it('can go negative if payments exceed purchases (overpayment)', () => {
    const rows = [
      { type: 'purchase' as const, amount: 100 },
      { type: 'payment' as const, amount: 150 }
    ];
    expect(ledgerBalance(rows)).toBe(-50);
  });

  it('order of entries does not affect the total', () => {
    const rows = [
      { type: 'payment' as const, amount: 50 },
      { type: 'purchase' as const, amount: 300 },
      { type: 'payment' as const, amount: 20 },
      { type: 'purchase' as const, amount: 10 }
    ];
    expect(ledgerBalance(rows)).toBe(300 + 10 - 50 - 20);
  });
});

describe('ledgerBalancesById', () => {
  it('groups rows by id and reduces each group independently', () => {
    const rows = [
      { customer_id: 'a', type: 'purchase' as const, amount: 100 },
      { customer_id: 'b', type: 'purchase' as const, amount: 50 },
      { customer_id: 'a', type: 'payment' as const, amount: 40 },
      { customer_id: 'b', type: 'purchase' as const, amount: 25 }
    ];
    expect(ledgerBalancesById(rows, 'customer_id')).toEqual({ a: 60, b: 75 });
  });

  it('returns an empty object for no rows', () => {
    expect(ledgerBalancesById([], 'customer_id')).toEqual({});
  });

  it('an id with only a payment (no purchase) shows a negative balance, not a missing entry', () => {
    const rows = [{ customer_id: 'a', type: 'payment' as const, amount: 30 }];
    expect(ledgerBalancesById(rows, 'customer_id')).toEqual({ a: -30 });
  });
});

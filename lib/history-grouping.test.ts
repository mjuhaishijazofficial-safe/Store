import { describe, it, expect } from 'vitest';
import { groupHistoryLogs, HistoryLog } from './history-grouping';

function row(over: Partial<HistoryLog>): HistoryLog {
  return {
    id: Math.random().toString(36),
    item_name: 'Item',
    qty: 1,
    unit: 'pc',
    type: 'sale',
    amount: 10,
    created_at: new Date().toISOString(),
    sale_ref: null,
    ...over
  };
}

describe('groupHistoryLogs', () => {
  it('keeps rows without a sale_ref as separate single-row groups', () => {
    const logs = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const groups = groupHistoryLogs(logs);
    expect(groups).toHaveLength(3);
    expect(groups.every(g => g.rows.length === 1)).toBe(true);
  });

  it('merges adjacent rows sharing the same sale_ref into one group', () => {
    const ref = 'cart-1';
    const logs = [row({ id: 'a', sale_ref: ref }), row({ id: 'b', sale_ref: ref }), row({ id: 'c', sale_ref: ref })];
    const groups = groupHistoryLogs(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not merge across a different row in between', () => {
    const ref = 'cart-1';
    const logs = [row({ id: 'a', sale_ref: ref }), row({ id: 'x', sale_ref: null }), row({ id: 'b', sale_ref: ref })];
    const groups = groupHistoryLogs(logs);
    expect(groups).toHaveLength(3);
  });

  it('does not merge two different sale_ref values', () => {
    const logs = [row({ id: 'a', sale_ref: 'cart-1' }), row({ id: 'b', sale_ref: 'cart-2' })];
    const groups = groupHistoryLogs(logs);
    expect(groups).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(groupHistoryLogs([])).toEqual([]);
  });
});

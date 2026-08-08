// Groups consecutive History rows that share a sale_ref (see
// SaleCartModal) into one "bill", so a 5-item cart sale reads as one
// entry instead of 5 flat rows indistinguishable from unrelated single
// sales. Rows are assumed ordered by created_at desc (as History always
// loads them) — grouping only merges *adjacent* rows, which is right for
// that ordering since a cart's line items are inserted back-to-back.

export type HistoryLog = {
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  unit: string | null;
  type: 'purchase' | 'sale' | 'return';
  amount: number;
  created_at: string;
  sale_ref: string | null;
};

export type HistoryGroup = { key: string; rows: HistoryLog[] };

export function groupHistoryLogs(logs: HistoryLog[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const row of logs) {
    const last = groups[groups.length - 1];
    if (row.sale_ref && last && last.rows[0].sale_ref === row.sale_ref) {
      last.rows.push(row);
    } else {
      groups.push({ key: row.sale_ref ? `ref:${row.sale_ref}` : `row:${row.id}`, rows: [row] });
    }
  }
  return groups;
}

// Groups consecutive History rows that share a sale_ref (see
// SaleCartModal) into one "bill", so a 5-item cart sale reads as one
// entry instead of 5 flat rows indistinguishable from unrelated single
// sales. Rows are assumed ordered by created_at desc (as History always
// loads them) — grouping only merges *adjacent* rows, which is right for
// that ordering since a cart's line items are inserted back-to-back.

// Mirrors stock_movements.reason (supabase/schema.sql) plus the original
// 'purchase' | 'sale' | 'return' transactions.type values — History now
// sources rows from the ledger, whose reason column is a superset of the
// old transactions.type domain.
export type HistoryReason = 'purchase' | 'sale' | 'return' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'slip_scan';

export type HistoryLog = {
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  unit: string | null;
  type: HistoryReason;
  amount: number;
  created_at: string;
  sale_ref: string | null;
  // Set only on a row logged by a Khata-mode sale (see
  // record_khata_entry in supabase/schema.sql) — marks that returning
  // this row needs to reverse the customer's owed balance too, not just
  // restock the item. Optional so existing call sites/tests that don't
  // care about Khata still construct a valid HistoryLog.
  customer_id?: string | null;
};

// Which reasons put stock back on the shelf vs take it off — drives the
// +/− sign and color in the History list. Kept here (not duplicated in
// the page) since it's a property of the reason domain itself.
const STOCK_IN_REASONS = new Set<HistoryReason>(['purchase', 'return', 'transfer_in', 'slip_scan']);
export function isStockInReason(reason: HistoryReason): boolean {
  return STOCK_IN_REASONS.has(reason);
}

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

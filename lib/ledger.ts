// The one rule every ledger in this app follows: balance = sum(purchase) -
// sum(payment), always derived, never stored as a mutable column. Storing a
// running total (like shops.spent used to be) invites drift the moment two
// writes race or one write silently fails. Centralizing the arithmetic here
// also means it only needs testing in one place.

export type LedgerType = 'purchase' | 'payment';
export type LedgerRow = { type: LedgerType; amount: number };

export function ledgerBalance(rows: LedgerRow[]): number {
  return rows.reduce((sum, r) => sum + (r.type === 'purchase' ? r.amount : -r.amount), 0);
}

// Groups rows by an id field (customer_id / supplier_id) and reduces each
// group to a running balance in one pass — used by the Khata and Supplier
// list pages to show every entity's balance without an N+1 query per row.
export function ledgerBalancesById(rows: (LedgerRow & Record<string, any>)[], idKey: string): Record<string, number> {
  const bal: Record<string, number> = {};
  for (const r of rows) {
    const id = r[idKey];
    const delta = r.type === 'purchase' ? r.amount : -r.amount;
    bal[id] = (bal[id] || 0) + delta;
  }
  return bal;
}

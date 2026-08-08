// Client-side CSV generation — no backend needed, no new dependency.
// Good enough for "give this to my accountant" / backup use, not a
// full reporting engine.

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  // Any cell containing a comma, quote, or newline needs quoting, with
  // internal quotes doubled — standard CSV escaping.
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Same client-side Blob-download technique as downloadCsv below, for the
// one place a JSON file (not a spreadsheet) is the right shape — the
// full-shop data export in Settings, where the payload is several
// tables' worth of rows rather than one flat list.
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => headers.map(h => escapeCsvCell(row[h])).join(','))
  ];

  // Leading BOM so Excel (common on Windows, where this app's users are)
  // opens the file as UTF-8 instead of mangling non-ASCII characters.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// A hand-rolled state-machine parser rather than text.split(',') — a
// naive split breaks the moment a cell has a comma or newline inside
// quotes (a category or item name typed with a comma is a completely
// normal thing to happen), and this is the exact inverse of
// escapeCsvCell above, so an exported file always round-trips.
export function parseCsv(text: string): Record<string, string>[] {
  // Strip a UTF-8 BOM if present — downloadCsv writes one so Excel opens
  // the file correctly, and Excel writes one back when re-saving.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* swallow — \n (or end of input) closes the row */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }

  const filled = rows.filter(r => r.some(c => c.trim() !== ''));
  if (filled.length === 0) return [];

  const headers = filled[0].map(h => h.trim());
  return filled.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}

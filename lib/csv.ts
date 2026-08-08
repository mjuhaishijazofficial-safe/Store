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

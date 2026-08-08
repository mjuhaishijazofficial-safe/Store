// Bluetooth thermal receipt printing via the Web Bluetooth API. This is
// a real platform limitation, not a gap in this file: Web Bluetooth only
// talks to BLE (GATT) devices and only ships in Chromium browsers — no
// iOS Safari, no desktop Safari, no classic-Bluetooth (SPP) printers at
// all, which is how a lot of cheap thermal printers pair. The specific
// service/characteristic UUIDs below match the generic ESC/POS-over-BLE
// profile used by most budget 58mm "Android POS" printers sold for this
// exact purpose — the same de facto standard the common "Bluetooth
// Print" Android apps target. isWebBluetoothSupported() gates every
// entry point so unsupported browsers never see a button that can't work.

const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

// BLE writes are capped by the negotiated MTU — without an explicit MTU
// request (Web Bluetooth doesn't expose one), 20 bytes per write is the
// safe default that works even on an unnegotiated connection.
const CHUNK_SIZE = 20;

const ESC = 0x1b;
const GS = 0x1d;

function textBytes(s: string): number[] {
  // Thermal printers use a single-byte code page (commonly CP437) with
  // no ₨ glyph — every fmt() call site in this app renders ₨, so this
  // substitutes "Rs " specifically for the raw byte stream rather than
  // risk mojibake on the paper tape. Anything else outside plain ASCII
  // (still possible from a free-text item name) is dropped rather than
  // sent as a raw byte the printer's code page might render as junk.
  return Array.from(s.replace(/₨/g, 'Rs ')).flatMap(ch => {
    const code = ch.codePointAt(0) || 0;
    return code < 128 ? [code] : [0x3f]; // '?' fallback for anything non-ASCII
  });
}

function line(s: string): number[] {
  return [...textBytes(s), 0x0a];
}

function center(s: string): number[] {
  return [ESC, 0x61, 0x01, ...line(s), ESC, 0x61, 0x00];
}

function bold(s: string): number[] {
  return [ESC, 0x45, 0x01, ...line(s), ESC, 0x45, 0x00];
}

export type ReceiptLine = { name: string; qty: number; unit: string | null; amount: number };

function money(n: number): string {
  return 'Rs ' + Number(n || 0).toLocaleString('en-IN');
}

// Pure byte-stream builder — the only part of this file that's
// meaningfully unit-testable without a real Bluetooth device.
export function encodeReceipt(shopName: string, lines: ReceiptLine[], when: string, thanksMsg: string): Uint8Array {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const dashes = '-'.repeat(32);

  const bytes: number[] = [
    ESC, 0x40, // initialize
    ...center(shopName),
    ...center(when),
    ...line(dashes)
  ];

  for (const l of lines) {
    const unitPrice = l.qty > 0 ? l.amount / l.qty : l.amount;
    bytes.push(...line(l.name));
    const qtyStr = `${l.qty} ${l.unit || ''} x ${money(unitPrice)}`;
    bytes.push(...line(padRight(qtyStr, 20) + padLeft(money(l.amount), 12)));
  }

  bytes.push(...line(dashes));
  bytes.push(...bold(padRight('TOTAL', 20) + padLeft(money(total), 12)));
  bytes.push(...line(dashes));
  bytes.push(...center(thanksMsg));
  bytes.push(0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x00); // full cut (ignored by printers without a cutter)

  return new Uint8Array(bytes);
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// Thin wrapper around the actual device connection — kept separate from
// encodeReceipt() above so the byte-building logic stays testable
// without touching navigator.bluetooth at all.
export async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  const nav = navigator as any;
  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID]
  });
  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      await characteristic.writeValue(bytes.slice(i, i + CHUNK_SIZE));
    }
  } finally {
    server.disconnect();
  }
}

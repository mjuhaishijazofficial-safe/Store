'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';
import { encodeReceipt, isWebBluetoothSupported, printViaBluetooth, ReceiptLine } from '@/lib/thermal-printer';

// A second way to get a receipt onto paper, alongside the existing
// browser print() button — this one talks straight to a 58mm Bluetooth
// thermal printer over Web Bluetooth instead of going through the OS
// print dialog (which most phones can't route to a Bluetooth thermal
// printer at all). Renders nothing on a browser that doesn't support
// Web Bluetooth (iOS Safari, desktop Safari, Firefox) rather than
// showing a button that can only ever fail — see lib/thermal-printer.ts
// for the exact platform limits.
export default function ThermalPrintButton({ shopName, lines, when, footer }: { shopName: string; lines: ReceiptLine[]; when: string; footer?: string }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [printing, setPrinting] = useState(false);

  if (!isWebBluetoothSupported()) return null;

  async function handlePrint() {
    setPrinting(true);
    try {
      const bytes = encodeReceipt(shopName, lines, when, footer || t('receipt.thanks'));
      await printViaBluetooth(bytes);
      showToast(t('receipt.bluetoothSent'), 'success');
    } catch {
      // Covers both a real failure and the user cancelling the device
      // chooser — Web Bluetooth doesn't distinguish them in a way
      // worth surfacing differently.
      showToast(t('receipt.bluetoothFailed'), 'error');
    }
    setPrinting(false);
  }

  return (
    <button onClick={handlePrint} disabled={printing} className="btn-secondary flex-1">
      {printing ? t('common.loading') : t('receipt.bluetoothPrint')}
    </button>
  );
}

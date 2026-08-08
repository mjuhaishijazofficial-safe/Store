'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useToast } from '@/lib/toast-context';

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit?: number | null;
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// Shared by the khata and supplier detail pages — both were create-only
// until now, with no way to fix a typo in a name or remove someone added
// by mistake. The delete half is the reason this is one component rather
// than two inline forms: khata_entries and supplier_entries both cascade
// on their parent, so deleting a contact silently destroys their entire
// ledger. That warning has to be identical and unmissable in both places.
export default function ContactEditModal({
  kind,
  contact,
  balance,
  onClose,
  onSaved,
  onDeleted
}: {
  kind: 'customer' | 'supplier';
  contact: Contact;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const supabase = createClient();
  const { t } = useLang();
  const { showToast } = useToast();

  const table = kind === 'customer' ? 'customers' : 'suppliers';
  const entryTable = kind === 'customer' ? 'khata_entries' : 'supplier_entries';
  const fkColumn = kind === 'customer' ? 'customer_id' : 'supplier_id';

  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone || '');
  const [creditLimit, setCreditLimit] = useState(
    contact.credit_limit != null ? String(contact.credit_limit) : ''
  );
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [entryCount, setEntryCount] = useState<number | null>(null);

  // Counted across the whole ledger, not the page of entries the parent
  // happens to have loaded — the warning is worthless if it undercounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from(entryTable)
        .select('id', { count: 'exact', head: true })
        .eq(fkColumn, contact.id);
      if (!cancelled) setEntryCount(count || 0);
    })();
    return () => { cancelled = true; };
  }, [contact.id, entryTable, fkColumn]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      phone: phone.trim() || null
    };
    if (kind === 'customer') {
      payload.credit_limit = creditLimit.trim() ? Number(creditLimit) : null;
    }

    const { error: err } = await supabase.from(table).update(payload).eq('id', contact.id);
    setBusy(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    showToast(t('settings.saved'), 'success');
    onSaved();
  }

  async function confirmDelete() {
    setBusy(true);
    const { error: err } = await supabase.from(table).delete().eq('id', contact.id);
    setBusy(false);
    if (err) { showToast(t('common.error'), 'error'); return; }
    onDeleted();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => !busy && onClose()}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>

        {!confirmingDelete ? (
          <>
            <div className="font-display text-lg text-haldi font-700 mb-4">{t('contact.editTitle')}</div>

            <label className="block text-xs text-chalkdim mb-1">{t('contact.name')}</label>
            <input className="input mb-3" value={name} onChange={e => setName(e.target.value)} />

            <label className="block text-xs text-chalkdim mb-1">{t('contact.phone')}</label>
            <input className="input mb-3" value={phone} onChange={e => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />

            {kind === 'customer' && (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('contact.creditLimit')}</label>
                <input
                  type="number"
                  className="input mb-1"
                  value={creditLimit}
                  onChange={e => setCreditLimit(e.target.value)}
                  placeholder={t('contact.noLimit')}
                />
                <div className="text-[11px] text-chalkdim mb-4">{t('contact.creditLimitHint')}</div>
              </>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={onClose} disabled={busy} className="btn-secondary flex-1">{t('contact.cancel')}</button>
              <button onClick={save} disabled={busy || !name.trim()} className="btn-primary flex-1">{t('contact.save')}</button>
            </div>

            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="w-full mt-4 pt-4 border-t border-chalk/10 text-mirch text-sm font-600"
            >
              {kind === 'customer' ? t('contact.deleteCustomer') : t('contact.deleteSupplier')}
            </button>
          </>
        ) : (
          <>
            <div className="font-display text-lg text-mirch font-700 mb-2">{t('contact.deleteTitle')}</div>
            <p className="text-sm mb-3">
              <strong>{contact.name}</strong> {t('contact.deleteBody')}
            </p>

            {/* An unsettled balance is the case where deleting is almost
                certainly a mistake — say the number out loud rather than
                letting it vanish with the record. */}
            {balance !== 0 && (
              <div className="card p-3 border-mirch mb-3">
                <div className="text-xs text-mirch font-700 mb-0.5">{t('contact.deleteBalanceWarn')}</div>
                <div className="font-mono font-700 text-mirch">{fmt(Math.abs(balance))}</div>
              </div>
            )}

            {!!entryCount && (
              <div className="text-xs text-chalkdim mb-4">
                {t('contact.deleteEntriesWarn').replace('{n}', String(entryCount))}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} disabled={busy} className="btn-secondary flex-1">
                {t('contact.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="flex-1 rounded-lg font-700 text-white bg-mirch disabled:opacity-40 px-4 py-2.5"
              >
                {busy ? t('contact.deleting') : t('contact.deleteConfirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useToast } from '@/lib/toast-context';
import { ReceiptIcon, CashIcon, ReturnIcon } from '@/components/icons';
import ContactEditModal from '@/components/ContactEditModal';
import CustomerStatementModal from '@/components/CustomerStatementModal';
import ConfirmDeleteButton from '@/components/ConfirmDeleteButton';
import { useSectionGuard } from '@/lib/use-section-guard';

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number | null;
};

type EntryType = 'purchase' | 'payment' | 'return';

type Entry = {
  id: string;
  type: EntryType;
  item_name: string | null;
  qty: number | null;
  amount: number;
  note: string | null;
  created_at: string;
  entry_number: number;
  reversal_of: string | null;
  reversed_at: string | null;
};

type ItemLite = { id: string; name: string; price: number; unit: string | null; stock: number };

const PAGE_SIZE = 30;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function KhataDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = params.id as string;
  const supabase = createClient();
  const { t } = useLang();
  const { shopId, shopName } = useShop();
  const { showToast } = useToast();
  useSectionGuard('khata');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  // Lifetime totals, kept separate from `entries` because that array is
  // only ever the currently-loaded page(s) — deriving these from it would
  // silently understate both figures the moment history spans a page.
  const [totalGiven, setTotalGiven] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalReturned, setTotalReturned] = useState(0);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [advanceDepletedNotice, setAdvanceDepletedNotice] = useState(false);

  const [modalType, setModalType] = useState<EntryType | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // ?autoPrint=1 (arriving from Eagle's "print_statement" voice
  // command) opens the statement already set to print itself, instead
  // of landing on a bare customer page the shopkeeper still has to tap
  // "Print Statement" on.
  const wantsAutoPrint = searchParams.get('autoPrint') === '1';
  const [statementOpen, setStatementOpen] = useState(wantsAutoPrint);
  const [form, setForm] = useState({ item_name: '', qty: '', amount: '', note: '' });
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'easypaisa' | 'jazzcash'>('cash');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);

  useEffect(() => { init(); }, [customerId, shopId]);

  async function init() {
    await Promise.all([reloadItems(), loadAll()]);
  }

  async function reloadItems() {
    const { data: inv } = await supabase.from('items').select('id, name, price, unit, stock').eq('shop_id', shopId).order('name');
    setItems(inv || []);
  }

  // Balance comes from a DB-side sum, not by adding up whatever page of
  // entries happens to be loaded on screen — otherwise pagination would
  // silently understate the real total. A negative balance means the
  // customer has paid more than they've bought — an advance sitting with
  // the shop, consumed by future purchases before any new debt accrues.
  // Returns the value (not just setting state) so callers can compare
  // before/after and catch the moment the advance runs out.
  async function loadBalance(): Promise<number> {
    const { data, error: err } = await supabase.rpc('khata_customer_totals', { p_customer_id: customerId }).single();
    if (err) { showToast(t('common.error'), 'error'); return total; }
    const given = (data as any)?.given || 0;
    const paid = (data as any)?.paid || 0;
    // A return reduces what's owed the same direction a cash payment
    // does — no cash actually changes hands, but the customer's debt
    // still comes down by the returned amount.
    const returned = (data as any)?.returned || 0;
    const newTotal = given - paid - returned;
    setTotalGiven(given);
    setTotalPaid(paid);
    setTotalReturned(returned);
    setTotal(newTotal);
    return newTotal;
  }

  async function loadEntries(reset: boolean) {
    const offset = reset ? 0 : entries.length;
    const { data: rows } = await supabase
      .from('khata_entries')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const newRows = rows || [];
    setEntries(reset ? newRows : prev => [...prev, ...newRows]);
    setHasMore(newRows.length === PAGE_SIZE);
  }

  async function loadMore() {
    setLoadingMore(true);
    await loadEntries(false);
    setLoadingMore(false);
  }

  async function loadAll() {
    setLoading(true);
    const { data: cust } = await supabase.from('customers').select('*').eq('id', customerId).single();
    setCustomer(cust || null);
    await Promise.all([loadEntries(true), loadBalance()]);
    setLoading(false);
  }

  const over = customer?.credit_limit != null && total > customer.credit_limit;

  // Running balance per row, like Khatabook/OkCredit show — not just an
  // isolated +/- amount per entry, but what the balance actually was
  // right after that entry. entries[] is always newest-first, and
  // `total` (DB-computed) is the balance after entries[0], so walking
  // backward from there stays correct even as "load more" appends older
  // pages — each older entry's balance-after is just the previous one
  // with that entry's own effect undone.
  let runningBalance = total;
  const balanceAfterEntry: number[] = entries.map(e => {
    const before = runningBalance;
    runningBalance -= e.type === 'purchase' ? e.amount : -e.amount;
    return before;
  });

  const projectedTotal = total + (modalType === 'purchase' ? (Number(form.amount) || 0) : 0);
  const willGoOverLimit = modalType === 'purchase' && customer?.credit_limit != null && projectedTotal > customer.credit_limit;

  const itemMatches = form.item_name.trim() && showDropdown
    ? items.filter(i => i.name.toLowerCase().includes(form.item_name.toLowerCase())).slice(0, 5)
    : [];

  // purchase and return both name a specific item — one going out to the
  // customer, one coming back — payment is just cash, no item involved.
  const modalNeedsItem = modalType === 'purchase' || modalType === 'return';

  function openModal(type: EntryType) {
    setForm({ item_name: '', qty: '', amount: '', note: '' });
    setSelectedItemId(null);
    setShowDropdown(false);
    setPaymentMethod('cash');
    setModalType(type);
  }

  function onItemNameChange(v: string) {
    setForm(f => ({ ...f, item_name: v }));
    setSelectedItemId(null);
    setShowDropdown(true);
  }

  function onQtyChange(v: string) {
    const item = items.find(i => i.id === selectedItemId);
    setForm(f => ({
      ...f,
      qty: v,
      amount: item ? String((Number(v) || 1) * item.price) : f.amount
    }));
  }

  function selectItem(item: ItemLite) {
    const qty = form.qty || '1';
    setForm(f => ({
      ...f,
      item_name: item.name,
      qty,
      amount: String((Number(qty) || 1) * item.price)
    }));
    setSelectedItemId(item.id);
    setShowDropdown(false);
  }

  async function saveEntry() {
    // savingEntry guards against a double-tap firing this twice — this
    // creates real debt/stock movements, so a duplicate here is a much
    // bigger problem than the duplicate-customer bug this same pattern
    // fixed elsewhere in the app.
    if (!shopId || !modalType || savingEntry) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return;

    const qtyNum = form.qty ? Number(form.qty) : null;
    const wasAdvance = total < 0;
    setSavingEntry(true);

    // Atomic: the ledger insert and the linked inventory stock deduction
    // happen in one DB transaction (record_khata_entry) instead of two
    // separate client calls, so a mid-way failure can't leave a "Naya
    // Saman Diya" entry recorded with no matching stock change.
    const { error: err } = await supabase.rpc('record_khata_entry', {
      p_customer_id: customerId,
      p_type: modalType,
      p_item_id: modalNeedsItem ? selectedItemId : null,
      p_item_name: modalNeedsItem ? (form.item_name.trim() || null) : null,
      p_qty: modalNeedsItem ? qtyNum : null,
      p_amount: amount,
      p_note: form.note.trim() || null,
      p_payment_method: modalType === 'payment' ? paymentMethod : 'cash'
    });

    setSavingEntry(false);
    if (err) { showToast(t('common.error'), 'error'); return; }

    setModalType(null);
    showToast(t('settings.saved'), 'success');
    const [, newTotal] = await Promise.all([loadEntries(true), loadBalance()]);
    await reloadItems();

    // The customer had an advance sitting with the shop and this entry
    // just used the last of it — flag it so the shopkeeper notices new
    // debt has started, not just silently see a number tick past zero.
    if (wasAdvance && newTotal >= 0) {
      setAdvanceDepletedNotice(true);
    }
  }

  // Replaces the old hard-delete: inserts a mirror-image entry (opposite
  // balance/stock effect) instead of erasing the original row, so the
  // full history stays traceable — the original just gets marked
  // reversed_at and stays visible (crossed out) in the list below.
  async function reverseEntry(id: string) {
    const { error: err } = await supabase.rpc('reverse_khata_entry', { p_entry_id: id });
    if (err) { showToast(t('common.error'), 'error'); return; }
    await loadAll();
    await reloadItems();
  }

  function remindWhatsapp() {
    if (!customer?.phone) return;
    let digits = customer.phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '92' + digits.slice(1); // Pakistani local -> international
    const msg = t('khataDetail.reminderMsg').replace('{amount}', fmt(total).replace('₨', '')).replace('{shop}', shopName || 'Dukaan');
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  if (loading) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.loading')}</div>;
  if (!customer) return <div className="text-chalkdim text-sm text-center py-10">{t('khataDetail.notFound')}</div>;

  const lastPayment = entries.find(e => e.type === 'payment');

  return (
    <div>
      <Link href="/dashboard/khata" className="text-xs text-chalkdim hover:text-haldi">{t('khataDetail.back')}</Link>

      <div className="card p-5 mt-3 mb-4">
        <div className="flex items-start gap-3 mb-5">
          {/* Initial-letter avatar — gives each customer a visual anchor
              so the page doesn't open as an anonymous wall of numbers. */}
          <div className="w-11 h-11 rounded-full bg-haldi/15 text-haldi font-display font-800 text-lg flex items-center justify-center shrink-0">
            {customer.name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-700 leading-tight">{customer.name}</div>
            <div className="text-xs text-chalkdim">
              {customer.phone || '—'}
              <button onClick={() => setEditOpen(true)} className="ml-2 text-chalkdim hover:text-haldi underline">{t('contact.edit')}</button>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-chalkdim uppercase tracking-wide">{total < 0 ? t('khataDetail.advanceBalance') : t('khataDetail.totalUdhaar')}</div>
            <div className={`font-mono font-800 text-2xl leading-tight ${total > 0 ? 'text-mirch' : 'text-dhania'}`}>{fmt(Math.abs(total))}</div>
          </div>
        </div>

        {over && <div className="text-xs text-mirch mb-3 -mt-2">{t('khataDetail.overLimit')} ({fmt(customer.credit_limit!)})</div>}

        {/* Lifetime summary strip — the "sab kuch ek nazar mein" numbers a
            shopkeeper is actually asked about, rather than making them
            scroll the whole ledger to work it out. */}
        <div className="grid grid-cols-3 gap-2 pt-4 border-t border-chalk/10">
          <div>
            <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('khataDetail.totalGiven')}</div>
            <div className="font-mono font-700 text-sm text-mirch truncate">{fmt(totalGiven)}</div>
          </div>
          <div>
            <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('khataDetail.totalPaid')}</div>
            <div className="font-mono font-700 text-sm text-dhania truncate">{fmt(totalPaid)}</div>
          </div>
          {totalReturned > 0 ? (
            <div>
              <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('khataDetail.totalReturned')}</div>
              <div className="font-mono font-700 text-sm text-haldi truncate">{fmt(totalReturned)}</div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] text-chalkdim uppercase tracking-wide">{t('khataDetail.lastPayment')}</div>
              <div className="font-mono font-700 text-sm truncate">
                {lastPayment
                  ? new Date(lastPayment.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—'}
              </div>
            </div>
          )}
        </div>

        {customer.credit_limit != null && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-chalkdim uppercase tracking-wide mb-1">
              <span>{t('khataDetail.creditUsed')}</span>
              <span className="font-mono">{fmt(Math.max(0, total))} / {fmt(customer.credit_limit)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-board3 overflow-hidden">
              <div
                className={`h-full rounded-full ${over ? 'bg-mirch' : 'bg-dhania'}`}
                style={{ width: `${Math.min(100, (Math.max(0, total) / customer.credit_limit) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={() => openModal('purchase')} className="flex-1 text-sm py-2.5 rounded-lg border border-mirch text-mirch flex items-center justify-center gap-1.5">
            <ReceiptIcon className="w-4 h-4" />
            {t('khataDetail.newSaman')}
          </button>
          <button onClick={() => openModal('payment')} className="flex-1 text-sm py-2.5 rounded-lg border border-dhania text-dhania flex items-center justify-center gap-1.5">
            <CashIcon className="w-4 h-4" />
            {t('khataDetail.paymentReceived')}
          </button>
        </div>
        <button onClick={() => openModal('return')} className="w-full mt-2 text-sm py-2.5 rounded-lg border border-haldi text-haldi flex items-center justify-center gap-1.5">
          <ReturnIcon className="w-4 h-4" />
          {t('khataDetail.maalWapas')}
        </button>

        {total > 0 && customer.phone && (
          <button onClick={remindWhatsapp} className="w-full mt-2 text-sm py-2.5 rounded-lg border border-dhania text-dhania">
            {t('khataDetail.remindWhatsapp')}
          </button>
        )}

        <button onClick={() => setStatementOpen(true)} className="w-full mt-2 text-xs text-chalkdim hover:text-haldi underline">
          {t('khataDetail.printStatement')}
        </button>
      </div>

      {advanceDepletedNotice && (
        <div className="flex items-start justify-between gap-2 text-haldi text-sm mb-3 bg-haldi/10 p-3 rounded-lg">
          <span><strong>{customer.name}</strong> {t('khataDetail.advanceDepleted')}</span>
          <button onClick={() => setAdvanceDepletedNotice(false)} className="text-chalkdim shrink-0">✕</button>
        </div>
      )}

      {entries.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('khataDetail.empty')}</div>
      )}

      {entries.length > 0 && (
        <div className="card divide-y divide-chalk/10">
          {/* One amount per row, colored by type (red = udhaar/given,
              green = payment) with the running balance as a small
              caption underneath — same pattern Khatabook/OkCredit use.
              The earlier 4-column table (Given | Paid | Balance) looked
              right in isolation but each row was its own independent
              CSS grid, so column widths never matched row to row and
              numbers didn't actually line up under the headers. A
              single number per row sidesteps that class of bug
              entirely — nothing needs to align across rows. */}
          {entries.map((e, i) => {
            const d = new Date(e.created_at);
            const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const bal = balanceAfterEntry[i];
            const isPurchase = e.type === 'purchase';
            // Purchase (owe more) is red, payment and return both reduce
            // what's owed but stay visually distinct from each other —
            // green for actual cash in, amber for goods sent back, so
            // "customer paid" and "customer returned this" never read as
            // the same thing at a glance. Same convention as the
            // Suppliers detail page's mirror-image 'return' handling.
            const color = isPurchase ? 'text-mirch' : e.type === 'return' ? 'text-haldi' : 'text-dhania';
            const badgeBg = isPurchase ? 'bg-mirch/15 text-mirch' : e.type === 'return' ? 'bg-haldi/15 text-haldi' : 'bg-dhania/15 text-dhania';
            const icon = isPurchase ? <ReceiptIcon className="w-4 h-4" /> : e.type === 'return' ? <ReturnIcon className="w-4 h-4" /> : <CashIcon className="w-4 h-4" />;
            const label =
              isPurchase ? (e.item_name || t('khataDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '')
              : e.type === 'return' ? (e.item_name || t('khataDetail.itemDefault')) + (e.qty ? ` — ${e.qty}` : '') + ` (${t('khataDetail.maalWapas')})`
              : t('khataDetail.paymentLabel');
            // A reversal row (reversal_of set) is an administrative
            // correction, not a real transaction — muted/italic so it
            // never reads as "another sale". The original it reversed
            // (reversed_at set) stays fully visible but struck through,
            // and loses its own reverse button — you can't reverse a
            // reversal, and re-reversing the original would double-undo it.
            const isReversal = !!e.reversal_of;
            const isReversed = !!e.reversed_at;
            return (
              <div key={e.id} className={`p-3 px-4 flex items-center gap-3 ${isReversed ? 'opacity-50' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${badgeBg}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-600 text-sm truncate ${isReversed ? 'line-through' : ''} ${isReversal ? 'italic text-chalkdim' : ''}`}>
                    {isReversal ? `${t('khataDetail.reversedLabel')}: ${label}` : label}
                  </div>
                  <div className="text-[11px] text-chalkdim mt-0.5 truncate">
                    #INV-{e.entry_number} • {when}{e.note && !isReversal ? ` • ${e.note}` : ''}
                    {isReversed && ` • ${t('khataDetail.reversedBadge')}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-mono font-700 text-sm tabular-nums ${color}`}>
                    {isPurchase ? '+' : '−'}{fmt(e.amount)}
                  </div>
                  <div className="text-[10px] text-chalkdim mt-0.5 tabular-nums">
                    {t('khataDetail.colBalance')}: {fmt(Math.abs(bal))}
                  </div>
                </div>
                {!isReversal && !isReversed && (
                  <ConfirmDeleteButton
                    onConfirm={() => reverseEntry(e.id)}
                    icon="↺"
                    confirmLabel={t('khataDetail.confirmReverse')}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('khataDetail.loading') : t('common.loadMore')}
        </button>
      )}

      {/* Add Entry Modal */}
      {modalType && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50" onClick={() => setModalType(null)}>
          <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-b-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg text-haldi font-700 mb-4">
              {modalType === 'purchase' ? t('khataDetail.newSaman') : modalType === 'return' ? t('khataDetail.maalWapas') : t('khataDetail.paymentReceived')}
            </div>
            {modalNeedsItem && (
              <>
                <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.itemName')}</label>
                <div className="relative mb-3">
                  <input
                    className="input"
                    value={form.item_name}
                    onChange={e => onItemNameChange(e.target.value)}
                    onFocus={() => setShowDropdown(true)}
                    placeholder={t('khataDetail.itemPlaceholder')}
                  />
                  {itemMatches.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 card p-1 z-10 max-h-48 overflow-y-auto">
                      {itemMatches.map(it => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => selectItem(it)}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-board3 flex justify-between items-center text-sm"
                        >
                          <span>{it.name}</span>
                          <span className="text-xs text-chalkdim font-mono">{fmt(it.price)}/{it.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedItemId && <div className="text-[10px] text-dhania mt-1">✓ {t('khataDetail.fromInventory')}</div>}
                </div>
                <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.qtyOptional')}</label>
                <input type="number" inputMode="decimal" className="input mb-3" value={form.qty} onChange={e => onQtyChange(e.target.value)} placeholder="e.g. 1" />
              </>
            )}
            <label className="block text-xs text-chalkdim mb-1">{t('khataDetail.amount')}</label>
            <input type="number" inputMode="decimal" className="input mb-1" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            {willGoOverLimit && (
              <div className="text-xs text-mirch mb-2">{t('khataDetail.limitWarning')} ({fmt(customer.credit_limit!)})</div>
            )}
            {modalType === 'payment' && (
              <>
                <label className="block text-xs text-chalkdim mb-1 mt-2">{t('khataDetail.paymentMethod')}</label>
                <select className="input mb-1" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as typeof paymentMethod)}>
                  <option value="cash">{t('paymentMethod.cash')}</option>
                  <option value="bank">{t('paymentMethod.bank')}</option>
                  <option value="easypaisa">{t('paymentMethod.easypaisa')}</option>
                  <option value="jazzcash">{t('paymentMethod.jazzcash')}</option>
                </select>
              </>
            )}
            <label className="block text-xs text-chalkdim mb-1 mt-2">{t('khataDetail.noteOptional')}</label>
            <input className="input mb-5" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => setModalType(null)} className="btn-secondary flex-1">{t('khataDetail.cancel')}</button>
              <button onClick={saveEntry} disabled={savingEntry} className="btn-primary flex-1">{savingEntry ? t('khataDetail.loading') : t('khataDetail.save')}</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <ContactEditModal
          kind="customer"
          contact={customer}
          balance={total}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); loadAll(); }}
          onDeleted={() => router.push('/dashboard/khata')}
        />
      )}

      {statementOpen && (
        <CustomerStatementModal
          customerId={customerId}
          customerName={customer.name}
          customerPhone={customer.phone}
          shopName={shopName || 'Dukaan'}
          autoPrint={wantsAutoPrint}
          onClose={() => setStatementOpen(false)}
        />
      )}
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n-server';
import { startOfTodayPKT } from '@/lib/pkt-time';
import ShareWhatsAppButton from '@/components/ShareWhatsAppButton';
import PrintButton from '@/components/PrintButton';
import { hasSection } from '@/lib/permissions';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role, allowed_sections').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  if (profile && !hasSection(profile.role as 'owner' | 'staff', profile.allowed_sections as string[] | null, 'reports')) redirect('/dashboard');
  const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();

  const startIso = startOfTodayPKT().toISOString();

  const [{ data: txns }, { data: khataRows }, { data: sales }, { data: returns }, { data: expensesToday }] = await Promise.all([
    supabase.from('transactions').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('khata_entries').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    // Separate query with the items join (cost_price) just for the sold
    // rows — profit needs cost_price per line, which the summary query
    // above doesn't fetch.
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', startIso),
    // Same shape, for cash-sale returns — a return reverses both the
    // revenue and cost side of whatever sale it undoes.
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'return').gte('created_at', startIso),
    supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: startIso })
  ]);

  // A returned sale stops counting as a sale the moment it's returned —
  // same netting as Overview's Monthly Sales / Weekly Profit cards.
  const returnsToday = (txns || []).filter((r: any) => r.type === 'return').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const totalSales = (txns || []).filter((r: any) => r.type === 'sale').reduce((s: number, r: any) => s + (r.amount || 0), 0) - returnsToday;
  const stockPurchased = (txns || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const udhaarDiya = (khataRows || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const paymentMila = (khataRows || []).filter((r: any) => r.type === 'payment').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  // Combines credit-note returns (khata) and cash-sale returns — one
  // "how much came back today" number regardless of which it was.
  const khataReturnsToday = (khataRows || []).filter((r: any) => r.type === 'return').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const totalReturnsToday = returnsToday + khataReturnsToday;
  const expenses = expensesToday || 0;

  // Profit = today's sale revenue minus cost of goods sold minus today's
  // overhead (rent/salary/utility/etc, from the new expenses table) —
  // using each item's current cost_price (not a historical snapshot —
  // if a cost changes mid-day this is an approximation, close enough
  // for a daily read rather than formal accounting). Expenses used to
  // not exist at all here, which meant this number was really "gross
  // margin," not profit — overstated every single day by whatever the
  // shop actually spent to keep running.
  const marginOf = (rows: any[]) => rows.reduce((s: number, r: any) => {
    const costPrice = r.items?.cost_price || 0;
    return s + (r.amount || 0) - (r.qty || 0) * costPrice;
  }, 0);
  const grossMargin = marginOf(sales || []) - marginOf(returns || []);
  const profit = grossMargin - expenses;

  const shareText = t('reports.summaryMsg')
    .replace('{shop}', shop?.name || 'Dukaan')
    .replace('{sales}', totalSales.toLocaleString('en-IN'))
    .replace('{given}', udhaarDiya.toLocaleString('en-IN'))
    .replace('{received}', paymentMila.toLocaleString('en-IN'))
    .replace('{stock}', stockPurchased.toLocaleString('en-IN'));

  return (
    <div className="max-w-md">
      {/* Shop name + date only matter on paper — on screen both are
          already in the header and implied by "today". */}
      <div className="hidden print:block mb-5">
        <div className="font-display text-2xl font-800">{shop?.name || 'Dukaan'}</div>
        <div className="text-sm text-chalkdim">
          {t('reports.title')} — {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      <h1 className="font-display text-xl font-700 mb-1 no-print">{t('reports.title')}</h1>
      <p className="text-chalkdim text-sm mb-5 no-print">{t('reports.subtitle')}</p>

      <div className="card p-5 mb-5">
        <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.profit')}</div>
        <div className={`font-mono font-800 text-3xl ${profit >= 0 ? 'text-dhania' : 'text-mirch'}`}>{fmt(profit)}</div>
        <div className="text-[11px] text-chalkdim mt-1">{t('reports.profitNote')}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.totalSales')}</div>
          <div className="font-mono font-700 text-lg text-dhania">{fmt(totalSales)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.stockPurchased')}</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(stockPurchased)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.udhaarDiya')}</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(udhaarDiya)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.paymentMila')}</div>
          <div className="font-mono font-700 text-lg text-dhania">{fmt(paymentMila)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.expenses')}</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(expenses)}</div>
        </div>
        {totalReturnsToday > 0 && (
          <div className="card p-4">
            <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.returnedToday')}</div>
            <div className="font-mono font-700 text-lg text-haldi">{fmt(totalReturnsToday)}</div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 no-print">
        <ShareWhatsAppButton text={shareText} label={t('reports.shareWhatsapp')} />
        <PrintButton label={t('reports.print')} />
      </div>
    </div>
  );
}

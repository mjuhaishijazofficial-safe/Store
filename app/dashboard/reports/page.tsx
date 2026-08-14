import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';
import { startOfTodayPKT, startOfMonthPKT, daysAgoPKT } from '@/lib/pkt-time';
import ShareWhatsAppButton from '@/components/ShareWhatsAppButton';
import PrintButton from '@/components/PrintButton';
import { hasSection } from '@/lib/permissions';

// Master Handoff Spec §11: date range picker, profit summary, Top-Selling
// Items, Category-wise Sale, Staff Performance, Low-margin Items warning.
// Branch filter is skipped — this app is single-branch (no Multi-Branch,
// spec §30 lists that as P2). Top-Selling/Category are rendered as plain
// ranked lists rather than an actual bar/pie chart — no charting library
// in this codebase yet (Dashboard's own "Top Selling" widget is the same
// list-not-chart treatment), so this stays consistent with it rather
// than pulling in a new dependency for one page.

type Range = 'today' | 'week' | 'month';
const LOW_MARGIN_THRESHOLD = 0.10;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role, allowed_sections').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  if (profile && !hasSection(profile.role as 'owner' | 'manager' | 'cashier', profile.allowed_sections as string[] | null, 'reports')) redirect('/dashboard');
  const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();

  const resolvedParams = await searchParams;
  const range: Range = resolvedParams.range === 'week' ? 'week' : resolvedParams.range === 'month' ? 'month' : 'today';
  const startDate = range === 'today' ? startOfTodayPKT() : range === 'week' ? daysAgoPKT(7) : startOfMonthPKT();
  const startIso = startDate.toISOString();
  const lookbackDays = range === 'today' ? 1 : range === 'week' ? 7 : 30;

  const [
    { data: txns }, { data: khataRows }, { data: sales }, { data: returns }, { data: expensesInRange },
    { data: topSelling }, { data: categoryRows }, { data: staffRows }, { data: items }
  ] = await Promise.all([
    supabase.from('transactions').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('khata_entries').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', startIso),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'return').gte('created_at', startIso),
    supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: startIso }),
    supabase.rpc('top_selling_items', { p_shop_id: shopId, p_days: lookbackDays, p_limit: 5 }),
    supabase.from('transactions').select('type, amount, items(category)').eq('shop_id', shopId).in('type', ['sale', 'return']).gte('created_at', startIso),
    supabase.from('transactions').select('amount, created_by, profiles(full_name, email)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', startIso),
    supabase.from('items').select('id, name, cost_price, price').eq('shop_id', shopId)
  ]);

  const returnsInRange = (txns || []).filter((r: any) => r.type === 'return').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const totalSales = (txns || []).filter((r: any) => r.type === 'sale').reduce((s: number, r: any) => s + (r.amount || 0), 0) - returnsInRange;
  const stockPurchased = (txns || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const udhaarDiya = (khataRows || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const paymentMila = (khataRows || []).filter((r: any) => r.type === 'payment').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const khataReturnsInRange = (khataRows || []).filter((r: any) => r.type === 'return').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const totalReturnsInRange = returnsInRange + khataReturnsInRange;
  const expenses = expensesInRange || 0;

  const marginOf = (rows: any[]) => rows.reduce((s: number, r: any) => {
    const costPrice = r.items?.cost_price || 0;
    return s + (r.amount || 0) - (r.qty || 0) * costPrice;
  }, 0);
  const grossMargin = marginOf(sales || []) - marginOf(returns || []);
  const profit = grossMargin - expenses;

  // Category-wise Sale: netted the same way Top-Selling already nets
  // returns against sales elsewhere in this app — a heavily-returned
  // category shouldn't read as a top earner.
  const categoryTotals = new Map<string, number>();
  for (const row of (categoryRows || []) as any[]) {
    const cat = row.items?.category?.trim() || t('inventory.category');
    const signed = row.type === 'sale' ? row.amount : -row.amount;
    categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + signed);
  }
  const categoryList = [...categoryTotals.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Staff Performance: only worth showing once more than one person has
  // actually billed a sale in this range (spec §11: "agar multiple staff
  // hain") — a solo owner shop would just see itself in a table of one.
  const staffTotals = new Map<string, { name: string; total: number }>();
  for (const row of (staffRows || []) as any[]) {
    const key = row.created_by || 'unknown';
    const name = row.profiles?.full_name || row.profiles?.email || t('khataDetail.notFound');
    const existing = staffTotals.get(key) || { name, total: 0 };
    existing.total += row.amount || 0;
    staffTotals.set(key, existing);
  }
  const staffList = [...staffTotals.values()].sort((a, b) => b.total - a.total);

  const lowMarginItems = (items || [])
    .filter((i: any) => i.price > 0 && i.cost_price > 0 && (i.price - i.cost_price) / i.price < LOW_MARGIN_THRESHOLD)
    .sort((a: any, b: any) => (a.price - a.cost_price) / a.price - (b.price - b.cost_price) / b.price)
    .slice(0, 8);

  const shareText = t('reports.summaryMsg')
    .replace('{shop}', shop?.name || 'Dukaan')
    .replace('{sales}', totalSales.toLocaleString('en-IN'))
    .replace('{given}', udhaarDiya.toLocaleString('en-IN'))
    .replace('{received}', paymentMila.toLocaleString('en-IN'))
    .replace('{stock}', stockPurchased.toLocaleString('en-IN'));

  const rangeLabel = { today: t('reports.rangeToday'), week: t('reports.rangeWeek'), month: t('reports.rangeMonth') }[range];

  return (
    <div className="max-w-md">
      <div className="hidden print:block mb-5">
        <div className="font-display text-2xl font-800">{shop?.name || 'Dukaan'}</div>
        <div className="text-sm text-chalkdim">{t('reports.title')} — {rangeLabel}</div>
      </div>

      <h1 className="font-display text-xl font-700 mb-1 no-print">{t('reports.title')}</h1>
      <p className="text-chalkdim text-sm mb-4 no-print">{t('reports.subtitle')}</p>

      <div className="flex gap-2 mb-5 no-print">
        {(['today', 'week', 'month'] as Range[]).map(r => (
          <Link
            key={r}
            href={`/dashboard/reports?range=${r}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${range === r ? 'border-haldi text-haldi font-700' : 'border-chalk/15 text-chalkdim'}`}
          >
            {{ today: t('reports.rangeToday'), week: t('reports.rangeWeek'), month: t('reports.rangeMonth') }[r]}
          </Link>
        ))}
      </div>

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
        {totalReturnsInRange > 0 && (
          <div className="card p-4">
            <div className="text-xs text-chalkdim uppercase tracking-wide mb-1">{t('reports.returnedToday')}</div>
            <div className="font-mono font-700 text-lg text-haldi">{fmt(totalReturnsInRange)}</div>
          </div>
        )}
      </div>

      {topSelling && topSelling.length > 0 && (
        <div className="mb-5">
          <h2 className="font-display text-base font-700 mb-2">{t('reports.topSelling')}</h2>
          <div className="card divide-y divide-chalk/10">
            {topSelling.map((p: any, i: number) => (
              <div key={p.item_id} className="p-3 px-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="text-chalkdim font-mono text-xs w-4">{i + 1}</span>
                  <span className="text-sm font-600">{p.item_name}</span>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-700">{p.qty_sold} {p.unit}</div>
                  <div className="text-[11px] text-chalkdim">{fmt(p.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <h2 className="font-display text-base font-700 mb-2">{t('reports.categorySales')}</h2>
        {categoryList.length === 0 ? (
          <div className="text-chalkdim text-xs">{t('reports.noCategoryData')}</div>
        ) : (
          <div className="card divide-y divide-chalk/10">
            {categoryList.map(([cat, amount]) => (
              <div key={cat} className="p-3 px-4 flex justify-between items-center text-sm">
                <span>{cat}</span>
                <span className="font-mono font-700">{fmt(amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {staffList.length > 1 && (
        <div className="mb-5">
          <h2 className="font-display text-base font-700 mb-2">{t('reports.staffPerformance')}</h2>
          <div className="card divide-y divide-chalk/10">
            {staffList.map(s => (
              <div key={s.name} className="p-3 px-4 flex justify-between items-center text-sm">
                <span>{s.name}</span>
                <span className="font-mono font-700 text-dhania">{fmt(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {lowMarginItems.length > 0 && (
        <div className="mb-5">
          <h2 className="font-display text-base font-700 mb-1 text-haldi">{t('reports.lowMargin')}</h2>
          <p className="text-chalkdim text-xs mb-2">{t('reports.lowMarginHint')}</p>
          <div className="card divide-y divide-chalk/10">
            {lowMarginItems.map((it: any) => (
              <div key={it.id} className="p-3 px-4 flex justify-between items-center text-sm">
                <span>{it.name}</span>
                <span className="font-mono text-haldi">{Math.round(((it.price - it.cost_price) / it.price) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 no-print">
        <ShareWhatsAppButton text={shareText} label={t('reports.shareWhatsapp')} />
        <PrintButton label={t('reports.print')} />
      </div>
    </div>
  );
}

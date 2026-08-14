import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';
import { startOfTodayPKT, startOfMonthPKT, daysAgoPKT } from '@/lib/pkt-time';
import ShareWhatsAppButton from '@/components/ShareWhatsAppButton';
import PrintButton from '@/components/PrintButton';
import { hasSection } from '@/lib/permissions';

// Master Handoff Spec §11 + Figma match (Mobile UI brief Reports
// screen): date range tabs, a Total Sales/Gross Profit/Expenses/Net
// Profit 2x2 hero, a 7-day bar trend, numbered Top Customers. The
// extra P0/§11 metrics this page already had (stock purchased, udhaar
// diya, category sales, staff performance, low-margin warning) aren't
// in Figma's mockup but are real spec requirements — kept as
// "More Details" sections below the hero, same pattern as Dashboard.

type Range = 'today' | 'week' | 'month';
const LOW_MARGIN_THRESHOLD = 0.10;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

const AVATAR_COLORS = ['#0B5E56', '#B8791A', '#7A2E1D', '#1E7A4C', '#8A6747'];

function BarTrend({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  return (
    <div className="flex items-end gap-2 h-16">
      {points.map((v, i) => (
        <div key={i} className="flex-1 rounded-t bg-haldi/20 relative" style={{ height: '100%' }}>
          <div className="absolute bottom-0 inset-x-0 rounded-t bg-haldi" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
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
  const trendStartIso = daysAgoPKT(6).toISOString();

  const [
    { data: txns }, { data: khataRows }, { data: sales }, { data: returns }, { data: expensesInRange },
    { data: topSelling }, { data: categoryRows }, { data: staffRows }, { data: items },
    { data: topCustomers }, { data: trendSales }, { data: trendReturns }
  ] = await Promise.all([
    supabase.from('transactions').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('khata_entries').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', startIso),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'return').gte('created_at', startIso),
    supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: startIso }),
    supabase.rpc('top_selling_items', { p_shop_id: shopId, p_days: lookbackDays, p_limit: 5 }),
    supabase.from('transactions').select('type, amount, items(category)').eq('shop_id', shopId).in('type', ['sale', 'return']).gte('created_at', startIso),
    supabase.from('transactions').select('amount, created_by, profiles(full_name, email)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', startIso),
    supabase.from('items').select('id, name, cost_price, price').eq('shop_id', shopId),
    supabase.rpc('khata_top_customers', { p_shop_id: shopId, p_limit: 3 }),
    supabase.from('transactions').select('amount, created_at').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', trendStartIso),
    supabase.from('transactions').select('amount, created_at').eq('shop_id', shopId).eq('type', 'return').gte('created_at', trendStartIso)
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
  const grossProfit = marginOf(sales || []) - marginOf(returns || []);
  const netProfit = grossProfit - expenses;

  const trendDays: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(daysAgoPKT(i)).toISOString();
    const dayEnd = new Date(daysAgoPKT(i - 1)).toISOString();
    const s = (trendSales || []).filter((r: any) => r.created_at >= dayStart && r.created_at < dayEnd).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
    const ret = (trendReturns || []).filter((r: any) => r.created_at >= dayStart && r.created_at < dayEnd).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
    trendDays.push(Math.max(0, s - ret));
  }

  const categoryTotals = new Map<string, number>();
  for (const row of (categoryRows || []) as any[]) {
    const cat = row.items?.category?.trim() || t('inventory.category');
    const signed = row.type === 'sale' ? row.amount : -row.amount;
    categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + signed);
  }
  const categoryList = [...categoryTotals.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);

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

      <h1 className="font-display text-xl font-700 mb-4 no-print">{t('reports.title')}</h1>

      <div className="flex rounded-full bg-board3 p-1 mb-5 no-print">
        {(['today', 'week', 'month'] as Range[]).map(r => (
          <Link key={r} href={`/dashboard/reports?range=${r}`} className={`flex-1 text-center text-xs py-1.5 rounded-full ${range === r ? 'bg-board2 text-haldi font-700 shadow-sm' : 'text-chalkdim'}`}>
            {{ today: t('reports.rangeToday'), week: t('reports.rangeWeek'), month: t('reports.rangeMonth') }[r]}
          </Link>
        ))}
      </div>

      {/* Figma hero — Total Sales / Gross Profit / Expenses / Net Profit */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.totalSales')}</div><div className="font-mono font-700 text-lg text-dhania">{fmt(totalSales)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.grossProfit')}</div><div className="font-mono font-700 text-lg">{fmt(grossProfit)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.expenses')}</div><div className="font-mono font-700 text-lg text-mirch">{fmt(expenses)}</div></div>
        <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.netProfit')}</div><div className={`font-mono font-700 text-lg ${netProfit >= 0 ? 'text-dhania' : 'text-mirch'}`}>{fmt(netProfit)}</div></div>
      </div>

      <div className="card p-4 mb-5">
        <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-2">{t('overview.salesTrend')}</div>
        <BarTrend points={trendDays} />
        <div className="flex justify-between text-[10px] text-chalkdim mt-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
      </div>

      {topCustomers && topCustomers.length > 0 && (
        <div className="mb-5">
          <h2 className="font-display text-base font-700 mb-2">{t('khata.topCustomers')}</h2>
          <div className="card divide-y divide-chalk/10">
            {topCustomers.map((c: any, i: number) => (
              <Link key={c.customer_id} href={`/dashboard/khata/${c.customer_id}`} className="p-3 px-4 flex items-center gap-3">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-700 shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{i + 1}</span>
                <span className="text-sm font-600 flex-1">{c.customer_name}</span>
                <span className="font-mono text-sm font-700">{fmt(c.total_purchases)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2 mt-2 border-t border-chalk/10">
        <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-3 mt-3">{t('reports.moreDetails')}</div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.stockPurchased')}</div><div className="font-mono font-700 text-sm text-mirch">{fmt(stockPurchased)}</div></div>
          <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.udhaarDiya')}</div><div className="font-mono font-700 text-sm text-mirch">{fmt(udhaarDiya)}</div></div>
          <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.paymentMila')}</div><div className="font-mono font-700 text-sm text-dhania">{fmt(paymentMila)}</div></div>
          {totalReturnsInRange > 0 && (
            <div className="card p-4"><div className="text-[11px] text-chalkdim mb-1">{t('reports.returnedToday')}</div><div className="font-mono font-700 text-sm text-haldi">{fmt(totalReturnsInRange)}</div></div>
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
      </div>

      <div className="flex flex-col gap-2 no-print">
        <ShareWhatsAppButton text={shareText} label={t('reports.shareWhatsapp')} />
        <PrintButton label={t('reports.print')} />
      </div>
    </div>
  );
}

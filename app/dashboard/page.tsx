import { createClient } from '@/lib/supabase/server';
import { getServerT } from '@/lib/i18n-server';
import { startOfMonthPKT, daysAgoPKT } from '@/lib/pkt-time';
import Link from 'next/link';
import { WalletIcon, TrendDownIcon, CashIcon, ChartIcon, TrendUpIcon, ReceiptIcon, FireIcon, WarningIcon, ArrowRightIcon } from '@/components/icons';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

function StatCard({ icon, iconClass, label, value, valueClass = '' }: { icon: React.ReactNode; iconClass: string; label: string; value: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${iconClass}`}>
        {icon}
      </div>
      <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-1">{label}</div>
      <div className={`font-mono font-700 text-lg ${valueClass}`}>{value}</div>
    </div>
  );
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const shopId = profile?.shop_id;

  const monthStartIso = startOfMonthPKT().toISOString();
  const weekStartIso = daysAgoPKT(7).toISOString();

  const [
    { data: shop },
    { data: items },
    { count: itemCount },
    { data: spentRow },
    { data: monthSalesRow },
    { data: weekSales },
    { data: balances },
    { data: topSelling }
  ] = await Promise.all([
    supabase.from('shops').select('budget').eq('id', shopId).single(),
    supabase.from('items').select('id, stock, min_stock').eq('shop_id', shopId),
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
    // spent is computed from the transactions log, not stored on shops —
    // same "never store a running balance" rule as khata/supplier ledgers.
    supabase.from('transactions').select('amount.sum()').eq('shop_id', shopId).eq('type', 'purchase').single(),
    supabase.from('transactions').select('amount.sum()').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', monthStartIso).single(),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', weekStartIso),
    supabase.rpc('khata_balances', { p_shop_id: shopId }),
    supabase.rpc('top_selling_items', { p_shop_id: shopId, p_days: 30, p_limit: 5 })
  ]);

  const lowStockItems = (items || []).filter((i: any) => i.stock <= i.min_stock);
  const budget = shop?.budget || 0;
  const spent = (spentRow as any)?.sum || 0;
  const monthlySales = (monthSalesRow as any)?.sum || 0;

  const weeklyProfit = (weekSales || []).reduce((s: number, r: any) => {
    const costPrice = r.items?.cost_price || 0;
    return s + (r.amount || 0) - (r.qty || 0) * costPrice;
  }, 0);

  const pendingKhata = (balances || []).reduce((s: number, r: any) => s + Math.max(0, r.balance), 0);

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">{t('overview.title')}</h1>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard icon={<WalletIcon className="w-5 h-5" />} iconClass="bg-haldi/15 text-haldi" label={t('overview.totalBudget')} value={fmt(budget)} />
        <StatCard icon={<TrendDownIcon className="w-5 h-5" />} iconClass="bg-mirch/15 text-mirch" label={t('overview.spent')} value={fmt(spent)} valueClass="text-mirch" />
        <StatCard icon={<CashIcon className="w-5 h-5" />} iconClass="bg-dhania/15 text-dhania" label={t('overview.remaining')} value={fmt(budget - spent)} valueClass="text-dhania" />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard icon={<ChartIcon className="w-5 h-5" />} iconClass="bg-haldi/15 text-haldi" label={t('overview.monthlySales')} value={fmt(monthlySales)} />
        <StatCard icon={<TrendUpIcon className="w-5 h-5" />} iconClass="bg-dhania/15 text-dhania" label={t('overview.weeklyProfit')} value={fmt(weeklyProfit)} valueClass={weeklyProfit >= 0 ? 'text-dhania' : 'text-mirch'} />
        <StatCard icon={<ReceiptIcon className="w-5 h-5" />} iconClass="bg-mirch/15 text-mirch" label={t('overview.pendingKhata')} value={fmt(pendingKhata)} valueClass="text-mirch" />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="card p-5">
          <div className="text-3xl font-mono font-700 text-haldi">{itemCount || 0}</div>
          <div className="text-sm text-chalkdim mt-1">{t('overview.totalItems')}</div>
        </div>
        <div className="card p-5">
          <div className="text-3xl font-mono font-700 text-mirch">{lowStockItems.length}</div>
          <div className="text-sm text-chalkdim mt-1">{t('overview.itemsToReorder')}</div>
        </div>
      </div>

      {topSelling && topSelling.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <FireIcon className="w-4 h-4 text-haldi" />
            <h2 className="font-display text-base font-700">{t('overview.topSelling')}</h2>
          </div>
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

      {lowStockItems.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <WarningIcon className="w-4 h-4 text-mirch" />
            <h2 className="font-display text-base font-700">{t('overview.itemsToReorder')}</h2>
          </div>
          <Link href="/dashboard/reorder" className="card divide-y divide-chalk/10 block">
            {lowStockItems.slice(0, 5).map((it: any) => (
              <div key={it.id} className="p-3 px-4 flex justify-between items-center text-sm">
                <span className="font-600">{it.name}</span>
                <span className="font-mono text-mirch">{it.stock}</span>
              </div>
            ))}
          </Link>
        </div>
      )}

      <Link href="/dashboard/reports" className="card p-4 flex items-center gap-4 hover:border-haldi">
        <div className="w-11 h-11 rounded-full bg-haldi/15 text-haldi flex items-center justify-center shrink-0">
          <ChartIcon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="font-display font-700 text-haldi">{t('overview.dailyReport')}</div>
          <div className="text-xs text-chalkdim">{t('overview.dailyReportSub')}</div>
        </div>
        <ArrowRightIcon className="w-5 h-5 text-haldi shrink-0" />
      </Link>
    </div>
  );
}

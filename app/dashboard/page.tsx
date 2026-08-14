import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n-server';
import { startOfTodayPKT, daysAgoPKT } from '@/lib/pkt-time';
import Link from 'next/link';
import {
  GearIcon, BellIcon, ReceiptIcon, WarningIcon, FireIcon, ClockIcon,
  PlusIcon, CartIcon, ScanIcon, ChartIcon
} from '@/components/icons';
import { hasSection } from '@/lib/permissions';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// Figma match (Mobile UI brief) — this dashboard's hero row is
// Today's Sales / Today's Profit / Total Khata / Low Stock, not the
// Kul Budget / Kharch / Baki cards Master Spec §6's wireframe
// describes. Per the handoff's own priority rule ("Figma final visual
// truth hai"), Figma leads for the flagship view; Budget tracking is a
// real, still-required feature (§6, and Settings' own "Total Budget"
// field needs somewhere to show it) — kept as a secondary section
// below the hero rather than dropped, so nothing that used to work
// here stops working.
function StatCard({ icon, iconBg, label, value, valueClass = '', sub, href }: {
  icon: React.ReactNode; iconBg: string; label: string; value: string; valueClass?: string; sub?: string; href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconBg}`}>{icon}</div>
      </div>
      <div className="text-[11px] text-chalkdim mb-0.5">{label}</div>
      <div className={`font-mono font-700 text-lg truncate ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-chalkdim mt-0.5">{sub}</div>}
    </>
  );
  return href
    ? <Link href={href} className="card p-4 block">{body}</Link>
    : <div className="card p-4">{body}</div>;
}

// Plain SVG sparkline — no charting library in this codebase (see
// app/dashboard/reports/page.tsx's own note on the same tradeoff).
function TrendLine({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 280;
  const h = 56;
  const step = w / (points.length - 1 || 1);
  const coords = points.map((v, i) => `${i * step},${h - (v / max) * (h - 8) - 4}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="rgb(var(--color-haldi))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, full_name, role, allowed_sections').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  const role = (profile?.role as 'owner' | 'manager' | 'cashier') || 'cashier';
  // Billing/POS is the spec's forced default landing for Cashier (§14) —
  // Overview is an owner-facing snapshot a cashier has no use for.
  if (role === 'cashier') redirect('/dashboard/billing');
  const allowedSections = (profile?.allowed_sections as string[] | null) ?? null;
  const can = (s: Parameters<typeof hasSection>[2]) => hasSection(role, allowedSections, s);

  const todayStartIso = startOfTodayPKT().toISOString();
  const weekStartIso = daysAgoPKT(7).toISOString();

  const [
    { data: shop },
    { data: items },
    { count: itemCount },
    { data: spentValue },
    { data: weekSales },
    { data: weekReturns },
    { data: balances },
    { data: topSelling },
    { data: recentTxns },
    { data: recentPayments },
    { count: customerCount },
    { data: todayExpensesValue }
  ] = await Promise.all([
    supabase.from('shops').select('budget, name').eq('id', shopId).single(),
    supabase.from('items').select('id, stock, min_stock').eq('shop_id', shopId),
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
    supabase.rpc('transactions_sum', { p_shop_id: shopId, p_type: 'purchase' }),
    // created_at added to both (beyond what this query needed before)
    // so today's slice of the week can be derived in JS below instead
    // of firing a whole separate pair of queries for it.
    supabase.from('transactions').select('qty, amount, items(cost_price), created_at').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', weekStartIso),
    supabase.from('transactions').select('qty, amount, items(cost_price), created_at').eq('shop_id', shopId).eq('type', 'return').gte('created_at', weekStartIso),
    supabase.rpc('khata_balances', { p_shop_id: shopId }),
    supabase.rpc('top_selling_items', { p_shop_id: shopId, p_days: 30, p_limit: 5 }),
    supabase.from('transactions').select('id, item_name, type, qty, unit, amount, created_at').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(5),
    supabase.from('khata_entries').select('id, amount, created_at, customers(name)').eq('shop_id', shopId).eq('type', 'payment').order('created_at', { ascending: false }).limit(5),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
    supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: todayStartIso })
  ]);

  const lowStockItems = (items || []).filter((i: any) => i.stock <= i.min_stock);
  const budget = shop?.budget || 0;
  const spent = spentValue || 0;

  const marginOf = (rows: any[]) => rows.reduce((s: number, r: any) => {
    const costPrice = r.items?.cost_price || 0;
    return s + (r.amount || 0) - (r.qty || 0) * costPrice;
  }, 0);

  const todaySalesRows = (weekSales || []).filter((r: any) => r.created_at >= todayStartIso);
  const todayReturnsRows = (weekReturns || []).filter((r: any) => r.created_at >= todayStartIso);
  const todaySales = todaySalesRows.reduce((s: number, r: any) => s + (r.amount || 0), 0) - todayReturnsRows.reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const todayProfit = marginOf(todaySalesRows) - marginOf(todayReturnsRows) - (todayExpensesValue || 0);

  const pendingKhata = (balances || []).reduce((s: number, r: any) => s + Math.max(0, r.balance), 0);

  // 7-day trend for the sparkline — bucketed from the same week rows
  // already fetched above (net of returns, same "a return isn't
  // revenue" rule the rest of this app applies).
  const trendDays: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(daysAgoPKT(i));
    const dayEnd = new Date(daysAgoPKT(i - 1));
    const daySales = (weekSales || []).filter((r: any) => r.created_at >= dayStart.toISOString() && r.created_at < dayEnd.toISOString()).reduce((s: number, r: any) => s + (r.amount || 0), 0);
    const dayReturns = (weekReturns || []).filter((r: any) => r.created_at >= dayStart.toISOString() && r.created_at < dayEnd.toISOString()).reduce((s: number, r: any) => s + (r.amount || 0), 0);
    trendDays.push(Math.max(0, daySales - dayReturns));
  }

  const activity = [
    ...(recentTxns || []).map((row: any) => ({
      id: row.id,
      kind: row.type as 'sale' | 'purchase' | 'return',
      label: row.item_name,
      sub: `${row.qty}${row.unit ? ' ' + row.unit : ''} · ${fmt(row.amount)}`,
      amount: row.amount,
      created_at: row.created_at
    })),
    ...(recentPayments || []).map((row: any) => ({
      id: row.id,
      kind: 'payment' as const,
      label: row.customers?.name || '—',
      sub: fmt(row.amount),
      amount: row.amount,
      created_at: row.created_at
    }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);

  const steps = [
    { done: budget > 0, label: t('onboard.setBudget'), href: '/dashboard/settings' },
    { done: (itemCount || 0) > 0, label: t('onboard.addItem'), href: '/dashboard/inventory' },
    { done: (customerCount || 0) > 0, label: t('onboard.addCustomer'), href: '/dashboard/khata' },
    { done: (recentTxns || []).length > 0, label: t('onboard.recordSale'), href: '/dashboard/inventory' }
  ];
  const stepsDone = steps.filter(s => s.done).length;
  const showOnboarding = stepsDone < steps.length;

  const greeting = t('overview.greeting').replace('{name}', profile?.full_name?.split(' ')[0] || t('overview.greetingFallback'));

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="font-display text-lg font-700">{greeting}</div>
          <div className="text-xs text-chalkdim">{shop?.name || ''}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link href="/dashboard/settings" className="w-9 h-9 rounded-full flex items-center justify-center text-chalkdim hover:text-haldi hover:bg-board3" aria-label={t('nav.settings')}>
            <GearIcon className="w-5 h-5" />
          </Link>
          <span className="w-9 h-9 rounded-full flex items-center justify-center text-chalkdim">
            <BellIcon className="w-5 h-5" />
          </span>
        </div>
      </div>

      {showOnboarding && (
        <div className="card p-5 mb-6 border-haldi/40">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="font-display text-base font-700 text-haldi">{t('onboard.title')}</h2>
            <span className="text-xs text-chalkdim font-mono shrink-0">{stepsDone}/{steps.length}</span>
          </div>
          <p className="text-chalkdim text-xs mb-4">{t('onboard.subtitle')}</p>
          <div className="h-1.5 rounded-full bg-board3 overflow-hidden mb-4">
            <div className="h-full rounded-full bg-haldi" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
          </div>
          <div className="space-y-1.5">
            {steps.map(s => (
              <Link key={s.label} href={s.href} className={`flex items-center gap-2.5 text-sm py-1 ${s.done ? 'text-chalkdim' : ''}`}>
                <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] shrink-0 ${s.done ? 'bg-dhania border-dhania text-board' : 'border-chalk/25'}`}>{s.done ? '✓' : ''}</span>
                <span className={s.done ? 'line-through' : 'font-600'}>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Hero 2x2 — Figma's exact 4 (Today's Sales/Profit/Total Khata/Low Stock) */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard icon={<ChartIcon className="w-4 h-4" />} iconBg="bg-dhania/15 text-dhania" label={t('overview.todaySales')} value={fmt(todaySales)} href={can('reports') ? '/dashboard/reports' : undefined} />
        <StatCard icon={<ReceiptIcon className="w-4 h-4" />} iconBg="bg-haldi/15 text-haldi" label={t('overview.todayProfit')} value={fmt(todayProfit)} valueClass={todayProfit >= 0 ? '' : 'text-mirch'} href={can('reports') ? '/dashboard/reports' : undefined} />
        <StatCard icon={<ReceiptIcon className="w-4 h-4" />} iconBg="bg-mirch/15 text-mirch" label={t('overview.totalKhata')} value={fmt(pendingKhata)} valueClass="text-mirch" sub={t('overview.customersCount').replace('{n}', String(customerCount || 0))} href={can('khata') ? '/dashboard/khata' : undefined} />
        <StatCard icon={<WarningIcon className="w-4 h-4" />} iconBg="bg-haldi/15 text-haldi" label={t('overview.lowStock')} value={String(lowStockItems.length)} sub={t('overview.needsReorder')} href={can('reorder') ? '/dashboard/reorder' : undefined} />
      </div>

      {/* Quick Actions — Figma's exact 4: Add Sale / Add Product / Payment / Scan */}
      <div className="mb-6">
        <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-2">{t('overview.quickActions')}</div>
        <div className="grid grid-cols-4 gap-2">
          <Link href="/dashboard/billing" className="card p-3 flex flex-col items-center text-center gap-1.5">
            <div className="w-9 h-9 rounded-full gradient-brand shadow-glow text-board flex items-center justify-center"><PlusIcon className="w-4 h-4" /></div>
            <span className="text-[10px] font-600">{t('overview.addSale')}</span>
          </Link>
          {can('inventory') && (
            <Link href="/dashboard/inventory" className="card p-3 flex flex-col items-center text-center gap-1.5">
              <div className="w-9 h-9 rounded-full bg-dhania/15 text-dhania flex items-center justify-center"><CartIcon className="w-4 h-4" /></div>
              <span className="text-[10px] font-600">{t('overview.addItem')}</span>
            </Link>
          )}
          {can('khata') && (
            <Link href="/dashboard/khata" className="card p-3 flex flex-col items-center text-center gap-1.5">
              <div className="w-9 h-9 rounded-full bg-mirch/15 text-mirch flex items-center justify-center"><ReceiptIcon className="w-4 h-4" /></div>
              <span className="text-[10px] font-600">{t('overview.payment')}</span>
            </Link>
          )}
          {can('suppliers') && (
            <Link href="/dashboard/purchase-orders" className="card p-3 flex flex-col items-center text-center gap-1.5">
              <div className="w-9 h-9 rounded-full bg-haldi/15 text-haldi flex items-center justify-center"><ScanIcon className="w-4 h-4" /></div>
              <span className="text-[10px] font-600">{t('overview.scan')}</span>
            </Link>
          )}
        </div>
      </div>

      {can('reorder') && lowStockItems.length > 0 && (
        <Link href="/dashboard/reorder" className="card p-4 mb-6 flex items-center justify-between border-haldi/40 bg-haldi/5">
          <div className="flex items-center gap-3">
            <WarningIcon className="w-5 h-5 text-haldi shrink-0" />
            <div className="text-sm">
              <span className="font-700">{t('overview.lowStockAlert').replace('{n}', String(lowStockItems.length))}</span>
              <div className="text-[11px] text-chalkdim">{t('overview.lowStockAlertSub')}</div>
            </div>
          </div>
          <span className="text-haldi text-lg shrink-0">›</span>
        </Link>
      )}

      <div className="card p-4 mb-6">
        <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-2">{t('overview.salesTrend')}</div>
        <TrendLine points={trendDays} />
        <div className="flex justify-between text-[10px] text-chalkdim mt-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
      </div>

      {activity.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><ClockIcon className="w-4 h-4 text-haldi" /><h2 className="font-display text-base font-700">{t('overview.recentActivity')}</h2></div>
            {can('history') && <Link href="/dashboard/history" className="text-xs text-haldi">{t('overview.seeAll')}</Link>}
          </div>
          <div className="card divide-y divide-chalk/10">
            {activity.map(a => {
              const positive = a.kind === 'sale' || a.kind === 'payment';
              return (
                <div key={a.id} className="p-3 px-4 flex justify-between items-center text-sm">
                  <div>
                    <span className="font-600">{a.label}</span>
                    <div className="text-[11px] text-chalkdim">
                      {a.kind === 'sale' ? t('overview.sold') : a.kind === 'purchase' ? t('overview.purchased') : a.kind === 'return' ? t('overview.returned') : t('overview.paymentReceived')}
                    </div>
                  </div>
                  <span className={`font-mono text-xs shrink-0 ${positive ? 'text-dhania' : 'text-mirch'}`}>{positive ? '+' : '−'}{fmt(a.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {can('inventory') && topSelling && topSelling.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2"><FireIcon className="w-4 h-4 text-haldi" /><h2 className="font-display text-base font-700">{t('overview.topProducts')}</h2></div>
          <div className="card p-4 space-y-3">
            {topSelling.map((p: any) => {
              const maxRevenue = Math.max(...topSelling.map((x: any) => x.revenue), 1);
              return (
                <div key={p.item_id}>
                  <div className="flex justify-between text-sm mb-1"><span className="font-600 truncate pr-2">{p.item_name}</span><span className="font-mono text-xs shrink-0">{fmt(p.revenue)}</span></div>
                  <div className="h-1.5 rounded-full bg-board3 overflow-hidden"><div className="h-full rounded-full bg-haldi" style={{ width: `${(p.revenue / maxRevenue) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Budget tracking (Master Spec §6) — still real, still needed
          (Settings' own "Total Budget" field feeds this), just not the
          hero row Figma's mockup shows for this screen. */}
      {role === 'owner' && (
        <div className="mb-2">
          <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-2">{t('overview.budgetTracking')}</div>
          <div className="grid grid-cols-3 gap-3">
            <Link href="/dashboard/settings" className="card p-3"><div className="text-[10px] text-chalkdim mb-1">{t('overview.totalBudget')}</div><div className="font-mono font-700 text-sm">{fmt(budget)}</div></Link>
            <Link href={can('history') ? '/dashboard/history' : '/dashboard/settings'} className="card p-3"><div className="text-[10px] text-chalkdim mb-1">{t('overview.spent')}</div><div className="font-mono font-700 text-sm text-mirch">{fmt(spent)}</div></Link>
            <Link href="/dashboard/settings" className="card p-3"><div className="text-[10px] text-chalkdim mb-1">{t('overview.remaining')}</div><div className="font-mono font-700 text-sm text-dhania">{fmt(budget - spent)}</div></Link>
          </div>
        </div>
      )}
    </div>
  );
}

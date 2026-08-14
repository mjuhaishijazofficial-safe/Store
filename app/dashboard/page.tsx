import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n-server';
import { startOfMonthPKT, daysAgoPKT } from '@/lib/pkt-time';
import Link from 'next/link';
import { WalletIcon, TrendDownIcon, CashIcon, ChartIcon, TrendUpIcon, ReceiptIcon, FireIcon, WarningIcon, ArrowRightIcon, PlusIcon, CartIcon, ClockIcon } from '@/components/icons';
import AnimatedNumber from '@/components/AnimatedNumber';
import { hasSection } from '@/lib/permissions';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

// premium: the "hero" stat gets the brand gradient + glow instead of a
// flat tint circle — same formula real finance/luxury brands use (rich
// accent with gradient depth), applied to whichever brand color is
// currently active (haldi under Spice, navy under Navy), not a new
// color. delay staggers the entrance so the row rises in one-by-one
// instead of popping in as a block.
function StatCard({
  icon, iconClass, label, value, amount, valueClass = '', href, premium = false, delay = 0
}: { icon: React.ReactNode; iconClass: string; label: string; value: string; amount?: number; valueClass?: string; href?: string; premium?: boolean; delay?: number }) {
  const body = (
    <>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-3 ${premium ? 'gradient-brand shadow-glow text-board' : iconClass}`}>
        {icon}
      </div>
      <div className="text-[11px] text-chalkdim uppercase tracking-wide mb-1">{label}</div>
      <div className={`font-mono font-700 text-base sm:text-lg truncate ${valueClass}`}>
        {/* Counts up from 0 on every load when a raw amount is given —
            the actual "alive" moment on a numbers dashboard, not the
            one-time card fade-in which is easy to miss entirely. */}
        {amount !== undefined ? <AnimatedNumber value={amount} prefix="₨" /> : value}
      </div>
    </>
  );

  const cls = 'card p-4 animate-card-rise';
  const style = { animationDelay: `${delay}ms` };

  if (href) {
    return (
      <Link href={href} className={`${cls} block`} style={style}>
        {body}
      </Link>
    );
  }

  return <div className={cls} style={style}>{body}</div>;
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role, allowed_sections').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  const role = (profile?.role as 'owner' | 'manager' | 'cashier') || 'cashier';
  // Billing/POS is the spec's forced default landing for Cashier (§14) —
  // Overview is an owner-facing snapshot a cashier has no use for.
  if (role === 'cashier') redirect('/dashboard/billing');
  const allowedSections = (profile?.allowed_sections as string[] | null) ?? null;
  // Overview itself has no gate — everyone lands here — but its cards
  // and shortcuts shouldn't route a restricted staff member somewhere
  // they'll just get bounced right back out of.
  const can = (s: Parameters<typeof hasSection>[2]) => hasSection(role, allowedSections, s);

  const monthStartIso = startOfMonthPKT().toISOString();
  const weekStartIso = daysAgoPKT(7).toISOString();

  const [
    { data: shop },
    { data: items },
    { count: itemCount },
    { data: spentValue },
    { data: monthSalesValue },
    { data: monthReturnsValue },
    { data: weekSales },
    { data: weekReturns },
    { data: balances },
    { data: topSelling },
    { data: recentTxns },
    { data: recentPayments },
    { count: customerCount },
    { data: weekExpensesValue }
  ] = await Promise.all([
    supabase.from('shops').select('budget').eq('id', shopId).single(),
    supabase.from('items').select('id, stock, min_stock').eq('shop_id', shopId),
    supabase.from('items').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
    // spent is computed from the transactions log, not stored on shops —
    // same "never store a running balance" rule as khata/supplier ledgers.
    // A real RPC (transactions_sum), not a client-side
    // `.select('amount.sum()')` call — that PostgREST embedded-aggregate
    // syntax was silently returning nothing with no error checked on
    // the response, which is exactly why these two cards could sit at
    // ₨0 regardless of actual sales. See schema.sql for the fuller note.
    supabase.rpc('transactions_sum', { p_shop_id: shopId, p_type: 'purchase' }),
    supabase.rpc('transactions_sum', { p_shop_id: shopId, p_type: 'sale', p_since: monthStartIso }),
    // Nets a refunded sale back out of Monthly Sales — otherwise a
    // returned item stays counted as revenue forever.
    supabase.rpc('transactions_sum', { p_shop_id: shopId, p_type: 'return', p_since: monthStartIso }),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'sale').gte('created_at', weekStartIso),
    supabase.from('transactions').select('qty, amount, items(cost_price)').eq('shop_id', shopId).eq('type', 'return').gte('created_at', weekStartIso),
    supabase.rpc('khata_balances', { p_shop_id: shopId }),
    supabase.rpc('top_selling_items', { p_shop_id: shopId, p_days: 30, p_limit: 5 }),
    // Recent Activity feed below merges these two — stock moves and
    // khata collections are separate tables, so it's two small queries
    // instead of one, same tradeoff as the balance-aggregate RPCs above.
    supabase.from('transactions').select('id, item_name, type, qty, unit, amount, created_at').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(5),
    supabase.from('khata_entries').select('id, amount, created_at, customers(name)').eq('shop_id', shopId).eq('type', 'payment').order('created_at', { ascending: false }).limit(5),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
    supabase.rpc('expenses_sum', { p_shop_id: shopId, p_since: weekStartIso })
  ]);

  const lowStockItems = (items || []).filter((i: any) => i.stock <= i.min_stock);
  const budget = shop?.budget || 0;
  const spent = spentValue || 0;
  // A returned sale is refunded revenue — it stops counting as a sale
  // the moment it's returned, same reasoning as top_selling_items and
  // reorder_predictions netting returns out in schema.sql.
  const monthlySales = (monthSalesValue || 0) - (monthReturnsValue || 0);

  // Sales margin minus the week's overhead (rent/salary/utility/etc.)
  // — without expenses this card was gross margin labeled "profit,"
  // overstating the real number every week regardless of how much the
  // shop actually spent to stay open. A return reverses both the
  // revenue and the cost side of whatever sale it undoes, so it's
  // subtracted using the exact same (amount - qty*cost) formula, not
  // just netted off the revenue.
  const marginOf = (rows: any[]) => rows.reduce((s: number, r: any) => {
    const costPrice = r.items?.cost_price || 0;
    return s + (r.amount || 0) - (r.qty || 0) * costPrice;
  }, 0);
  const weekGrossMargin = marginOf(weekSales || []) - marginOf(weekReturns || []);
  const weeklyProfit = weekGrossMargin - (weekExpensesValue || 0);

  const pendingKhata = (balances || []).reduce((s: number, r: any) => s + Math.max(0, r.balance), 0);

  const activity = [
    ...(recentTxns || []).map((row: any) => ({
      id: row.id,
      kind: row.type as 'sale' | 'purchase' | 'return',
      label: row.item_name,
      sub: `${row.qty}${row.unit ? ' ' + row.unit : ''} · ${fmt(row.amount)}`,
      created_at: row.created_at
    })),
    ...(recentPayments || []).map((row: any) => ({
      id: row.id,
      kind: 'payment' as const,
      label: row.customers?.name || '—',
      sub: fmt(row.amount),
      created_at: row.created_at
    }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);

  // Setup checklist, shown only while a shop is genuinely still empty.
  // A brand-new account otherwise opens on a wall of ₨0 with no hint of
  // what to do first — the numbers are correct but useless as a start.
  const steps = [
    { done: budget > 0, label: t('onboard.setBudget'), href: '/dashboard/settings' },
    { done: (itemCount || 0) > 0, label: t('onboard.addItem'), href: '/dashboard/inventory' },
    { done: (customerCount || 0) > 0, label: t('onboard.addCustomer'), href: '/dashboard/khata' },
    { done: (recentTxns || []).length > 0, label: t('onboard.recordSale'), href: '/dashboard/inventory' }
  ];
  const stepsDone = steps.filter(s => s.done).length;
  const showOnboarding = stepsDone < steps.length;

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">{t('overview.title')}</h1>

      {showOnboarding && (
        <div className="card p-5 mb-8 border-haldi/40">
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
              <Link
                key={s.label}
                href={s.href}
                className={`flex items-center gap-2.5 text-sm py-1 ${s.done ? 'text-chalkdim' : ''}`}
              >
                <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] shrink-0 ${
                  s.done ? 'bg-dhania border-dhania text-board' : 'border-chalk/25'
                }`}>
                  {s.done ? '✓' : ''}
                </span>
                <span className={s.done ? 'line-through' : 'font-600'}>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard href={role === 'owner' ? '/dashboard/settings' : undefined} icon={<WalletIcon className="w-5 h-5" />} iconClass="bg-haldi/15 text-haldi" label={t('overview.totalBudget')} value={fmt(budget)} amount={budget} premium delay={0} />
        <StatCard href={can('history') ? '/dashboard/history' : undefined} icon={<TrendDownIcon className="w-5 h-5" />} iconClass="bg-mirch/15 text-mirch" label={t('overview.spent')} value={fmt(spent)} amount={spent} valueClass="text-mirch" delay={60} />
        <StatCard href={role === 'owner' ? '/dashboard/settings' : undefined} icon={<CashIcon className="w-5 h-5" />} iconClass="bg-dhania/15 text-dhania" label={t('overview.remaining')} value={fmt(budget - spent)} amount={budget - spent} valueClass="text-dhania" delay={120} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard href={can('reports') ? '/dashboard/reports' : undefined} icon={<ChartIcon className="w-5 h-5" />} iconClass="bg-haldi/15 text-haldi" label={t('overview.monthlySales')} value={fmt(monthlySales)} amount={monthlySales} premium delay={180} />
        <StatCard href={can('reports') ? '/dashboard/reports' : undefined} icon={<TrendUpIcon className="w-5 h-5" />} iconClass="bg-dhania/15 text-dhania" label={t('overview.weeklyProfit')} value={fmt(weeklyProfit)} amount={weeklyProfit} valueClass={weeklyProfit >= 0 ? 'text-dhania' : 'text-mirch'} delay={240} />
        <StatCard href={can('khata') ? '/dashboard/khata' : undefined} icon={<ReceiptIcon className="w-5 h-5" />} iconClass="bg-mirch/15 text-mirch" label={t('overview.pendingKhata')} value={fmt(pendingKhata)} amount={pendingKhata} valueClass="text-mirch" delay={300} />
      </div>

      {(can('inventory') || can('khata') || can('suppliers')) && (
        <div className="mb-8">
          <h2 className="font-display text-base font-700 mb-3">{t('overview.quickActions')}</h2>
          <div className="grid grid-cols-3 gap-3">
            {can('inventory') && (
              <Link href="/dashboard/inventory" className="card p-4 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full gradient-brand shadow-glow text-board flex items-center justify-center">
                  <PlusIcon className="w-5 h-5" />
                </div>
                <span className="text-xs font-600">{t('overview.addItem')}</span>
              </Link>
            )}
            {can('khata') && (
              <Link href="/dashboard/khata" className="card p-4 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-mirch/15 text-mirch flex items-center justify-center">
                  <ReceiptIcon className="w-5 h-5" />
                </div>
                <span className="text-xs font-600">{t('overview.khataEntry')}</span>
              </Link>
            )}
            {can('suppliers') && (
              <Link href="/dashboard/suppliers" className="card p-4 flex flex-col items-center text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-dhania/15 text-dhania flex items-center justify-center">
                  <CartIcon className="w-5 h-5" />
                </div>
                <span className="text-xs font-600">{t('overview.recordPurchase')}</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {(can('inventory') || can('reorder')) && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          {can('inventory') && (
            <Link href="/dashboard/inventory" className="card p-5 block">
              <div className="text-3xl font-mono font-700 text-haldi">{itemCount || 0}</div>
              <div className="text-sm text-chalkdim mt-1">{t('overview.totalItems')}</div>
            </Link>
          )}
          {can('reorder') && (
            <Link href="/dashboard/reorder" className="card p-5 block">
              <div className="text-3xl font-mono font-700 text-mirch">{lowStockItems.length}</div>
              <div className="text-sm text-chalkdim mt-1">{t('overview.itemsToReorder')}</div>
            </Link>
          )}
        </div>
      )}

      {can('inventory') && topSelling && topSelling.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <FireIcon className="w-4 h-4 text-haldi" />
            <h2 className="font-display text-base font-700">{t('overview.topSelling')}</h2>
          </div>
          <Link href="/dashboard/inventory" className="card divide-y divide-chalk/10 block">
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
          </Link>
        </div>
      )}

      {can('reorder') && lowStockItems.length > 0 && (
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

      {activity.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <ClockIcon className="w-4 h-4 text-haldi" />
            <h2 className="font-display text-base font-700">{t('overview.recentActivity')}</h2>
          </div>
          <div className="card divide-y divide-chalk/10">
            {activity.map(a => (
              <div key={a.id} className="p-3 px-4 flex justify-between items-center text-sm">
                <div>
                  <span className={a.kind === 'sale' ? 'text-dhania' : a.kind === 'purchase' ? 'text-chalkdim' : a.kind === 'return' ? 'text-haldi' : 'text-haldi'}>
                    {a.kind === 'sale' ? t('overview.sold') : a.kind === 'purchase' ? t('overview.purchased') : a.kind === 'return' ? t('overview.returned') : t('overview.paymentReceived')}
                  </span>{' '}
                  <span className="font-600">{a.label}</span>
                </div>
                <div className="font-mono text-xs text-chalkdim shrink-0 ml-3">{a.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {can('reports') && (
        <Link href="/dashboard/reports" className="card p-4 flex items-center gap-4 hover:border-haldi">
          <div className="w-11 h-11 rounded-full gradient-brand shadow-glow text-board flex items-center justify-center shrink-0">
            <ChartIcon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-display font-700 text-haldi">{t('overview.dailyReport')}</div>
            <div className="text-xs text-chalkdim">{t('overview.dailyReportSub')}</div>
          </div>
          <ArrowRightIcon className="w-5 h-5 text-haldi shrink-0" />
        </Link>
      )}
    </div>
  );
}

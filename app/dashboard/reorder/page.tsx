import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerT } from '@/lib/i18n-server';
import { hasSection } from '@/lib/permissions';

const SMART_THRESHOLD_DAYS = 7;
const EXPIRY_WARNING_DAYS = 30;
// Spec §29's own default safety margin for the suggested-order-quantity
// formula: (average daily sale × buffer days) − current stock.
const BUFFER_DAYS = 7;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReorderPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id, role, allowed_sections').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  if (profile && !hasSection(profile.role as 'owner' | 'manager' | 'cashier', profile.allowed_sections as string[] | null, 'reorder')) redirect('/dashboard');

  // System Settings feature flag (spec §27) — Super Admin can disable
  // this platform-wide (e.g. mid-rollout); direct-URL access is gated
  // here too, not just the nav link (see app/dashboard/layout.tsx).
  const { data: platformSettings } = await supabase.from('platform_settings').select('feature_flags').eq('id', true).single();
  if ((platformSettings?.feature_flags as any)?.smart_reorder === false) redirect('/dashboard');

  const [{ data: items }, { data: predictions }] = await Promise.all([
    supabase.from('items').select('*').eq('shop_id', shopId).order('name'),
    supabase.rpc('reorder_predictions', { p_shop_id: shopId, p_lookback_days: 30 })
  ]);

  const low = (items || []).filter((i: any) => i.stock <= i.min_stock);
  const lowIds = new Set(low.map((i: any) => i.id));

  // Smart Reorder: items trending toward stockout from actual sales
  // velocity, even though they haven't crossed min_stock yet. This is
  // computed from the shop's own transaction history (reorder_predictions
  // RPC) — not a vague "AI" claim, a straightforward rate projection,
  // which is more trustworthy than it sounds and cheap to compute.
  const smart = (predictions || [])
    .filter((p: any) => !lowIds.has(p.item_id) && p.days_remaining != null && p.days_remaining <= SMART_THRESHOLD_DAYS)
    .map((p: any) => ({
      ...p,
      // Spec §29: suggested qty = (avg daily sale × buffer days) − current
      // stock, floored at 0 — never suggest a negative order.
      suggestedQty: Math.max(0, Math.ceil(p.avg_daily_sale * BUFFER_DAYS - p.stock))
    }))
    .sort((a: any, b: any) => a.days_remaining - b.days_remaining);

  // Expiring Soon: a completely different kind of "needs attention" than
  // low stock — this is "sell it, discount it, or throw it out", not
  // "order more". expiry_date is optional (null for the majority of
  // kiryana goods that don't expire), so only items that actually set
  // one show up here at all.
  const todayMs = Date.now();
  const expiring = (items || [])
    .filter((i: any) => i.expiry_date)
    .map((i: any) => ({ ...i, daysLeft: Math.ceil((new Date(i.expiry_date).getTime() - todayMs) / 86400000) }))
    .filter((i: any) => i.daysLeft <= EXPIRY_WARNING_DAYS)
    .sort((a: any, b: any) => a.daysLeft - b.daysLeft);

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">{t('reorder.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{low.length} {t('reorder.subtitle')}</p>

      {low.length === 0 && smart.length === 0 && expiring.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-dhania text-base mb-1">{t('reorder.allGoodTitle')}</div>
          {t('reorder.allGoodBody')}
        </div>
      )}

      <div className="space-y-2">
        {low.map((it: any) => {
          const needed = Math.max(it.min_stock * 2 - it.stock, it.min_stock);
          const cost = needed * (it.price || 0);
          return (
            <div key={it.id} className="card p-4 border-mirch">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-700">{it.name}</div>
                  <div className="text-xs text-chalkdim">{t('reorder.abhi')}: {it.stock} {it.unit} • {t('reorder.alert')}: {it.min_stock}</div>
                </div>
                <div className="font-mono font-700 text-right text-mirch">
                  {needed} <span className="block text-[10px] font-normal text-chalkdim">{t('reorder.orderQty')}</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-chalkdim mt-2">
                <span>{t('reorder.estCost')}</span>
                <span>{fmt(cost)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {smart.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-700 mb-1 text-haldi">{t('reorder.smartTitle')}</h2>
          <p className="text-chalkdim text-xs mb-3">{t('reorder.smartSubtitle')}</p>
          <div className="space-y-2">
            {smart.map((p: any) => (
              <div key={p.item_id} className="card p-4 border-haldi/40">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-700">{p.item_name}</div>
                    <div className="text-xs text-chalkdim">
                      {p.stock} {p.unit} · {Number(p.avg_daily_sale).toFixed(1)}{t('reorder.dailyRate')}
                    </div>
                  </div>
                  <div className="font-mono font-700 text-right text-haldi">
                    {Math.max(0, Math.floor(p.days_remaining))}
                    <span className="block text-[10px] font-normal text-chalkdim">{t('reorder.daysLeft')}</span>
                  </div>
                </div>
                {/* Reason line (spec §29 UI requirement) — explains the
                    suggestion instead of showing a bare number. */}
                <div className="text-[11px] text-chalkdim mt-2">
                  {t('reorder.reasonLine')
                    .replace('{rate}', Number(p.avg_daily_sale).toFixed(1))
                    .replace('{unit}', p.unit || '')
                    .replace('{stock}', String(p.stock))}
                </div>
                {p.suggestedQty > 0 && (
                  <div className="flex justify-between items-center mt-3 pt-2 border-t border-chalk/10">
                    <div className="text-xs">
                      <span className="text-chalkdim">{t('reorder.suggestedQty')}: </span>
                      <span className="font-mono font-700">{p.suggestedQty} {p.unit}</span>
                    </div>
                    <Link
                      href={`/dashboard/purchase-orders?reorderItem=${p.item_id}&reorderQty=${p.suggestedQty}`}
                      className="text-xs text-haldi hover:underline shrink-0"
                    >
                      {t('reorder.sendToStockIn')}
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {expiring.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-700 mb-1 text-mirch">{t('reorder.expiringTitle')}</h2>
          <p className="text-chalkdim text-xs mb-3">{t('reorder.expiringSubtitle')}</p>
          <div className="space-y-2">
            {expiring.map((it: any) => {
              const expired = it.daysLeft < 0;
              return (
                <div key={it.id} className={`card p-4 ${expired ? 'border-mirch' : 'border-haldi/40'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-700">{it.name}</div>
                      <div className="text-xs text-chalkdim">{it.stock} {it.unit}</div>
                    </div>
                    <div className={`font-mono font-700 text-right ${expired ? 'text-mirch' : 'text-haldi'}`}>
                      {expired ? Math.abs(it.daysLeft) : it.daysLeft}
                      <span className="block text-[10px] font-normal text-chalkdim">
                        {expired ? t('reorder.daysAgo') : t('reorder.expiryDaysLeft')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

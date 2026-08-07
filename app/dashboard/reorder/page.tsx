import { createClient } from '@/lib/supabase/server';
import { getServerT } from '@/lib/i18n-server';

const SMART_THRESHOLD_DAYS = 7;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReorderPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const shopId = profile?.shop_id;

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
    .sort((a: any, b: any) => a.days_remaining - b.days_remaining);

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">{t('reorder.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{low.length} {t('reorder.subtitle')}</p>

      {low.length === 0 && smart.length === 0 && (
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

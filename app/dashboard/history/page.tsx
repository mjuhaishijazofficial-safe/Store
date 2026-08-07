import { createClient } from '@/lib/supabase/server';
import { getServerT } from '@/lib/i18n-server';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function HistoryPage() {
  const supabase = createClient();
  const t = getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const { data: logs } = await supabase
    .from('transactions')
    .select('*')
    .eq('shop_id', profile?.shop_id)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">{t('history.title')}</h1>

      {(!logs || logs.length === 0) && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('history.empty')}</div>
      )}

      <div className="space-y-2">
        {(logs || []).map((l: any) => {
          const d = new Date(l.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' • ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          const sign = l.type === 'purchase' ? '+' : '−';
          return (
            <div key={l.id} className="card p-3 px-4 flex justify-between items-center">
              <div>
                <div className="font-600 text-sm">{l.item_name} — {l.qty} {l.unit}</div>
                <div className="text-xs text-chalkdim mt-0.5">{l.type === 'purchase' ? t('history.purchaseIn') : t('history.saleOut')} • {when}</div>
              </div>
              <div className={`font-mono font-700 text-sm ${l.type === 'purchase' ? 'text-mirch' : 'text-dhania'}`}>
                {l.amount ? sign + fmt(l.amount) : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

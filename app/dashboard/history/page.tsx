'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';

type Log = {
  id: string;
  item_name: string;
  qty: number;
  unit: string | null;
  type: 'purchase' | 'sale';
  amount: number;
  created_at: string;
};

const PAGE_SIZE = 50;

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function HistoryPage() {
  const supabase = createClient();
  const { t } = useLang();
  const [logs, setLogs] = useState<Log[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
    await loadLogs(profile?.shop_id, true);
    setLoading(false);
  }

  async function loadLogs(shopId: string | null | undefined, reset: boolean) {
    if (!shopId) return;
    const offset = reset ? 0 : logs.length;
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const newRows = data || [];
    setLogs(reset ? newRows : prev => [...prev, ...newRows]);
    setHasMore(newRows.length === PAGE_SIZE);
  }

  async function loadMore() {
    setLoadingMore(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
    await loadLogs(profile?.shop_id, false);
    setLoadingMore(false);
  }

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">{t('history.title')}</h1>

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      {!loading && logs.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('history.empty')}</div>
      )}

      <div className="space-y-2">
        {logs.map(l => {
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

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full mt-3">
          {loadingMore ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  );
}

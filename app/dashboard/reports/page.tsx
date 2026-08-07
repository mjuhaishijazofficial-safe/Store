import { createClient } from '@/lib/supabase/server';
import { getServerT } from '@/lib/i18n-server';
import { startOfTodayPKT } from '@/lib/pkt-time';
import ShareWhatsAppButton from '@/components/ShareWhatsAppButton';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const t = await getServerT();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const shopId = profile?.shop_id;
  const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();

  const startIso = startOfTodayPKT().toISOString();

  const [{ data: txns }, { data: khataRows }] = await Promise.all([
    supabase.from('transactions').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso),
    supabase.from('khata_entries').select('type, amount').eq('shop_id', shopId).gte('created_at', startIso)
  ]);

  const totalSales = (txns || []).filter((r: any) => r.type === 'sale').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const stockPurchased = (txns || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const udhaarDiya = (khataRows || []).filter((r: any) => r.type === 'purchase').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const paymentMila = (khataRows || []).filter((r: any) => r.type === 'payment').reduce((s: number, r: any) => s + (r.amount || 0), 0);

  const shareText = t('reports.summaryMsg')
    .replace('{shop}', shop?.name || 'Dukaan')
    .replace('{sales}', totalSales.toLocaleString('en-IN'))
    .replace('{given}', udhaarDiya.toLocaleString('en-IN'))
    .replace('{received}', paymentMila.toLocaleString('en-IN'))
    .replace('{stock}', stockPurchased.toLocaleString('en-IN'));

  return (
    <div className="max-w-md">
      <h1 className="font-display text-xl font-700 mb-1">{t('reports.title')}</h1>
      <p className="text-chalkdim text-sm mb-5">{t('reports.subtitle')}</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase mb-1">{t('reports.totalSales')}</div>
          <div className="font-mono font-700 text-lg text-dhania">{fmt(totalSales)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase mb-1">{t('reports.stockPurchased')}</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(stockPurchased)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase mb-1">{t('reports.udhaarDiya')}</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(udhaarDiya)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-chalkdim uppercase mb-1">{t('reports.paymentMila')}</div>
          <div className="font-mono font-700 text-lg text-dhania">{fmt(paymentMila)}</div>
        </div>
      </div>

      <ShareWhatsAppButton text={shareText} label={t('reports.shareWhatsapp')} />
    </div>
  );
}

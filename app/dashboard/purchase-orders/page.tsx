'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n-context';
import { useShop } from '@/lib/shop-context';
import { useSectionGuard } from '@/lib/use-section-guard';
import NewPurchaseOrderModal from '@/components/NewPurchaseOrderModal';

type Po = {
  id: string;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  note: string | null;
  created_at: string;
  suppliers: { name: string } | null;
  purchase_order_items: { qty: number; cost_price: number }[];
};

const STATUS_COLORS: Record<Po['status'], string> = {
  draft: 'text-chalkdim border-chalk/20',
  sent: 'text-haldi border-haldi/40',
  received: 'text-dhania border-dhania/40',
  cancelled: 'text-mirch border-mirch/40'
};

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default function PurchaseOrdersPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = useLang();
  const { shopId } = useShop();
  useSectionGuard('suppliers');

  const [pos, setPos] = useState<Po[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<{ id: string; name: string; unit: string | null; cost_price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const statusLabels: Record<Po['status'], string> = {
    draft: t('po.statusDraft'),
    sent: t('po.statusSent'),
    received: t('po.statusReceived'),
    cancelled: t('po.statusCancelled')
  };

  useEffect(() => { loadAll(); }, [shopId]);

  async function loadAll() {
    setLoading(true);
    const [{ data: poRows }, { data: sups }, { data: itemRows }] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id, status, note, created_at, suppliers(name), purchase_order_items(qty, cost_price)')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name').eq('shop_id', shopId).order('name'),
      supabase.from('items').select('id, name, unit, cost_price').eq('shop_id', shopId).order('name')
    ]);
    setPos((poRows as any) || []);
    setSuppliers(sups || []);
    setItems(itemRows || []);
    setLoading(false);
  }

  function openNew() {
    if (suppliers.length === 0) return;
    setModalOpen(true);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <h1 className="font-display text-xl font-700">{t('po.title')}</h1>
      </div>
      <p className="text-chalkdim text-sm mb-5">{t('po.subtitle')}</p>

      {suppliers.length === 0 && !loading ? (
        <div className="card p-4 mb-5 text-sm text-chalkdim">
          {t('po.needSupplierFirst')} <Link href="/dashboard/suppliers" className="text-haldi underline">{t('nav.suppliers')}</Link>
        </div>
      ) : (
        <button onClick={openNew} className="btn-primary w-full mb-5">{t('po.newTitle')}</button>
      )}

      {loading && <div className="text-chalkdim text-sm text-center py-10">{t('common.loading')}</div>}

      {!loading && pos.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">{t('po.empty')}</div>
      )}

      <div className="space-y-2">
        {pos.map(po => {
          const total = po.purchase_order_items.reduce((s, l) => s + l.qty * l.cost_price, 0);
          const d = new Date(po.created_at);
          const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          return (
            <Link key={po.id} href={`/dashboard/purchase-orders/${po.id}`} className="card p-4 flex justify-between items-center">
              <div>
                <div className="font-700">{po.suppliers?.name || '—'}</div>
                <div className="text-xs text-chalkdim mt-0.5">{po.purchase_order_items.length} {t('po.items')} • {when}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-700">{fmt(total)}</div>
                <div className={`text-[10px] uppercase mt-0.5 inline-block border rounded px-1.5 py-0.5 ${STATUS_COLORS[po.status]}`}>{statusLabels[po.status]}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {modalOpen && (
        <NewPurchaseOrderModal
          suppliers={suppliers}
          items={items}
          onClose={() => setModalOpen(false)}
          onCreated={(poId) => { setModalOpen(false); router.push(`/dashboard/purchase-orders/${poId}`); }}
        />
      )}
    </div>
  );
}

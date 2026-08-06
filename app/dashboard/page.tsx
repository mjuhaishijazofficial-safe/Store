import { createClient } from '@/lib/supabase/server';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function OverviewPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const shopId = profile?.shop_id;

  const { data: shop } = await supabase.from('shops').select('budget, spent').eq('id', shopId).single();
  const { data: items } = await supabase.from('items').select('id, stock, min_stock').eq('shop_id', shopId);
  const { count: itemCount } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('shop_id', shopId);

  const lowStock = (items || []).filter((i: any) => i.stock <= i.min_stock).length;
  const budget = shop?.budget || 0;
  const spent = shop?.spent || 0;

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-5">Overview</h1>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="card p-4 text-center">
          <div className="text-xs text-chalkdim uppercase mb-1">Kul Budget</div>
          <div className="font-mono font-700 text-lg">{fmt(budget)}</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-xs text-chalkdim uppercase mb-1">Kharch Hua</div>
          <div className="font-mono font-700 text-lg text-mirch">{fmt(spent)}</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-xs text-chalkdim uppercase mb-1">Baki Budget</div>
          <div className="font-mono font-700 text-lg text-dhania">{fmt(budget - spent)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-5">
          <div className="text-3xl font-mono font-700 text-haldi">{itemCount || 0}</div>
          <div className="text-sm text-chalkdim mt-1">Total items in inventory</div>
        </div>
        <div className="card p-5">
          <div className="text-3xl font-mono font-700 text-mirch">{lowStock}</div>
          <div className="text-sm text-chalkdim mt-1">Items jo mangwane hain</div>
        </div>
      </div>
    </div>
  );
}

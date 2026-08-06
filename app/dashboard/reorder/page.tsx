import { createClient } from '@/lib/supabase/server';

function fmt(n: number) {
  return '₨' + Number(n || 0).toLocaleString('en-IN');
}

export default async function ReorderPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user!.id).single();
  const { data: items } = await supabase.from('items').select('*').eq('shop_id', profile?.shop_id).order('name');

  const low = (items || []).filter((i: any) => i.stock <= i.min_stock);

  return (
    <div>
      <h1 className="font-display text-xl font-700 mb-1">Mangwana Hai</h1>
      <p className="text-chalkdim text-sm mb-5">{low.length} item(s) jo kam ho gaye hain</p>

      {low.length === 0 && (
        <div className="text-center py-14 text-chalkdim text-sm">
          <div className="font-display text-dhania text-base mb-1">Sab theek hai</div>
          Filhaal koi saman kam nahi hai
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
                  <div className="text-xs text-chalkdim">Abhi: {it.stock} {it.unit} • Alert: {it.min_stock}</div>
                </div>
                <div className="font-mono font-700 text-right text-mirch">
                  {needed} <span className="block text-[10px] font-normal text-chalkdim">mangwayein</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-chalkdim mt-2">
                <span>Andaza lagat</span>
                <span>{fmt(cost)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

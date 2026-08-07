import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';

export async function POST() {
  // Constructed inside the handler, not at module scope: a module-level
  // requireEnv() call runs during `next build`'s page-data collection,
  // where secrets aren't set, and would fail the build itself rather
  // than only failing an actual request that needs them.
  const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'owners only' }, { status: 403 });
  const { data: shop } = await supabase.from('shops').select('*').eq('id', profile?.shop_id).single();
  if (!shop) return NextResponse.json({ error: 'shop not found' }, { status: 404 });

  let customerId = shop.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { shop_id: shop.id }
    });
    customerId = customer.id;
    await supabase.from('shops').update({ stripe_customer_id: customerId }).eq('id', shop.id);
  }

  const appUrl = requireEnv('NEXT_PUBLIC_APP_URL');
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: requireEnv('STRIPE_PRICE_ID'), quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?success=1`,
    cancel_url: `${appUrl}/dashboard/billing?canceled=1`,
    subscription_data: {
      metadata: { shop_id: shop.id }
    }
  });

  return NextResponse.json({ url: session.url });
}

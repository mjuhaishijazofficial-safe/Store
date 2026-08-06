import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=1`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?canceled=1`,
    subscription_data: {
      metadata: { shop_id: shop.id }
    }
  });

  return NextResponse.json({ url: session.url });
}

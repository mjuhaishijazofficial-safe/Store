import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single();
  const { data: shop } = await supabase.from('shops').select('stripe_customer_id').eq('id', profile?.shop_id).single();
  if (!shop?.stripe_customer_id) return NextResponse.json({ error: 'no customer' }, { status: 400 });

  const session = await stripe.billingPortal.sessions.create({
    customer: shop.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`
  });

  return NextResponse.json({ url: session.url });
}

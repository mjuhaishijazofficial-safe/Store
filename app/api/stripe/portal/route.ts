import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';

export async function POST() {
  const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('shop_id, role').eq('id', user.id).single();
  if (profile?.role !== 'owner') return NextResponse.json({ error: 'owners only' }, { status: 403 });
  const { data: shop } = await supabase.from('shops').select('stripe_customer_id').eq('id', profile?.shop_id).single();
  if (!shop?.stripe_customer_id) return NextResponse.json({ error: 'no customer' }, { status: 400 });

  const session = await stripe.billingPortal.sessions.create({
    customer: shop.stripe_customer_id,
    return_url: `${requireEnv('NEXT_PUBLIC_APP_URL')}/dashboard/billing`
  });

  return NextResponse.json({ url: session.url });
}

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook signature invalid: ${err.message}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const shopId = session.subscription_data?.metadata?.shop_id;
      if (session.subscription && shopId) {
        await supabase.from('shops').update({
          stripe_subscription_id: session.subscription as string,
          subscription_status: 'active',
          plan: 'monthly'
        }).eq('id', shopId);
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const shopId = sub.metadata?.shop_id;
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status;
      if (shopId) {
        await supabase.from('shops').update({
          subscription_status: status,
          stripe_subscription_id: sub.id
        }).eq('id', shopId);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const shopId = sub.metadata?.shop_id;
      if (shopId) {
        await supabase.from('shops').update({
          subscription_status: 'canceled',
          plan: 'canceled'
        }).eq('id', shopId);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      await supabase.from('shops').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', customerId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';
import { GRACE_PERIOD_DAYS } from '@/lib/constants';

export async function POST(req: Request) {
  const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');

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
      const customerId = session.customer as string | null;
      if (session.subscription && customerId) {
        const { error, count } = await supabase.from('shops').update({
          stripe_subscription_id: session.subscription as string,
          subscription_status: 'active',
          plan: 'monthly',
          grace_ends_at: null
        }, { count: 'exact' }).eq('stripe_customer_id', customerId);

        // No shop found for this Stripe customer, or the update itself
        // failed — this used to fail silently with nothing to grep for
        // in production when investigating "customer paid but shop still
        // shows locked" reports.
        if (error || count === 0) {
          console.error('[stripe webhook] checkout.session.completed: no shop matched', { customerId, error });
        }
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const shopId = sub.metadata?.shop_id;
      const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status;
      if (shopId) {
        const { error } = await supabase.from('shops').update({
          subscription_status: status,
          stripe_subscription_id: sub.id,
          // Stripe itself recovered the payment (auto-retry succeeded) —
          // clears the same grace timer invoice.payment_failed started.
          ...(status === 'active' ? { grace_ends_at: null } : {})
        }).eq('id', shopId);
        if (error) console.error('[stripe webhook] subscription update failed', { shopId, error });
      } else {
        console.error('[stripe webhook] subscription event with no shop_id in metadata', { subId: sub.id });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const shopId = sub.metadata?.shop_id;
      if (shopId) {
        const { error } = await supabase.from('shops').update({
          subscription_status: 'canceled',
          plan: 'canceled'
        }).eq('id', shopId);
        if (error) console.error('[stripe webhook] subscription cancel failed', { shopId, error });
      } else {
        console.error('[stripe webhook] subscription.deleted with no shop_id in metadata', { subId: sub.id });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      // Starts the grace period (spec §25-H) — the shop stays fully
      // functional with a warning banner until grace_ends_at, then
      // app/api/cron/check-grace-periods suspends it. Only set once:
      // a second failed retry inside an already-running grace period
      // shouldn't push the deadline back out.
      const { data: shop } = await supabase.from('shops').select('id, grace_ends_at').eq('stripe_customer_id', customerId).single();
      if (shop) {
        const { error } = await supabase.from('shops').update({
          subscription_status: 'past_due',
          grace_ends_at: shop.grace_ends_at || new Date(Date.now() + GRACE_PERIOD_DAYS * 86400000).toISOString()
        }).eq('id', shop.id);
        if (error) console.error('[stripe webhook] payment_failed update failed', { customerId, error });
      } else {
        console.error('[stripe webhook] payment_failed: no shop matched', { customerId });
      }
      break;
    }

    case 'invoice.paid': {
      // A recovered payment (manual retry or Stripe's own dunning)
      // clears the grace timer even before subscription.updated fires.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const { error } = await supabase.from('shops').update({ subscription_status: 'active', grace_ends_at: null }).eq('stripe_customer_id', customerId);
      if (error) console.error('[stripe webhook] invoice.paid update failed', { customerId, error });
      break;
    }
  }

  return NextResponse.json({ received: true });
}

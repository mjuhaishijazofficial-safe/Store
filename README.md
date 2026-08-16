# Dukaan ERP

Multi-tenant kiryana store ERP — inventory, budget, purchases/sales, aur monthly subscription billing.
Har shop owner apna alag account banata hai, apna alag data dekhta hai (Postgres Row-Level Security se enforce hota hai).

## Stack
- **Next.js 14** (App Router) — frontend + API routes
- **Supabase** — Postgres database, Auth, Row-Level Security
- **Stripe** — subscription billing
- **Vercel** — hosting

---

## 1. Supabase setup (10 min)

1. [supabase.com](https://supabase.com) par naya project banayein.
2. **SQL Editor** mein jayein, `supabase/schema.sql` ka pura content paste karein aur Run karein.
   - Ye `shops`, `profiles`, `items`, `transactions` tables banayega
   - RLS policies set karega (har shop sirf apna data dekh sakti hai)
   - Ek trigger banayega jo signup par automatically shop + profile create karta hai
3. **Authentication > Providers** mein Email confirmation ko off kar dein testing ke liye (baad mein on kar sakte hain production ke liye — Authentication > Email Templates se customize bhi ho sakta hai).
4. **Project Settings > API** se ye teen values copy karein:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (secret — sirf server par use hoti hai, webhook ke liye)

## 2. Stripe setup (10 min)

1. [stripe.com](https://stripe.com) par account banayein (test mode mein shuru karein).
2. **Product catalog** mein ek product banayein — "Dukaan ERP Monthly", recurring price ₨999/month (ya jo bhi aap rakhna chahein).
3. Us price ka ID (`price_...`) copy karein → `STRIPE_PRICE_ID`
4. **Developers > API keys** se `Secret key` copy karein → `STRIPE_SECRET_KEY`
5. Webhook abhi local mein test karne ke liye Stripe CLI use karein:
   ```
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Ye jo webhook secret print karega, wo `STRIPE_WEBHOOK_SECRET` mein daalein.
   
   **Production (Vercel) ke liye:** Stripe Dashboard > Developers > Webhooks > Add endpoint:
   `https://yourdomain.com/api/stripe/webhook`, events select karein:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

## 3. Local development

```bash
cp .env.example .env.local
# .env.local mein saari keys bharein
npm install
npm run dev
```

`http://localhost:3000` par app khul jayegi. `/signup` se test account banayein.

## 4. Deploy to Vercel

```bash
vercel
```

Ya GitHub repo ko Vercel se connect karein. Vercel dashboard mein **Environment Variables** section mein `.env.example` ki saari keys add karein (`NEXT_PUBLIC_APP_URL` ko apne production domain se replace karein).

Deploy hone ke baad, Stripe webhook endpoint ko production URL par update karein (step 2 dekhein).

## How multi-tenancy works

- Har naya user signup karta hai → Postgres trigger (`handle_new_user`) automatically ek `shops` row aur `profiles` row banata hai.
- Har table (`items`, `transactions`) mein `shop_id` column hai.
- **Row-Level Security policies** ensure karti hain ke koi bhi query sirf apni shop ka data return kare — chahe frontend code mein bug ho ya koi manually API call kare, database level par hi data leak nahi ho sakta.
- Naye shop owners add karne ke liye kuch alag se karne ki zaroorat nahi — wo bas `/signup` se apna account bana lete hain aur unki apni alag dukaan turant ready hoti hai.

## What's included

- Signup/login, per-shop data isolation, Staff accounts (roles/permissions), Multi-Branch
- Billing/POS, Inventory (+ AI Slip-Scan stock-in), Suppliers, Purchase Orders
- Khata (customer credit ledger) — reversal instead of delete, per-entry invoice numbers, print statement, WhatsApp reminder
- Stock Ledger Pattern — every stock-affecting action (sale/return/purchase/transfer/adjustment) writes to an append-only `stock_movements` ledger; History/Reports read from it
- **Eagle** — voice assistant (tap-to-talk or hands-free wake-word): Khata entries, inventory/expense/supplier commands, stock lookups, WhatsApp statements, all by voice (`lib/voice/`, `app/api/voice/*`, `app/dashboard/voice`) — needs `OPENAI_API_KEY` (speech + understanding) and optionally `GEMINI_API_KEY` (live web search for general questions)
- Reports, Admin panel (Super Admin: plans, settings, support tickets, payment claims), 14-day free trial + Stripe subscription (checkout, portal, webhook, grace period)

**Aap khud add kar sakte hain (ya mujhse keh sakte hain):**
- SMS reorder alerts (WhatsApp reminders already exist for Khata)
- Reports export (Excel/PDF)
- Multi-currency toggle

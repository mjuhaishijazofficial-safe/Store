-- ============================================================
-- Kiryana ERP — multi-tenant schema
-- Run this once in Supabase SQL editor (or `supabase db push`)
-- ============================================================

-- 1. SHOPS (tenants) ------------------------------------------------
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Meri Dukaan',
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'trial',                 -- trial | monthly | canceled
  subscription_status text not null default 'trialing', -- trialing | active | past_due | canceled | suspended
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  stripe_customer_id text,
  stripe_subscription_id text,
  budget numeric not null default 0,
  spent numeric not null default 0, -- DEPRECATED: no longer written to. Overview now computes
                                     -- spent from sum(transactions where type='purchase') so it
                                     -- can't drift or race. Column kept for now to avoid a
                                     -- destructive migration; safe to drop in a later cleanup.
  created_at timestamptz not null default now()
);
-- Custom receipt branding (Settings → Receipt Branding) — null means
-- "not set," every receipt-rendering component (print + Bluetooth
-- thermal) falls back to its existing default when either is null.
alter table shops add column if not exists receipt_phone text;
alter table shops add column if not exists receipt_footer text;
-- Master Spec §17/§33: a Cashier's own discount is capped by an
-- Owner-set percentage of the bill, 0 by default (no discount at all
-- until an Owner deliberately opens one up) — see app/dashboard/billing
-- for where this is enforced and Settings for where the Owner sets it.
alter table shops add column if not exists cashier_discount_cap_percent numeric not null default 0;
-- FBR Tax Compliance hook (spec §25-F) — "architecture-ready, MVP mein
-- optional": off by default for every shop, no effect anywhere unless
-- an Owner turns it on from Settings. Deliberately doesn't fabricate a
-- government-format invoice number — a real FBR invoice number is
-- assigned by FBR's own e-invoicing API in response to a submitted
-- sale, not something safe to generate locally and imply is real tax
-- compliance. This is the tax-breakdown-on-the-bill half only; actual
-- e-invoicing submission is a separate integration for whenever a shop
-- genuinely needs it.
alter table shops add column if not exists fbr_enabled boolean not null default false;
alter table shops add column if not exists fbr_ntn text;
alter table shops add column if not exists tax_rate_percent numeric not null default 0;
-- Master Spec §25-H: a failed Stripe payment starts a 3–5 day grace
-- period (status stays whatever Stripe reported, e.g. past_due) before
-- the shop actually gets suspended — see app/api/stripe/webhook (sets
-- this) and app/api/cron/check-grace-periods (the Vercel Cron job that
-- flips status to 'suspended' once this passes). Null = no grace period
-- currently running (never failed, or already resolved).
alter table shops add column if not exists grace_ends_at timestamptz;

-- 2. PROFILES (one row per auth user, links user -> shop) -----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'owner',    -- owner | staff
  created_at timestamptz not null default now()
);
alter table profiles add column if not exists email text;
alter table profiles add column if not exists monthly_salary numeric not null default 0;
-- null = unrestricted (every staff member today, and every new invite
-- going forward, until an owner deliberately narrows one down) — a
-- populated array is a whitelist of section keys (see lib/permissions.ts).
-- Owner-only sections (Staff/Billing/Settings/Admin) aren't in this list
-- at all; they're gated on role, not on this column, in every case.
alter table profiles add column if not exists allowed_sections text[];

-- 3. ITEMS (inventory) -----------------------------------------------
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  category text,
  unit text default 'unit',
  stock numeric not null default 0,
  min_stock numeric not null default 0,
  price numeric not null default 0,       -- selling price
  cost_price numeric not null default 0,  -- what the shop paid — used to compute profit
  barcode text,                           -- optional, for the barcode scanner
  created_at timestamptz not null default now()
);
alter table items add column if not exists cost_price numeric not null default 0;
alter table items add column if not exists barcode text;
alter table items add column if not exists expiry_date date; -- optional; null means "doesn't expire" (most kiryana goods)

-- 4. TRANSACTIONS (purchase / sale log) ------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  item_name text not null,
  type text not null check (type in ('purchase','sale')),
  qty numeric not null,
  unit text,
  amount numeric not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- 'return' = a cash sale return / credit note: a customer brings back
-- something bought outright (not on khata), stock comes back and the
-- refunded amount nets against sales everywhere sales are totaled
-- (Overview, Reports, top_selling_items, reorder_predictions) — see
-- record_stock_move below for how it moves stock the same direction
-- a purchase does.
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in ('purchase','sale','return'));
-- Groups the line items of one multi-item cart sale (see SaleCartModal)
-- into a single "bill" for display in History — null for every purchase
-- and for a single-item Stock Out, which aren't part of a cart at all.
-- No foreign key: it's a client-generated grouping tag, not a row this
-- table (or any other) needs to join back to.
alter table transactions add column if not exists sale_ref uuid;

-- 5. CUSTOMERS (khata / credit ledger) --------------------------------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  phone text,
  credit_limit numeric,                 -- optional, for credit-limit alerts
  created_at timestamptz not null default now()
);

-- 6. KHATA_ENTRIES (each purchase-on-credit / payment) -----------------
create table if not exists khata_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  type text not null check (type in ('purchase','payment')),
  item_id uuid references items(id),    -- optional link to inventory
  item_name text,                       -- e.g. "Coca Cola" (purchase entries)
  qty numeric,
  amount numeric not null,              -- purchase = udhaar chadha, payment = utra, return = utra
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- 'return' = a credit note: customer brings goods bought on credit back
-- (defective, wrong item), balance goes down the same direction a
-- payment would but no cash actually changed hands. Widens an existing
-- constraint, same pattern supplier_entries' 'return' type already used.
alter table khata_entries drop constraint if exists khata_entries_type_check;
alter table khata_entries add constraint khata_entries_type_check check (type in ('purchase','payment','return'));
-- Same reasoning as supplier_entries.payment_method — only meaningful
-- on type = 'payment' rows.
alter table khata_entries add column if not exists payment_method text not null default 'cash';
alter table khata_entries drop constraint if exists khata_entries_payment_method_check;
alter table khata_entries add constraint khata_entries_payment_method_check check (payment_method in ('cash','bank','easypaisa','jazzcash'));

-- 7. SUPPLIERS (reverse khata — what the shop owes suppliers) ----------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

-- 8. SUPPLIER_ENTRIES (each maal-liya / payment-di) ---------------------
create table if not exists supplier_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  type text not null check (type in ('purchase','payment','return')), -- purchase = maal liya (charhta hai), payment = maine di (utarta hai), return = maal wapas kiya (utarta hai, cash nahi)
  item_name text,
  qty numeric,
  amount numeric not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- Table pre-dates 'return' — widen the existing constraint for anyone
-- re-running this on a live database rather than a fresh one.
alter table supplier_entries drop constraint if exists supplier_entries_type_check;
alter table supplier_entries add constraint supplier_entries_type_check check (type in ('purchase','payment','return'));
-- Which channel a payment moved through — only meaningful on type =
-- 'payment' rows, ignored elsewhere. Existing rows default to 'cash'
-- rather than an unset value, since that's the safe assumption for
-- historical data and keeps bank_expected_change() below from having
-- to treat null specially. See bank_reconciliations for what this
-- feeds into.
alter table supplier_entries add column if not exists payment_method text not null default 'cash';
alter table supplier_entries drop constraint if exists supplier_entries_payment_method_check;
alter table supplier_entries add constraint supplier_entries_payment_method_check check (payment_method in ('cash','bank','easypaisa','jazzcash'));

-- 8b. PURCHASE_ORDERS — a document raised BEFORE goods arrive ("I'm
--     ordering these from supplier X"), separate from supplier_entries
--     (which only records what already happened: goods received / paid
--     for / returned). draft = still editable, sent = communicated to
--     the supplier and locked, partial = some lines received but not
--     all (see purchase_order_items.received_qty and receive_po_lines()
--     below), received = every line fully received, cancelled = never
--     fulfilled. Every status transition is one-way in the UI (no
--     un-cancelling, no un-receiving) — same "ledger, not undo" stance
--     as the rest of the app.
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','sent','received','cancelled')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  received_at timestamptz
);
-- Widened for partial receiving — a supplier shipment often arrives in
-- more than one delivery, and forcing "all or nothing" meant a shop
-- with 8 of 10 ordered sacks in hand couldn't record any of it until
-- the last two showed up.
alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check check (status in ('draft','sent','received','partial','cancelled'));

-- shop_id is denormalized here (not just derived via purchase_order_id ->
-- purchase_orders.shop_id) so its RLS policy can stay the same simple
-- `shop_id = my_shop_id()` shape every other table in this file uses,
-- instead of a subquery-based policy that's easy to get subtly wrong.
create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  item_name text not null,
  qty numeric not null,
  cost_price numeric not null default 0,
  created_at timestamptz not null default now()
);
-- How much of this line has actually arrived so far — always <= qty,
-- enforced in receive_po_lines() rather than a DB constraint (a
-- constraint referencing another column of the same row is fine, but
-- keeping the cap logic in one place — the function — is simpler than
-- keeping a CHECK in sync with it).
alter table purchase_order_items add column if not exists received_qty numeric not null default 0;

-- 9. EXPENSES (rent, staff salary, utilities, marketing — overhead that
--    isn't stock purchase. Without this, "profit" only ever subtracted
--    cost of goods sold, never the shop's actual running costs, which
--    overstates it every single day.) ------------------------------------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  category text not null check (category in ('rent','salary','utility','marketing','other')),
  amount numeric not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
-- Every expense is a payment by definition (unlike khata/supplier
-- entries where only the 'payment' type involves one) — same reasoning
-- as khata_entries.payment_method otherwise.
alter table expenses add column if not exists payment_method text not null default 'cash';
alter table expenses drop constraint if exists expenses_payment_method_check;
alter table expenses add constraint expenses_payment_method_check check (payment_method in ('cash','bank','easypaisa','jazzcash'));

-- 10. STAFF_ATTENDANCE (owner marks each staff member present/absent per
--     day; profiles.monthly_salary above is the figure this is tracked
--     against, deliberately not auto-computing prorated pay — half-day
--     rules, paid vs unpaid leave, etc. vary shop to shop, so this stays
--     "here's the attendance record," not a payroll engine.) -----------
create table if not exists staff_attendance (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  staff_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present','absent','half_day','leave')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(staff_id, date)
);

-- 10b. SALARY_ADJUSTMENTS (bonus / overtime pay / deduction, logged as
--      they happen — same ledger-style, created_at-based month grouping
--      as expenses, not tied to a separate "pay period" record). Stays
--      deliberately additive to profiles.monthly_salary rather than
--      folding attendance into an auto-computed net pay — see the
--      comment on staff_attendance above for why proration is out of
--      scope (paid vs unpaid leave, half-day rules, etc. vary shop to
--      shop); this is "here's this month's adjustments," the owner
--      still does the final arithmetic when they actually pay.
create table if not exists salary_adjustments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  staff_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('bonus','overtime','deduction')),
  amount numeric not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 11. PAYMENT_CLAIMS (manual EasyPaisa/bank transfer, no payment gateway
--    for Pakistan yet — owner marks "I've paid", we verify the WhatsApp
--    screenshot by hand and flip shops.subscription_status ourselves) ----
create table if not exists payment_claims (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  method text not null check (method in ('easypaisa','bank')),
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending','confirmed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 11b. ADMIN_ACTIONS — audit trail for manual SaaS-operator actions
--      (extend trial, override subscription status, suspend/reactivate)
--      taken from the admin panel. Deliberately no RLS policy at all —
--      unreachable via the anon/authenticated client roles, same as
--      every other admin-only write in this app; only the service-role
--      client (from routes gated by isAdmin()) ever touches it.
create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete set null,
  action text not null,       -- 'extend_trial' | 'set_status' | 'suspend' | 'reactivate'
  detail text,                -- human-readable summary, e.g. "+7 days" or "active -> suspended"
  performed_by text,          -- admin's email — not a shop role, so not a profiles/auth.users FK
  created_at timestamptz not null default now()
);
alter table admin_actions enable row level security;
create index if not exists idx_admin_actions_shop on admin_actions(shop_id, created_at desc);
create index if not exists idx_admin_actions_created on admin_actions(created_at desc);

-- 12. BANK_RECONCILIATIONS — periodically checking the shop's real bank/
--     mobile-wallet statement against what the app's own bank-tagged
--     entries (khata payments received, supplier payments made,
--     expenses paid — all where payment_method != 'cash') say the
--     balance should have moved by. This app deliberately never stores
--     a running balance anywhere (khata/supplier balances are always
--     computed from ledger sums) — a reconciliation snapshot is the one
--     place a balance figure gets stored, and only because it's the
--     owner's own external, independently-verifiable number (their
--     bank statement), not something this app could compute itself.
create table if not exists bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  opening_balance numeric not null,   -- carried from the previous reconciliation's actual_balance, 0 for the first ever
  expected_change numeric not null,   -- snapshotted at save time from bank_expected_change() — kept even though it's derivable, so a later ledger edit/delete can't quietly rewrite a past reconciliation's numbers
  actual_balance numeric not null,    -- what the owner's real statement showed at period_end
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Atomic write functions
--
-- Stock updates and their paired ledger inserts used to be two (or three)
-- separate client-side calls: read stock, compute new value, write it back,
-- insert a log row. That's a lost-update race under any concurrency (now a
-- real risk with multi-staff access) and not atomic — if the second call
-- fails, you get a ledger entry with no matching stock change and no error
-- surfaced anywhere. These run as SECURITY INVOKER so the caller's own RLS
-- grants still apply — this only buys atomicity, not extra privilege.
-- ============================================================

-- Inventory stock-in / stock-out, atomic with the transactions log row.
create or replace function record_stock_move(
  p_item_id uuid,
  p_type text,
  p_qty numeric,
  p_amount numeric default 0,
  p_sale_ref uuid default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid;
  v_item_name text;
  v_unit text;
begin
  if p_type not in ('purchase', 'sale', 'return') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive';
  end if;

  select shop_id, name, unit into v_shop_id, v_item_name, v_unit
  from items where id = p_item_id;

  if v_shop_id is null then
    raise exception 'item not found';
  end if;

  -- A return moves stock the same direction a purchase does — the goods
  -- physically come back to the shop.
  if p_type = 'purchase' or p_type = 'return' then
    update items set stock = stock + p_qty where id = p_item_id;
  else
    update items set stock = greatest(0, stock - p_qty) where id = p_item_id;
  end if;

  insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, sale_ref)
  values (v_shop_id, p_item_id, v_item_name, p_type, p_qty, v_unit, coalesce(p_amount, 0), auth.uid(), p_sale_ref);
end;
$$;

-- Khata purchase/payment entry, atomic with the inventory stock deduction
-- when the item was picked from inventory.
create or replace function record_khata_entry(
  p_customer_id uuid,
  p_type text,
  p_item_id uuid,
  p_item_name text,
  p_qty numeric,
  p_amount numeric,
  p_note text,
  p_payment_method text default 'cash'
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
begin
  -- 'return' = a credit note: goods bought on khata come back, balance
  -- goes down the same direction a payment would (no cash changes
  -- hands), and any linked item's stock comes back too — the reverse
  -- of what 'purchase' does to it below.
  if p_type not in ('purchase', 'payment', 'return') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into khata_entries (shop_id, customer_id, type, item_id, item_name, qty, amount, note, created_by, payment_method)
  values (v_shop_id, p_customer_id, p_type, p_item_id, p_item_name, p_qty, p_amount, p_note, auth.uid(), coalesce(p_payment_method, 'cash'));

  if p_type = 'purchase' and p_item_id is not null then
    update items set stock = greatest(0, stock - coalesce(p_qty, 0)) where id = p_item_id;
  elsif p_type = 'return' and p_item_id is not null then
    update items set stock = stock + coalesce(p_qty, 0) where id = p_item_id;
  end if;
end;
$$;

-- Deleting a khata entry restores any inventory stock it had deducted —
-- previously a plain DELETE left items.stock permanently wrong.
create or replace function delete_khata_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_type text;
  v_item_id uuid;
  v_qty numeric;
begin
  select type, item_id, qty into v_type, v_item_id, v_qty
  from khata_entries where id = p_entry_id;

  delete from khata_entries where id = p_entry_id;

  if v_type = 'purchase' and v_item_id is not null then
    update items set stock = stock + coalesce(v_qty, 0) where id = v_item_id;
  elsif v_type = 'return' and v_item_id is not null then
    update items set stock = greatest(0, stock - coalesce(v_qty, 0)) where id = v_item_id;
  end if;
end;
$$;

-- (supplier_entries has no inventory link, so a plain insert/delete is
-- already atomic — no RPC wrapper needed there.)

-- Per-customer / per-supplier balances, aggregated in Postgres instead of
-- shipping every raw ledger row to the browser to sum in JS. This is what
-- makes the customer/supplier LIST pages scale to an unlimited number of
-- customers and entries — cost stays a single grouped query server-side
-- instead of growing with total entries ever recorded. RLS still applies
-- (security invoker), so a shop can only ever see its own aggregates
-- regardless of what shop_id is passed in.
create or replace function khata_balances(p_shop_id uuid)
returns table(customer_id uuid, balance numeric)
language sql
security invoker
stable
as $$
  select customer_id, sum(case when type = 'purchase' then amount else -amount end) as balance
  from khata_entries
  where shop_id = p_shop_id
  group by customer_id
$$;

-- Per-contact totals for the Khata/Supplier detail pages — replaces the
-- client-side `.select('amount.sum()')` PostgREST embedded-aggregate
-- calls those pages used to make directly. That syntax depends on a
-- project-level PostgREST setting (aggregate functions in select) that
-- isn't reliably on, and worse, the calling code never checked for an
-- `error` on the response — a failed query silently became `?.sum || 0`,
-- so Total Given/Total Paid (and the balance derived from them) just
-- read as ₨0 with no visible sign anything had gone wrong. A real SQL
-- function sidesteps the PostgREST feature entirely, same as
-- khata_balances below already does for the list page.
-- Signature grew a column (returned) — create or replace can't change an
-- existing function's return type, has to be dropped first.
drop function if exists khata_customer_totals(uuid);
create function khata_customer_totals(p_customer_id uuid)
returns table(given numeric, paid numeric, returned numeric)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(amount) filter (where type = 'purchase'), 0) as given,
    coalesce(sum(amount) filter (where type = 'payment'), 0) as paid,
    coalesce(sum(amount) filter (where type = 'return'), 0) as returned
  from khata_entries
  where customer_id = p_customer_id
$$;

-- Signature grew a column (returned) — create or replace can't change an
-- existing function's return type, has to be dropped first.
drop function if exists supplier_contact_totals(uuid);
create function supplier_contact_totals(p_supplier_id uuid)
returns table(given numeric, paid numeric, returned numeric)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(amount) filter (where type = 'purchase'), 0) as given,
    coalesce(sum(amount) filter (where type = 'payment'), 0) as paid,
    coalesce(sum(amount) filter (where type = 'return'), 0) as returned
  from supplier_entries
  where supplier_id = p_supplier_id
$$;

-- Same reasoning, for the Overview dashboard's Spent / Monthly Sales
-- cards (app/dashboard/page.tsx), which made the identical kind of
-- fragile call against `transactions`.
create or replace function transactions_sum(p_shop_id uuid, p_type text, p_since timestamptz default null)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(amount), 0)
  from transactions
  where shop_id = p_shop_id
    and type = p_type
    and (p_since is null or created_at >= p_since)
$$;

create or replace function expenses_sum(p_shop_id uuid, p_since timestamptz default null)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(amount), 0)
  from expenses
  where shop_id = p_shop_id
    and (p_since is null or created_at >= p_since)
$$;

-- How much the shop's bank/mobile-wallet balance should have moved
-- over a period, from the app's own records — bank-tagged khata
-- payments received, minus bank-tagged supplier payments and expenses
-- paid. Cash-tagged rows are excluded entirely: they never touched a
-- bank account, so they have nothing to say about whether the bank
-- statement matches. See bank_reconciliations for how this gets used.
create or replace function bank_expected_change(p_shop_id uuid, p_since timestamptz, p_until timestamptz)
returns numeric
language sql
security invoker
stable
as $$
  select
    coalesce((
      select sum(amount) from khata_entries
      where shop_id = p_shop_id and type = 'payment' and payment_method != 'cash'
        and created_at >= p_since and created_at < p_until
    ), 0)
    - coalesce((
      select sum(amount) from supplier_entries
      where shop_id = p_shop_id and type = 'payment' and payment_method != 'cash'
        and created_at >= p_since and created_at < p_until
    ), 0)
    - coalesce((
      select sum(amount) from expenses
      where shop_id = p_shop_id and payment_method != 'cash'
        and created_at >= p_since and created_at < p_until
    ), 0)
$$;

create or replace function supplier_balances(p_shop_id uuid)
returns table(supplier_id uuid, balance numeric)
language sql
security invoker
stable
as $$
  select supplier_id, sum(case when type = 'purchase' then amount else -amount end) as balance
  from supplier_entries
  where shop_id = p_shop_id
  group by supplier_id
$$;

-- Creates a draft PO and all its line items in one transaction — a plain
-- two-step client call (insert po, then insert items) could leave a
-- PO with zero items if the second call failed partway through.
-- p_items is a jsonb array of {item_id, item_name, qty, cost_price}.
create or replace function create_purchase_order(p_supplier_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_po_id uuid;
  v_line jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  insert into purchase_orders (shop_id, supplier_id, note, created_by)
  values (v_shop_id, p_supplier_id, p_note, auth.uid())
  returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_items) loop
    insert into purchase_order_items (shop_id, purchase_order_id, item_id, item_name, qty, cost_price)
    values (
      v_shop_id,
      v_po_id,
      nullif(v_line->>'item_id', '')::uuid,
      v_line->>'item_name',
      (v_line->>'qty')::numeric,
      coalesce((v_line->>'cost_price')::numeric, 0)
    );
  end loop;

  return v_po_id;
end;
$$;

-- Receiving stock against a PO is the moment it actually affects the
-- shop: every line with a linked item_id restocks inventory (logged the
-- same way a manual Stock In is, so History/Reports don't need to know
-- POs exist), and one supplier_entries 'purchase' row records this
-- delivery's total against what the shop owes that supplier.
--
-- p_receipts is a jsonb array of {line_id, qty} — how much of each line
-- arrived THIS delivery. Passing null (the old mark_po_received's whole
-- behavior) means "receive everything still outstanding on every line
-- in one shot" — a real shipment often arrives in more than one
-- delivery, so a shop with 8 of 10 ordered sacks in hand can record
-- exactly that instead of waiting for the last two to show up before
-- anything can be logged at all. Whatever's requested is capped at each
-- line's own remaining quantity, so this can never over-receive past
-- what was ordered even if the input tries to.
create or replace function receive_po_lines(p_po_id uuid, p_receipts jsonb default null)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_supplier_id uuid;
  v_status text;
  v_po_note text;
  v_reason text;
  v_total numeric := 0;
  v_line record;
  v_qty_now numeric;
  v_all_done boolean := true;
begin
  select supplier_id, status, note into v_supplier_id, v_status, v_po_note
  from purchase_orders where id = p_po_id and shop_id = v_shop_id;

  if v_supplier_id is null then
    raise exception 'purchase order not found';
  end if;
  if v_status not in ('draft', 'sent', 'partial') then
    raise exception 'this purchase order cannot receive any more stock';
  end if;

  -- AI Slip-Scan's own PO is tagged with this exact note (see
  -- SlipScanModal) — the only signal available to tell a slip-scanned
  -- delivery apart from a manually-built PO for the ledger's reason.
  v_reason := case when v_po_note = 'AI Slip-Scan' then 'slip_scan' else 'purchase' end;

  for v_line in select * from purchase_order_items where purchase_order_id = p_po_id loop
    v_qty_now := greatest(0, v_line.qty - v_line.received_qty);

    if p_receipts is not null then
      select coalesce((r->>'qty')::numeric, 0) into v_qty_now
      from jsonb_array_elements(p_receipts) r
      where (r->>'line_id')::uuid = v_line.id;
      v_qty_now := least(coalesce(v_qty_now, 0), greatest(0, v_line.qty - v_line.received_qty));
    end if;

    if v_qty_now > 0 then
      v_total := v_total + (v_qty_now * v_line.cost_price);

      if v_line.item_id is not null then
        insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by)
        select v_shop_id, v_line.item_id, v_line.item_name, 'purchase', v_qty_now, unit, v_qty_now * v_line.cost_price, auth.uid()
        from items where id = v_line.item_id;
        perform record_stock_movement(v_line.item_id, null, v_qty_now, v_reason, 'purchase_order', p_po_id, null);
      end if;

      update purchase_order_items set received_qty = received_qty + v_qty_now where id = v_line.id;
    end if;

    if v_line.received_qty + v_qty_now < v_line.qty then
      v_all_done := false;
    end if;
  end loop;

  if v_total > 0 then
    insert into supplier_entries (shop_id, supplier_id, type, item_name, amount, note, created_by)
    values (v_shop_id, v_supplier_id, 'purchase', 'Purchase Order', v_total, 'PO #' || left(p_po_id::text, 8), auth.uid());
  end if;

  update purchase_orders
  set status = case when v_all_done then 'received' else 'partial' end,
      received_at = case when v_all_done then now() else received_at end
  where id = p_po_id;
end;
$$;

-- Superseded by receive_po_lines() above, which subsumes its exact
-- behavior via p_receipts = null.
drop function if exists mark_po_received(uuid);

-- ============================================================
-- Helper: current user's shop_id
-- ============================================================
create or replace function my_shop_id()
returns uuid
language sql
security definer
stable
as $$
  select shop_id from profiles where id = auth.uid()
$$;

create or replace function my_role()
returns text
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid()
$$;

-- ============================================================
-- Row Level Security — this is what makes it multi-tenant safe
-- ============================================================
alter table shops enable row level security;
alter table profiles enable row level security;
alter table items enable row level security;
alter table transactions enable row level security;
alter table customers enable row level security;
alter table khata_entries enable row level security;
alter table suppliers enable row level security;
alter table supplier_entries enable row level security;
alter table payment_claims enable row level security;
alter table expenses enable row level security;
alter table staff_attendance enable row level security;

-- shops: a user can only see/update their own shop
-- Postgres has no "create policy if not exists" — drop-then-create is the
-- standard idempotent pattern, needed so this whole script can be safely
-- re-run (which it has been, repeatedly, as features got added).
drop policy if exists "shop_select_own" on shops;
create policy "shop_select_own" on shops for select using (id = my_shop_id());
-- only the owner can change shop settings/budget/billing — staff can read, not write
drop policy if exists "shop_update_own" on shops;
create policy "shop_update_own" on shops for update
  using (id = my_shop_id() and my_role() = 'owner');

-- profiles: user can see profiles within their shop
drop policy if exists "profile_select_same_shop" on profiles;
create policy "profile_select_same_shop" on profiles for select using (shop_id = my_shop_id());
drop policy if exists "profile_insert_self" on profiles;
create policy "profile_insert_self" on profiles for insert with check (id = auth.uid());
-- no update/delete policy on profiles — role changes only happen via the
-- security-definer signup trigger, never directly by a user (staff can't self-promote)

-- items: fully scoped to shop_id
drop policy if exists "items_all_own_shop" on items;
create policy "items_all_own_shop" on items for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- transactions: fully scoped to shop_id
drop policy if exists "transactions_all_own_shop" on transactions;
create policy "transactions_all_own_shop" on transactions for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- customers / khata_entries: fully scoped to shop_id
drop policy if exists "customers_own_shop" on customers;
create policy "customers_own_shop" on customers for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());
drop policy if exists "khata_own_shop" on khata_entries;
create policy "khata_own_shop" on khata_entries for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- suppliers / supplier_entries: fully scoped to shop_id
drop policy if exists "suppliers_own_shop" on suppliers;
create policy "suppliers_own_shop" on suppliers for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());
-- payment_claims: billing is owner-only, same as shop_update_own above
drop policy if exists "payment_claims_own_shop" on payment_claims;
create policy "payment_claims_own_shop" on payment_claims for all
  using (shop_id = my_shop_id() and my_role() = 'owner')
  with check (shop_id = my_shop_id() and my_role() = 'owner');

-- bank_reconciliations: owner-only, same reasoning as payment_claims —
-- this is the shop's real bank statement figures, not shop-floor data.
alter table bank_reconciliations enable row level security;
drop policy if exists "bank_reconciliations_own_shop" on bank_reconciliations;
create policy "bank_reconciliations_own_shop" on bank_reconciliations for all
  using (shop_id = my_shop_id() and my_role() = 'owner')
  with check (shop_id = my_shop_id() and my_role() = 'owner');

drop policy if exists "supplier_entries_own_shop" on supplier_entries;
create policy "supplier_entries_own_shop" on supplier_entries for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

alter table purchase_orders enable row level security;
drop policy if exists "purchase_orders_own_shop" on purchase_orders;
create policy "purchase_orders_own_shop" on purchase_orders for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

alter table purchase_order_items enable row level security;
drop policy if exists "purchase_order_items_own_shop" on purchase_order_items;
create policy "purchase_order_items_own_shop" on purchase_order_items for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- expenses: fully scoped to shop_id, same openness as customers/suppliers
-- (staff can log a utility bill payment same as they'd log a khata entry)
drop policy if exists "expenses_own_shop" on expenses;
create policy "expenses_own_shop" on expenses for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- staff_attendance: everyone in the shop can see it (a staff member
-- checking their own record), only the owner can mark/change it —
-- same owner-only write pattern as shop_update_own.
drop policy if exists "staff_attendance_select_own_shop" on staff_attendance;
create policy "staff_attendance_select_own_shop" on staff_attendance for select
  using (shop_id = my_shop_id());
drop policy if exists "staff_attendance_write_owner" on staff_attendance;
create policy "staff_attendance_write_owner" on staff_attendance for all
  using (shop_id = my_shop_id() and my_role() = 'owner')
  with check (shop_id = my_shop_id() and my_role() = 'owner');

-- salary_adjustments: same shape as staff_attendance — a staff member
-- can see their own bonus/deduction history, only the owner records one.
alter table salary_adjustments enable row level security;
drop policy if exists "salary_adjustments_select_own_shop" on salary_adjustments;
create policy "salary_adjustments_select_own_shop" on salary_adjustments for select
  using (shop_id = my_shop_id());
drop policy if exists "salary_adjustments_write_owner" on salary_adjustments;
create policy "salary_adjustments_write_owner" on salary_adjustments for all
  using (shop_id = my_shop_id() and my_role() = 'owner')
  with check (shop_id = my_shop_id() and my_role() = 'owner');

-- ============================================================
-- Signup trigger: creates a shop + profile automatically
-- when a new auth user signs up
-- ============================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_shop_id uuid;
  invited_shop_id uuid;
begin
  -- staff invites (see /api/staff/invite) tag the new user with invited_shop_id
  -- in APP metadata, never user metadata — raw_user_meta_data is writable by
  -- anyone via the public signUp() call, so trusting it here would let an
  -- attacker self-join any shop as staff just by knowing its UUID.
  -- raw_app_meta_data can only be set server-side with the service-role key.
  invited_shop_id := nullif(new.raw_app_meta_data->>'invited_shop_id', '')::uuid;

  if invited_shop_id is not null then
    insert into profiles (id, shop_id, full_name, email, role)
    values (new.id, invited_shop_id, new.raw_user_meta_data->>'full_name', new.email, 'staff');
  else
    insert into shops (name, owner_id)
    values (coalesce(new.raw_user_meta_data->>'shop_name', 'Meri Dukaan'), new.id)
    returning id into new_shop_id;

    insert into profiles (id, shop_id, full_name, email, role)
    values (new.id, new_shop_id, new.raw_user_meta_data->>'full_name', new.email, 'owner');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_items_shop on items(shop_id);
create index if not exists idx_transactions_shop on transactions(shop_id);
create index if not exists idx_transactions_created on transactions(shop_id, created_at desc);
create index if not exists idx_profiles_shop on profiles(shop_id);
create index if not exists idx_customers_shop on customers(shop_id);
create index if not exists idx_khata_customer on khata_entries(customer_id, created_at desc);
create index if not exists idx_khata_shop on khata_entries(shop_id);
create index if not exists idx_suppliers_shop on suppliers(shop_id);
create index if not exists idx_supplier_entries_supplier on supplier_entries(supplier_id, created_at desc);
create index if not exists idx_supplier_entries_shop on supplier_entries(shop_id);
create index if not exists idx_purchase_orders_shop on purchase_orders(shop_id, created_at desc);
create index if not exists idx_purchase_orders_supplier on purchase_orders(supplier_id, created_at desc);
create index if not exists idx_po_items_po on purchase_order_items(purchase_order_id);
create index if not exists idx_salary_adjustments_staff on salary_adjustments(staff_id, created_at desc);
create index if not exists idx_bank_reconciliations_shop on bank_reconciliations(shop_id, period_end desc);
create unique index if not exists idx_items_shop_barcode on items(shop_id, barcode) where barcode is not null;

-- ============================================================
-- Smart Reorder: predicts days-until-stockout per item from actual
-- recent sales velocity, instead of only flagging items already below
-- min_stock. avg_daily_sale = total sold in the lookback window / days
-- in that window; days_remaining = current stock / that rate. Items
-- with no recent sales get days_remaining = null (nothing to predict
-- from) rather than a misleading number.
-- ============================================================
create or replace function reorder_predictions(p_shop_id uuid, p_lookback_days int default 30)
returns table(
  item_id uuid,
  item_name text,
  unit text,
  stock numeric,
  min_stock numeric,
  avg_daily_sale numeric,
  days_remaining numeric
)
language sql
security invoker
stable
as $$
  select
    i.id,
    i.name,
    i.unit,
    i.stock,
    i.min_stock,
    coalesce(sold.total_qty, 0) / p_lookback_days::numeric,
    case when coalesce(sold.total_qty, 0) > 0
      then i.stock / (sold.total_qty / p_lookback_days::numeric)
      else null
    end
  from items i
  left join (
    -- Nets returns out of the sell-through rate, same reasoning as
    -- top_selling_items — a returned item isn't actually depleting stock.
    select item_id, sum(case when type = 'sale' then qty else -qty end) as total_qty
    from transactions
    where shop_id = p_shop_id
      and type in ('sale', 'return')
      and created_at >= now() - (p_lookback_days || ' days')::interval
    group by item_id
  ) sold on sold.item_id = i.id
  where i.shop_id = p_shop_id
$$;

-- Customer Analytics: top customers by lifetime purchase volume (not
-- balance owed — a customer who buys a lot and pays on time should
-- still show up as a top customer).
create or replace function khata_top_customers(p_shop_id uuid, p_limit int default 5)
returns table(customer_id uuid, customer_name text, total_purchases numeric)
language sql
security invoker
stable
as $$
  select c.id, c.name, sum(k.amount)
  from customers c
  join khata_entries k on k.customer_id = c.id and k.type = 'purchase'
  where c.shop_id = p_shop_id
  group by c.id, c.name
  order by sum(k.amount) desc
  limit p_limit
$$;

-- Dashboard "Top Selling Products": items ranked by quantity sold in the
-- lookback window. Same aggregate-in-Postgres reasoning as everything
-- else here — cost stays a single grouped query, not proportional to
-- how much sales history the shop has.
-- Nets 'return' rows against 'sale' rows (both move stock the same
-- direction, in opposite senses to a sale) — otherwise a heavily
-- returned item would still rank as a top seller on its gross qty.
create or replace function top_selling_items(p_shop_id uuid, p_days int default 30, p_limit int default 5)
returns table(item_id uuid, item_name text, unit text, qty_sold numeric, revenue numeric)
language sql
security invoker
stable
as $$
  select
    i.id, i.name, i.unit,
    sum(case when t.type = 'sale' then t.qty else -t.qty end) as qty_sold,
    sum(case when t.type = 'sale' then t.amount else -t.amount end) as revenue
  from transactions t
  join items i on i.id = t.item_id
  where t.shop_id = p_shop_id
    and t.type in ('sale', 'return')
    and t.created_at >= now() - (p_days || ' days')::interval
  group by i.id, i.name, i.unit
  having sum(case when t.type = 'sale' then t.qty else -t.qty end) > 0
  order by sum(case when t.type = 'sale' then t.qty else -t.qty end) desc
  limit p_limit
$$;

-- ============================================================
-- 13. ROLE RENAME (staff → cashier)
--
-- Master Handoff Spec §2/§17: 'staff' is renamed to 'cashier' to match
-- the spec's naming and P0 permission matrix. Deliberately staying a
-- 2-role model (owner/cashier) for now — Manager + multi-branch is
-- spec §30's own P2 item, not part of this pass; nothing here (branch
-- tables, branch_id columns) is added, so this is a pure rename plus a
-- CHECK constraint the role column never actually had before.
-- ============================================================

update profiles set role = 'cashier' where role = 'staff';
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'cashier'));

-- ============================================================
-- 14. KHATA SALES VISIBILITY (Master Handoff Spec §11 Reports, §14
--     History, §25-B Returns, §29 Smart Reorder)
--
-- record_khata_entry never wrote to `transactions` — a Khata-mode sale
-- (Billing §15's 4th payment tab) only ever showed up in that one
-- customer's own ledger, invisible to History, Reports' Total Sales,
-- Dashboard's Top Selling, and reorder_predictions' sell-through rate.
-- Those all read `transactions` only. This makes a linked-item Khata
-- purchase/return also log a plain transactions row (no stock effect —
-- record_khata_entry already moved stock above; this is reporting-only,
-- same "log without re-triggering the atomic RPC" pattern
-- receive_po_lines already uses for its own transactions insert).
-- customer_id on transactions marks which rows came from Khata, so
-- History's Return action (below) can reverse the debt, not just the
-- stock, when it undoes one of these.
-- ============================================================

alter table transactions add column if not exists customer_id uuid references customers(id) on delete set null;
alter table transactions add column if not exists note text;

create or replace function record_khata_entry(
  p_customer_id uuid,
  p_type text,
  p_item_id uuid,
  p_item_name text,
  p_qty numeric,
  p_amount numeric,
  p_note text,
  p_payment_method text default 'cash'
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_unit text;
  v_txn_id uuid;
begin
  if p_type not in ('purchase', 'payment', 'return') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into khata_entries (shop_id, customer_id, type, item_id, item_name, qty, amount, note, created_by, payment_method)
  values (v_shop_id, p_customer_id, p_type, p_item_id, p_item_name, p_qty, p_amount, p_note, auth.uid(), coalesce(p_payment_method, 'cash'));

  -- Stock Ledger (spec: Stock Ledger Pattern) — record_stock_movement
  -- below is now the only place items.stock is ever written; this just
  -- logs the transactions row for reporting the same as before and
  -- hands its id to the ledger as reference_id, so a stock_movements
  -- row can be traced straight back to the sale/return that caused it.
  if p_type = 'purchase' and p_item_id is not null then
    select unit into v_unit from items where id = p_item_id;
    insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, customer_id, note)
    values (v_shop_id, p_item_id, p_item_name, 'sale', coalesce(p_qty, 0), v_unit, p_amount, auth.uid(), p_customer_id, p_note)
    returning id into v_txn_id;
    perform record_stock_movement(p_item_id, null, -coalesce(p_qty, 0), 'sale', 'transaction', v_txn_id, p_note);
  elsif p_type = 'return' and p_item_id is not null then
    select unit into v_unit from items where id = p_item_id;
    insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, customer_id, note)
    values (v_shop_id, p_item_id, p_item_name, 'return', coalesce(p_qty, 0), v_unit, p_amount, auth.uid(), p_customer_id, p_note)
    returning id into v_txn_id;
    perform record_stock_movement(p_item_id, null, coalesce(p_qty, 0), 'return', 'transaction', v_txn_id, p_note);
  end if;
end;
$$;

-- record_stock_move grows an optional reason/note (spec §25-B: Returns
-- get an optional Reason field) — a new trailing parameter, which
-- `create or replace function` does NOT treat as the same function: a
-- different parameter list creates a second overload alongside the
-- original 5-arg one instead of replacing it, and every existing call
-- site (which never passes p_note) becomes ambiguous between the two —
-- PostgREST/Postgres can't tell which one to use and every single call
-- fails with "could not choose the best candidate function", not an
-- intermittent/offline issue. Drop the old signature explicitly first,
-- same pattern this file already uses for khata_customer_totals /
-- supplier_contact_totals above when their shape changed.
drop function if exists record_stock_move(uuid, text, numeric, numeric, uuid);
-- Grows an optional p_reason (Stock Ledger Pattern) — same trailing-
-- default-param addition already explained above for p_note, same
-- reason a signature this recognizable needs no new drop: p_reason is
-- appended after every existing positional/default param, so every
-- caller that predates it (none pass p_reason) still resolves to this
-- one exact function, no second overload created.
create or replace function record_stock_move(
  p_item_id uuid,
  p_type text,
  p_qty numeric,
  p_amount numeric default 0,
  p_sale_ref uuid default null,
  p_note text default null,
  p_reason text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid;
  v_item_name text;
  v_unit text;
  v_txn_id uuid;
begin
  if p_type not in ('purchase', 'sale', 'return') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive';
  end if;

  select shop_id, name, unit into v_shop_id, v_item_name, v_unit
  from items where id = p_item_id;

  if v_shop_id is null then
    raise exception 'item not found';
  end if;

  insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, sale_ref, note)
  values (v_shop_id, p_item_id, v_item_name, p_type, p_qty, v_unit, coalesce(p_amount, 0), auth.uid(), p_sale_ref, p_note)
  returning id into v_txn_id;

  -- p_reason lets a caller override the ledger reason without changing
  -- p_type's own sale/purchase/return meaning (e.g. Inventory's Stock
  -- Out modal passing 'adjustment' for damage/wastage — still a stock
  -- decrease logged the same way a sale is, just tagged differently).
  perform record_stock_movement(
    p_item_id, null,
    case when p_type in ('purchase', 'return') then p_qty else -p_qty end,
    coalesce(p_reason, p_type),
    'transaction', v_txn_id, p_note
  );
end;
$$;

create index if not exists idx_transactions_customer on transactions(customer_id) where customer_id is not null;

-- ============================================================
-- 15. MULTI-BRANCH + MANAGER ROLE (spec §2/§17/§20/§25-E)
--
-- A shop with only ever one branch is unaffected end to end: branches
-- gets exactly one row (is_main), every existing item/customer/etc.
-- backfills to it, and branch_id being null on new rows going forward
-- (nobody's forced to pick a branch) still means "the shop's one and
-- only branch" everywhere it's read. Branch-scoping for Manager/Cashier
-- is enforced at the query level in each page, same convention
-- allowed_sections already used — not a hard RLS boundary (see the note
-- further down on why).
-- ============================================================

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null default 'Main Branch',
  address text,
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
alter table branches enable row level security;
drop policy if exists "branches_select_own_shop" on branches;
create policy "branches_select_own_shop" on branches for select using (shop_id = my_shop_id());
-- Only the Owner restructures the branch list itself — a Manager can be
-- scoped to a branch but never add/rename/remove one.
drop policy if exists "branches_write_owner" on branches;
create policy "branches_write_owner" on branches for all
  using (shop_id = my_shop_id() and my_role() = 'owner')
  with check (shop_id = my_shop_id() and my_role() = 'owner');

insert into branches (shop_id, name, is_main)
select id, 'Main Branch', true from shops
where not exists (select 1 from branches b where b.shop_id = shops.id);

alter table profiles add column if not exists branch_id uuid references branches(id) on delete set null;

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'manager', 'cashier'));

update profiles p set branch_id = b.id
from branches b
where b.shop_id = p.shop_id and b.is_main and p.branch_id is null and p.role <> 'owner';

-- branch_id on every shop-scoped operational table — nullable, meaning
-- "the shop's main/only branch" until a shop actually splits (see the
-- read-side fallback in each page: `branch_id = my branch OR branch_id
-- is null`).
alter table items add column if not exists branch_id uuid references branches(id) on delete set null;
alter table customers add column if not exists branch_id uuid references branches(id) on delete set null;
alter table khata_entries add column if not exists branch_id uuid references branches(id) on delete set null;
alter table suppliers add column if not exists branch_id uuid references branches(id) on delete set null;
alter table supplier_entries add column if not exists branch_id uuid references branches(id) on delete set null;
alter table purchase_orders add column if not exists branch_id uuid references branches(id) on delete set null;
alter table expenses add column if not exists branch_id uuid references branches(id) on delete set null;
alter table transactions add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists idx_branches_shop on branches(shop_id);
create index if not exists idx_profiles_branch on profiles(branch_id);
create index if not exists idx_items_branch on items(branch_id);

create or replace function my_branch_id()
returns uuid
language sql
security definer
stable
as $$
  select branch_id from profiles where id = auth.uid()
$$;

-- NOTE on why this stays app-level, not RLS-level: items.stock is a
-- single number per row (this schema never split one SKU into
-- independent per-branch counts — see stock_transfers below for how a
-- branch actually gets its own stock instead: a transfer moves qty from
-- one item row to another, matched/created at the destination branch).
-- A hard RLS branch filter would have to special-case every table's
-- "null branch_id = visible everywhere" fallback identically to the
-- app-level filter anyway, so there's no safety left on the table by
-- duplicating it in Postgres too — shop_id (the real security boundary,
-- unchanged) already stays RLS-enforced above.

-- 15b. STOCK TRANSFERS (spec §25-E) — a transfer is 'pending' until the
-- destination branch confirms receipt; confirming is the one moment
-- stock actually moves — decrement the source item, increment (or
-- create, matched by barcode/name) the equivalent item at the
-- destination branch. Same "match existing or create" pattern AI
-- Slip-Scan already uses for a brand-new item.
create table if not exists stock_transfers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  source_branch_id uuid not null references branches(id) on delete cascade,
  destination_branch_id uuid not null references branches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  note text,
  initiated_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create table if not exists stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  item_name text not null,
  qty numeric not null
);
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
drop policy if exists "stock_transfers_own_shop" on stock_transfers;
create policy "stock_transfers_own_shop" on stock_transfers for all
  using (shop_id = my_shop_id() and my_role() in ('owner', 'manager'))
  with check (shop_id = my_shop_id() and my_role() in ('owner', 'manager'));
drop policy if exists "stock_transfer_items_own_shop" on stock_transfer_items;
create policy "stock_transfer_items_own_shop" on stock_transfer_items for all
  using (shop_id = my_shop_id() and my_role() in ('owner', 'manager'))
  with check (shop_id = my_shop_id() and my_role() in ('owner', 'manager'));

create index if not exists idx_stock_transfers_shop on stock_transfers(shop_id, created_at desc);
create index if not exists idx_stock_transfer_items_transfer on stock_transfer_items(transfer_id);

create or replace function initiate_stock_transfer(
  p_source_branch_id uuid,
  p_destination_branch_id uuid,
  p_items jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_transfer_id uuid;
  v_line jsonb;
begin
  if p_source_branch_id = p_destination_branch_id then
    raise exception 'source and destination must be different branches';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item is required';
  end if;

  insert into stock_transfers (shop_id, source_branch_id, destination_branch_id, note, initiated_by)
  values (v_shop_id, p_source_branch_id, p_destination_branch_id, p_note, auth.uid())
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_items) loop
    insert into stock_transfer_items (shop_id, transfer_id, item_id, item_name, qty)
    values (v_shop_id, v_transfer_id, (v_line->>'item_id')::uuid, v_line->>'item_name', (v_line->>'qty')::numeric);
  end loop;

  return v_transfer_id;
end;
$$;

create or replace function confirm_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_transfer record;
  v_line record;
  v_dest_item_id uuid;
  v_source_item record;
begin
  select * into v_transfer from stock_transfers where id = p_transfer_id and shop_id = v_shop_id;
  if v_transfer is null then raise exception 'transfer not found'; end if;
  if v_transfer.status <> 'pending' then raise exception 'transfer already %', v_transfer.status; end if;

  for v_line in select * from stock_transfer_items where transfer_id = p_transfer_id loop
    select * into v_source_item from items where id = v_line.item_id and shop_id = v_shop_id;
    if v_source_item is null then continue; end if;

    -- Match the destination branch's existing item by barcode (if this
    -- item has one) or exact name, same lookup order Slip-Scan uses —
    -- create a new row there only if genuinely nothing matches. Starts
    -- at stock 0 either way now — record_stock_movement below is what
    -- actually credits the transferred qty, same single choke-point
    -- every other stock-affecting flow now goes through.
    select id into v_dest_item_id from items
    where shop_id = v_shop_id and branch_id = v_transfer.destination_branch_id
      and ((v_source_item.barcode is not null and barcode = v_source_item.barcode) or name = v_source_item.name)
    limit 1;

    if v_dest_item_id is null then
      insert into items (shop_id, branch_id, name, category, unit, stock, min_stock, price, cost_price, barcode)
      values (v_shop_id, v_transfer.destination_branch_id, v_source_item.name, v_source_item.category, v_source_item.unit, 0, v_source_item.min_stock, v_source_item.price, v_source_item.cost_price, null)
      returning id into v_dest_item_id;
    end if;

    insert into transactions (shop_id, branch_id, item_id, item_name, type, qty, unit, amount, created_by)
    values (v_shop_id, v_transfer.source_branch_id, v_line.item_id, v_line.item_name, 'sale', v_line.qty, v_source_item.unit, 0, auth.uid());
    insert into transactions (shop_id, branch_id, item_id, item_name, type, qty, unit, amount, created_by)
    values (v_shop_id, v_transfer.destination_branch_id, v_dest_item_id, v_line.item_name, 'purchase', v_line.qty, v_source_item.unit, 0, auth.uid());

    -- Stock Ledger: two linked movements sharing reference_id — the one
    -- traceability guarantee this whole refactor is for (spec: "dono
    -- same reference_id se linked").
    perform record_stock_movement(v_line.item_id, v_transfer.source_branch_id, -v_line.qty, 'transfer_out', 'stock_transfer', p_transfer_id, null);
    perform record_stock_movement(v_dest_item_id, v_transfer.destination_branch_id, v_line.qty, 'transfer_in', 'stock_transfer', p_transfer_id, null);
  end loop;

  update stock_transfers set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = p_transfer_id;
end;
$$;

create or replace function cancel_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update stock_transfers set status = 'cancelled'
  where id = p_transfer_id and shop_id = my_shop_id() and status = 'pending';
end;
$$;

-- handle_new_user(): supports invited_role ('manager' | 'cashier',
-- app_metadata — same trust boundary as invited_shop_id) and lands an
-- invited user on their shop's Main Branch by default; Owner's
-- branch_id stays null (org-wide).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_shop_id uuid;
  invited_shop_id uuid;
  invited_role text;
  invited_branch_id uuid;
begin
  invited_shop_id := nullif(new.raw_app_meta_data->>'invited_shop_id', '')::uuid;

  if invited_shop_id is not null then
    invited_role := coalesce(nullif(new.raw_app_meta_data->>'invited_role', ''), 'cashier');
    if invited_role not in ('manager', 'cashier') then
      invited_role := 'cashier';
    end if;

    select id into invited_branch_id from branches where shop_id = invited_shop_id and is_main limit 1;

    insert into profiles (id, shop_id, branch_id, full_name, email, role)
    values (new.id, invited_shop_id, invited_branch_id, new.raw_user_meta_data->>'full_name', new.email, invited_role);
  else
    insert into shops (name, owner_id)
    values (coalesce(new.raw_user_meta_data->>'shop_name', 'Meri Dukaan'), new.id)
    returning id into new_shop_id;

    insert into branches (shop_id, name, is_main)
    values (new_shop_id, 'Main Branch', true);

    insert into profiles (id, shop_id, full_name, email, role)
    values (new.id, new_shop_id, new.raw_user_meta_data->>'full_name', new.email, 'owner');
  end if;

  return new;
end;
$$;

-- ============================================================
-- 16. SUPER ADMIN — Plans, Support Tickets, System Settings (spec §27)
-- ============================================================

-- Plans catalog — this product currently sells exactly one flat plan
-- (₨999/month via STRIPE_PRICE_ID), so this seeds one real row rather
-- than fabricating tiers that don't exist in Stripe. Structured so a
-- genuine second tier can be added later without a schema change.
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  billing_interval text not null default 'month',
  features text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into plans (name, price, billing_interval, features)
select 'Standard', 999, 'month', array['Unlimited items', 'Unlimited khata customers', 'AI Slip-Scan stock-in', 'Multi-branch + staff roles', 'WhatsApp receipts & reminders']
where not exists (select 1 from plans);
-- RLS enabled with zero policies — "admin-only, unreachable via
-- anon/authenticated roles" (same lockdown as admin_actions above; only
-- the service-role client, i.e. Super Admin's own routes, ever touches
-- this table — service_role bypasses RLS entirely regardless of
-- policies, so this doesn't block it). The table previously had no
-- `enable row level security` call at all despite the comment claiming
-- this exact pattern — that's a real gap, not a stylistic one: Supabase
-- grants anon/authenticated roles full CRUD on public-schema tables by
-- default, and RLS being OFF means nothing gates that grant. Without
-- this line, any signed-in user's own JWT (or the public anon key)
-- could read/edit/delete every shop's pricing plan directly via the
-- REST API, entirely outside the app's own admin routes.
alter table plans enable row level security;

-- Support tickets — a dukaandar raises one from their own shop
-- (Settings > Support); Super Admin sees every shop's tickets in one
-- place and resolves them.
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  assigned_to text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table support_tickets enable row level security;
drop policy if exists "support_tickets_shop_select" on support_tickets;
create policy "support_tickets_shop_select" on support_tickets for select using (shop_id = my_shop_id());
drop policy if exists "support_tickets_shop_insert" on support_tickets;
create policy "support_tickets_shop_insert" on support_tickets for insert with check (shop_id = my_shop_id());
-- No update/delete policy for shop users — resolving/assigning a
-- ticket only happens from the Super Admin panel (service-role).
create index if not exists idx_support_tickets_shop on support_tickets(shop_id, created_at desc);
create index if not exists idx_support_tickets_status on support_tickets(status, created_at desc);

-- System Settings — a single global row. default_trial_days actually
-- feeds handle_new_user() below (replacing shops.trial_ends_at's fixed
-- 14-day column default), so changing it here takes effect on new
-- signups immediately, no redeploy needed. feature_flags/
-- maintenance_mode are read by every logged-in shop's own dashboard
-- (to show the maintenance banner / hide a flagged-off feature), which
-- is why this table gets a real (narrow, read-only) RLS policy instead
-- of the "no RLS, admin-only" pattern the rest of this section uses —
-- writes still only ever happen from Super Admin via service-role.
create table if not exists platform_settings (
  id boolean primary key default true check (id), -- singleton: exactly one row, always id = true
  default_trial_days int not null default 14,
  maintenance_mode boolean not null default false,
  feature_flags jsonb not null default '{"smart_reorder": true}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into platform_settings (id) values (true) on conflict (id) do nothing;
alter table platform_settings enable row level security;
drop policy if exists "platform_settings_read_all" on platform_settings;
create policy "platform_settings_read_all" on platform_settings for select using (auth.uid() is not null);

-- handle_new_user(): identical to the version above except a fresh
-- signup's trial_ends_at now comes from platform_settings.default_trial_days
-- instead of the shops table's fixed 14-day column default.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_shop_id uuid;
  invited_shop_id uuid;
  invited_role text;
  invited_branch_id uuid;
  trial_days int;
begin
  invited_shop_id := nullif(new.raw_app_meta_data->>'invited_shop_id', '')::uuid;

  if invited_shop_id is not null then
    invited_role := coalesce(nullif(new.raw_app_meta_data->>'invited_role', ''), 'cashier');
    if invited_role not in ('manager', 'cashier') then
      invited_role := 'cashier';
    end if;

    select id into invited_branch_id from branches where shop_id = invited_shop_id and is_main limit 1;

    insert into profiles (id, shop_id, branch_id, full_name, email, role)
    values (new.id, invited_shop_id, invited_branch_id, new.raw_user_meta_data->>'full_name', new.email, invited_role);
  else
    select coalesce(dts.default_trial_days, 14) into trial_days from platform_settings dts limit 1;

    insert into shops (name, owner_id, trial_ends_at)
    values (
      coalesce(new.raw_user_meta_data->>'shop_name', 'Meri Dukaan'),
      new.id,
      now() + (coalesce(trial_days, 14) || ' days')::interval
    )
    returning id into new_shop_id;

    insert into branches (shop_id, name, is_main)
    values (new_shop_id, 'Main Branch', true);

    insert into profiles (id, shop_id, full_name, email, role)
    values (new.id, new_shop_id, new.raw_user_meta_data->>'full_name', new.email, 'owner');
  end if;

  return new;
end;
$$;

-- ============================================================
-- 16. STOCK LEDGER PATTERN (ERPNext/Odoo-style Stock Ledger Entry)
--
-- Before this: items.stock was mutated directly by 4 different
-- functions (record_stock_move, record_khata_entry, receive_po_lines,
-- confirm_stock_transfer), each with its own `update items set
-- stock = ...` — nothing recorded WHY a given change happened in one
-- traceable place, so History/Reports couldn't reliably answer "what
-- moved this item's stock and when."
--
-- After this: stock_movements is the single append-only ledger every
-- stock-affecting action writes to, and record_stock_movement() below
-- is the only place items.stock is written from — every one of those
-- 4 functions now calls it instead of touching items directly (see
-- their bodies above, already rewired). items.stock itself is NOT
-- removed: same as ERPNext's "Bin" (a cached running total kept in
-- sync transactionally alongside each ledger entry, not a live SUM()
-- on every read) — every existing read path (Inventory list, POS
-- search, Reorder, Dashboard, Reports) keeps working unchanged, at
-- the same performance, with zero client-code changes required for
-- Sale/Return/Purchase/Slip-Scan/Transfer.
-- ============================================================

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  quantity_change numeric not null,
  reason text not null check (reason in ('sale', 'return', 'purchase', 'transfer_in', 'transfer_out', 'adjustment', 'slip_scan')),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table stock_movements enable row level security;
-- Read access for everyone in the shop (a Cashier can see why an item's
-- stock is what it is, same visibility their Billing screen already
-- gives them); writes only ever happen through record_stock_movement()
-- below, called from other SECURITY INVOKER functions under the
-- calling user's own session — this policy is what lets those inserts
-- through, not a door to insert arbitrary ledger rows some other way.
drop policy if exists "stock_movements_own_shop" on stock_movements;
create policy "stock_movements_own_shop" on stock_movements for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

create index if not exists idx_stock_movements_item on stock_movements(item_id, created_at desc);
create index if not exists idx_stock_movements_shop on stock_movements(shop_id, created_at desc);
create index if not exists idx_stock_movements_branch on stock_movements(branch_id, created_at desc) where branch_id is not null;

-- The one choke point. p_branch_id null means "use the item's own
-- branch_id" (the common case — a sale/return/purchase happens wherever
-- the item already lives); Transfer passes its own source/destination
-- branch explicitly since a transfer is defined by moving BETWEEN two
-- branches, not by the item's home branch.
create or replace function record_stock_movement(
  p_item_id uuid,
  p_branch_id uuid,
  p_quantity_change numeric,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_note text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid;
  v_item_branch_id uuid;
begin
  if p_reason not in ('sale', 'return', 'purchase', 'transfer_in', 'transfer_out', 'adjustment', 'slip_scan') then
    raise exception 'invalid stock movement reason: %', p_reason;
  end if;

  select shop_id, branch_id into v_shop_id, v_item_branch_id from items where id = p_item_id;
  if v_shop_id is null then
    raise exception 'item not found';
  end if;

  insert into stock_movements (shop_id, item_id, branch_id, quantity_change, reason, reference_type, reference_id, note, created_by)
  values (v_shop_id, p_item_id, coalesce(p_branch_id, v_item_branch_id), p_quantity_change, p_reason, p_reference_type, p_reference_id, p_note, auth.uid());

  update items set stock = greatest(0, stock + p_quantity_change) where id = p_item_id;
end;
$$;

-- One-time backfill from the existing transactions/khata_entries
-- history so items that already had movement before this migration
-- aren't blank in the new ledger — no data lost, nothing here changes
-- items.stock (it's already at its correct current value; this only
-- back-fills the audit trail explaining how it got there). Idempotent
-- via the not-exists guard, safe to re-run.
--
-- Known, accepted limitation: a stock-transfer confirmed before this
-- migration existed also inserted two `transactions` rows (type
-- sale/purchase, amount 0) as its own audit trail — this backfill has
-- no reliable way to tell those apart from a genuine sale/purchase
-- retroactively, so pre-migration transfers backfill as reason
-- 'sale'/'purchase' rather than 'transfer_out'/'transfer_in'. Every
-- transfer confirmed from now on (via the rewired confirm_stock_transfer
-- above) tags correctly from the start.
insert into stock_movements (shop_id, item_id, branch_id, quantity_change, reason, reference_type, reference_id, note, created_by, created_at)
select
  t.shop_id, t.item_id, t.branch_id,
  case when t.type in ('purchase', 'return') then t.qty else -t.qty end,
  t.type,
  'transaction', t.id, t.note, t.created_by, t.created_at
from transactions t
where t.item_id is not null
  and not exists (select 1 from stock_movements sm where sm.reference_type = 'transaction' and sm.reference_id = t.id);

insert into stock_movements (shop_id, item_id, branch_id, quantity_change, reason, reference_type, reference_id, note, created_by, created_at)
select
  k.shop_id, k.item_id, k.branch_id,
  case when k.type = 'purchase' then -coalesce(k.qty, 0) else coalesce(k.qty, 0) end,
  case when k.type = 'purchase' then 'sale' else 'return' end,
  'khata_entry', k.id, k.note, k.created_by, k.created_at
from khata_entries k
where k.item_id is not null
  and k.type in ('purchase', 'return')
  and coalesce(k.qty, 0) > 0
  and not exists (select 1 from stock_movements sm where sm.reference_type = 'khata_entry' and sm.reference_id = k.id);

-- ============================================================
-- 17. KHATA ENTRY REVERSAL + INVOICE NUMBERS
--
-- Deleting a khata_entries row (old delete_khata_entry) hard-erased the
-- audit trail — the row itself, the only place recording that a udhaar
-- sale or a return ever happened, was just gone. Fix: a "reverse" op
-- that inserts a mirror-image entry instead of removing anything.
-- reversal_of links a reversal row back to what it reverses; reversed_at
-- marks the original as no longer "live" (both are set together, inside
-- one function) — every entry that ever existed is still in the table,
-- forever, which is the whole point of a ledger.
-- ============================================================

alter table khata_entries add column if not exists entry_number bigint generated always as identity;
alter table khata_entries add column if not exists reversal_of uuid references khata_entries(id) on delete set null;
alter table khata_entries add column if not exists reversed_at timestamptz;
create index if not exists idx_khata_entries_reversal_of on khata_entries(reversal_of);

-- record_khata_entry grows a return value (the new row's id) so
-- reverse_khata_entry below can link its reversal row back to it via
-- reversal_of — a return-type change, which create-or-replace can't do
-- in place, hence the drop.
drop function if exists record_khata_entry(uuid, text, uuid, text, numeric, numeric, text, text);
create function record_khata_entry(
  p_customer_id uuid,
  p_type text,
  p_item_id uuid,
  p_item_name text,
  p_qty numeric,
  p_amount numeric,
  p_note text,
  p_payment_method text default 'cash'
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
  v_unit text;
  v_txn_id uuid;
  v_entry_id uuid;
begin
  if p_type not in ('purchase', 'payment', 'return') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into khata_entries (shop_id, customer_id, type, item_id, item_name, qty, amount, note, created_by, payment_method)
  values (v_shop_id, p_customer_id, p_type, p_item_id, p_item_name, p_qty, p_amount, p_note, auth.uid(), coalesce(p_payment_method, 'cash'))
  returning id into v_entry_id;

  -- Stock Ledger (spec: Stock Ledger Pattern) — record_stock_movement
  -- below is now the only place items.stock is ever written; this just
  -- logs the transactions row for reporting the same as before and
  -- hands its id to the ledger as reference_id, so a stock_movements
  -- row can be traced straight back to the sale/return that caused it.
  if p_type = 'purchase' and p_item_id is not null then
    select unit into v_unit from items where id = p_item_id;
    insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, customer_id, note)
    values (v_shop_id, p_item_id, p_item_name, 'sale', coalesce(p_qty, 0), v_unit, p_amount, auth.uid(), p_customer_id, p_note)
    returning id into v_txn_id;
    perform record_stock_movement(p_item_id, null, -coalesce(p_qty, 0), 'sale', 'transaction', v_txn_id, p_note);
  elsif p_type = 'return' and p_item_id is not null then
    select unit into v_unit from items where id = p_item_id;
    insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by, customer_id, note)
    values (v_shop_id, p_item_id, p_item_name, 'return', coalesce(p_qty, 0), v_unit, p_amount, auth.uid(), p_customer_id, p_note)
    returning id into v_txn_id;
    perform record_stock_movement(p_item_id, null, coalesce(p_qty, 0), 'return', 'transaction', v_txn_id, p_note);
  end if;

  return v_entry_id;
end;
$$;

-- Replaces delete_khata_entry (hard delete) entirely — nothing in this
-- codebase should be able to permanently erase a khata entry anymore.
drop function if exists delete_khata_entry(uuid);

create or replace function reverse_khata_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_entry khata_entries%rowtype;
  v_new_type text;
  v_new_id uuid;
begin
  select * into v_entry from khata_entries where id = p_entry_id;
  if v_entry is null then raise exception 'entry not found'; end if;
  if v_entry.reversed_at is not null then raise exception 'entry already reversed'; end if;
  if v_entry.reversal_of is not null then raise exception 'cannot reverse a reversal entry'; end if;

  -- Opposite of what the original did to the balance — purchase (added
  -- debt) reverses as a return (removes debt); return (removed debt)
  -- reverses as a purchase (adds debt back); payment (removed debt, no
  -- item) reverses as a purchase too, since there's no distinct
  -- "un-pay" type in the domain — the item_id-is-null guards inside
  -- record_khata_entry below mean it naturally skips any stock effect
  -- for that case, only restoring the balance.
  v_new_type := case v_entry.type
    when 'purchase' then 'return'
    when 'return' then 'purchase'
    when 'payment' then 'purchase'
  end;

  -- Reuses record_khata_entry itself rather than duplicating its
  -- insert+stock-movement logic — same code path, same stock behavior
  -- (a purchase-type reversal decreases stock exactly the way a real
  -- purchase entry would, a return-type reversal increases it exactly
  -- the way a real return would), guaranteed to stay in sync with it.
  v_new_id := record_khata_entry(
    v_entry.customer_id, v_new_type, v_entry.item_id, v_entry.item_name, v_entry.qty, v_entry.amount,
    'Reversal of #INV-' || v_entry.entry_number, v_entry.payment_method
  );

  update khata_entries set reversal_of = v_entry.id where id = v_new_id;
  update khata_entries set reversed_at = now() where id = v_entry.id;
end;
$$;

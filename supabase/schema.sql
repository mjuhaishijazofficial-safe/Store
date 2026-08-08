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
  v_total numeric := 0;
  v_line record;
  v_qty_now numeric;
  v_all_done boolean := true;
begin
  select supplier_id, status into v_supplier_id, v_status
  from purchase_orders where id = p_po_id and shop_id = v_shop_id;

  if v_supplier_id is null then
    raise exception 'purchase order not found';
  end if;
  if v_status not in ('draft', 'sent', 'partial') then
    raise exception 'this purchase order cannot receive any more stock';
  end if;

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
        update items set stock = stock + v_qty_now where id = v_line.item_id;
        insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by)
        select v_shop_id, v_line.item_id, v_line.item_name, 'purchase', v_qty_now, unit, v_qty_now * v_line.cost_price, auth.uid()
        from items where id = v_line.item_id;
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

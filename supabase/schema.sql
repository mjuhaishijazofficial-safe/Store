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
  subscription_status text not null default 'trialing', -- trialing | active | past_due | canceled
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
  amount numeric not null,              -- purchase = udhaar chadha, payment = utra
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

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
  type text not null check (type in ('purchase','payment')), -- purchase = maal liya (charhta hai), payment = maine di (utarta hai)
  item_name text,
  qty numeric,
  amount numeric not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

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
  p_amount numeric default 0
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
  if p_type not in ('purchase', 'sale') then
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

  if p_type = 'purchase' then
    update items set stock = stock + p_qty where id = p_item_id;
  else
    update items set stock = greatest(0, stock - p_qty) where id = p_item_id;
  end if;

  insert into transactions (shop_id, item_id, item_name, type, qty, unit, amount, created_by)
  values (v_shop_id, p_item_id, v_item_name, p_type, p_qty, v_unit, coalesce(p_amount, 0), auth.uid());
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
  p_note text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_shop_id uuid := my_shop_id();
begin
  if p_type not in ('purchase', 'payment') then
    raise exception 'invalid type: %', p_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  insert into khata_entries (shop_id, customer_id, type, item_id, item_name, qty, amount, note, created_by)
  values (v_shop_id, p_customer_id, p_type, p_item_id, p_item_name, p_qty, p_amount, p_note, auth.uid());

  if p_type = 'purchase' and p_item_id is not null then
    update items set stock = greatest(0, stock - coalesce(p_qty, 0)) where id = p_item_id;
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
create or replace function khata_customer_totals(p_customer_id uuid)
returns table(given numeric, paid numeric)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(amount) filter (where type = 'purchase'), 0) as given,
    coalesce(sum(amount) filter (where type = 'payment'), 0) as paid
  from khata_entries
  where customer_id = p_customer_id
$$;

create or replace function supplier_contact_totals(p_supplier_id uuid)
returns table(given numeric, paid numeric)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(amount) filter (where type = 'purchase'), 0) as given,
    coalesce(sum(amount) filter (where type = 'payment'), 0) as paid
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

drop policy if exists "supplier_entries_own_shop" on supplier_entries;
create policy "supplier_entries_own_shop" on supplier_entries for all
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
    select item_id, sum(qty) as total_qty
    from transactions
    where shop_id = p_shop_id
      and type = 'sale'
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
create or replace function top_selling_items(p_shop_id uuid, p_days int default 30, p_limit int default 5)
returns table(item_id uuid, item_name text, unit text, qty_sold numeric, revenue numeric)
language sql
security invoker
stable
as $$
  select i.id, i.name, i.unit, sum(t.qty), sum(t.amount)
  from transactions t
  join items i on i.id = t.item_id
  where t.shop_id = p_shop_id
    and t.type = 'sale'
    and t.created_at >= now() - (p_days || ' days')::interval
  group by i.id, i.name, i.unit
  order by sum(t.qty) desc
  limit p_limit
$$;

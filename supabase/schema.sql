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
  spent numeric not null default 0,
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

-- 3. ITEMS (inventory) -----------------------------------------------
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  category text,
  unit text default 'unit',
  stock numeric not null default 0,
  min_stock numeric not null default 0,
  price numeric not null default 0,
  created_at timestamptz not null default now()
);

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

-- shops: a user can only see/update their own shop
create policy "shop_select_own" on shops for select using (id = my_shop_id());
-- only the owner can change shop settings/budget/billing — staff can read, not write
create policy "shop_update_own" on shops for update
  using (id = my_shop_id() and my_role() = 'owner');

-- profiles: user can see profiles within their shop
create policy "profile_select_same_shop" on profiles for select using (shop_id = my_shop_id());
create policy "profile_insert_self" on profiles for insert with check (id = auth.uid());
-- no update/delete policy on profiles — role changes only happen via the
-- security-definer signup trigger, never directly by a user (staff can't self-promote)

-- items: fully scoped to shop_id
create policy "items_all_own_shop" on items for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- transactions: fully scoped to shop_id
create policy "transactions_all_own_shop" on transactions for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- customers / khata_entries: fully scoped to shop_id
create policy "customers_own_shop" on customers for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());
create policy "khata_own_shop" on khata_entries for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

-- suppliers / supplier_entries: fully scoped to shop_id
create policy "suppliers_own_shop" on suppliers for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());
create policy "supplier_entries_own_shop" on supplier_entries for all
  using (shop_id = my_shop_id())
  with check (shop_id = my_shop_id());

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
  -- staff invites (see /api/staff/invite) pass invited_shop_id in the invite's
  -- user metadata — attach to that existing shop instead of creating a new one
  invited_shop_id := nullif(new.raw_user_meta_data->>'invited_shop_id', '')::uuid;

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

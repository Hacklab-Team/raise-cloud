-- RAISE: kiosk + admin panel + customer app, one database.
--
-- Who can do what
--   anon / everyone   read active products (catalog)
--   customers         read/update their own profile, cards, orders and shopping list
--   admins            everything (rows in public.admins)
--   kiosks            no direct table access: they call the `kiosk` Edge Function with a
--                     device key, and that function uses the service role.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- helpers

create table public.admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create policy "admins see admins" on public.admins for select using (public.is_admin());

-- 10 characters of Crockford base32 (~50 bits): the opaque ID a RAISE Pass QR carries.
create or replace function public.new_pass_id()
returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare
    alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    bytes bytea := extensions.gen_random_bytes(10);   -- Supabase keeps pgcrypto in "extensions"
    out text := '';
begin
    for i in 0..9 loop
        out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    return out;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- products

create table public.products (
    id uuid primary key default gen_random_uuid(),
    barcode text not null unique check (barcode ~ '^[0-9]{6,14}$'),
    title text not null check (length(title) between 1 and 120),
    brand text not null default '',
    price numeric(10, 2) not null check (price >= 0),
    image_url text not null default '',
    stock integer check (stock is null or stock >= 0),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create trigger products_updated before update on public.products
    for each row execute function public.touch_updated_at();
alter table public.products enable row level security;

create policy "catalog is public" on public.products for select
    using (active or public.is_admin());
create policy "admins manage products" on public.products for all
    using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- customers

create table public.customers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique references auth.users (id) on delete set null,
    name text not null check (length(name) between 1 and 60),
    phone text check (phone is null or phone ~ '^[0-9]{10}$'),
    pass_id text not null unique default public.new_pass_id(),
    points integer not null default 0 check (points >= 0),
    blocked boolean not null default false,
    created_via text not null default 'app' check (created_via in ('app', 'kiosk', 'admin')),
    created_at timestamptz not null default now()
);
alter table public.customers enable row level security;

create policy "customers read own" on public.customers for select
    using (user_id = auth.uid() or public.is_admin());
create policy "customers update own" on public.customers for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admins manage customers" on public.customers for all
    using (public.is_admin()) with check (public.is_admin());

-- Customers may change their name and phone only; points, pass and status are server-side.
revoke update on public.customers from authenticated;
grant update (name, phone) on public.customers to authenticated;

-- A new app account gets a customer record (and therefore a pass) automatically, unless it
-- is an admin account. Admins are marked in app_metadata, which only the service role can set
-- (scripts/create-admin.mjs); user_metadata is client-controlled and never trusted for roles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin' then
        insert into public.admins (user_id) values (new.id) on conflict do nothing;
        return new;
    end if;
    insert into public.customers (user_id, name, phone, created_via)
    values (
        new.id,
        coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
        nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
        'app'
    );
    return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- NFC cards

-- Only a SHA-256 of "raise-nfc:<uid hex>" is stored, never the raw card UID.
create table public.nfc_cards (
    uid_hash text primary key check (uid_hash ~ '^[0-9a-f]{64}$'),
    customer_id uuid not null references public.customers (id) on delete cascade,
    label text not null default 'Card',
    linked_at timestamptz not null default now()
);
create index nfc_cards_customer on public.nfc_cards (customer_id);
alter table public.nfc_cards enable row level security;

create policy "cards read own" on public.nfc_cards for select
    using (customer_id in (select id from public.customers where user_id = auth.uid()) or public.is_admin());
create policy "cards unlink own" on public.nfc_cards for delete
    using (customer_id in (select id from public.customers where user_id = auth.uid()) or public.is_admin());
create policy "cards link own" on public.nfc_cards for insert
    with check (customer_id in (select id from public.customers where user_id = auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------- kiosks

create table public.kiosks (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    key_hash text not null unique,          -- sha256 of the device key; the key itself is shown once
    active boolean not null default true,
    last_seen timestamptz,
    info jsonb not null default '{}'::jsonb, -- camera, resolution, app version, current stage
    created_at timestamptz not null default now()
);
alter table public.kiosks enable row level security;
create policy "admins manage kiosks" on public.kiosks for all
    using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- orders

create sequence public.order_number_seq start 1001;

create table public.orders (
    id uuid primary key default gen_random_uuid(),
    number bigint not null unique default nextval('public.order_number_seq'),
    customer_id uuid references public.customers (id) on delete set null,
    kiosk_id uuid references public.kiosks (id) on delete set null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
    item_count integer not null default 0,
    total numeric(10, 2) not null default 0 check (total >= 0),
    points_earned integer not null default 0,
    created_at timestamptz not null default now(),
    paid_at timestamptz
);
create index orders_created on public.orders (created_at desc);
create index orders_customer on public.orders (customer_id, created_at desc);
alter table public.orders enable row level security;

create policy "orders read own" on public.orders for select
    using (customer_id in (select id from public.customers where user_id = auth.uid()) or public.is_admin());
create policy "admins manage orders" on public.orders for all
    using (public.is_admin()) with check (public.is_admin());

create table public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    product_id uuid references public.products (id) on delete set null,
    barcode text not null,
    title text not null,
    unit_price numeric(10, 2) not null check (unit_price >= 0),
    qty integer not null check (qty > 0),
    estimated boolean not null default false
);
create index order_items_order on public.order_items (order_id);
alter table public.order_items enable row level security;

create policy "items read own" on public.order_items for select
    using (order_id in (select id from public.orders) );   -- orders RLS already scopes this
create policy "admins manage items" on public.order_items for all
    using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- shopping list

create table public.shopping_list (
    customer_id uuid not null references public.customers (id) on delete cascade,
    product_id uuid not null references public.products (id) on delete cascade,
    qty integer not null default 1 check (qty between 1 and 99),
    checked boolean not null default false,
    added_at timestamptz not null default now(),
    primary key (customer_id, product_id)
);
alter table public.shopping_list enable row level security;
create policy "list own" on public.shopping_list for all
    using (customer_id in (select id from public.customers where user_id = auth.uid()))
    with check (customer_id in (select id from public.customers where user_id = auth.uid()));

-- ---------------------------------------------------------------- reporting

-- Today's numbers for the admin dashboard (IST business day).
create or replace view public.sales_today
with (security_invoker = true) as
select
    count(*) filter (where status = 'paid')                       as paid_orders,
    coalesce(sum(total) filter (where status = 'paid'), 0)        as revenue,
    coalesce(sum(item_count) filter (where status = 'paid'), 0)   as items_sold,
    count(*) filter (where status = 'pending')                    as open_orders,
    count(distinct customer_id) filter (where status = 'paid')    as customers
from public.orders
where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.orders, public.kiosks, public.products;

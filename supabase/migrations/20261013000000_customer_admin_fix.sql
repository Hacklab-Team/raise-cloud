-- Fix: admins couldn't adjust points or block customers ("permission denied for table customers").
-- The first migration limited UPDATE to the (name, phone) columns for the whole `authenticated`
-- role, and admins sign in as `authenticated` too. Instead, allow updates at the table level and
-- let a trigger refuse protected-field changes from anyone who isn't an admin. Row-level security
-- still decides which rows a user can touch at all (customers: only their own).

grant update on public.customers to authenticated;

create or replace function public.guard_customer_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- Admins, and the server functions (service role: no auth.uid()), may change anything.
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    if new.points is distinct from old.points
        or new.pass_id is distinct from old.pass_id
        or new.blocked is distinct from old.blocked
        or new.user_id is distinct from old.user_id
        or new.created_via is distinct from old.created_via
        or new.created_at is distinct from old.created_at then
        raise exception 'Only the store can change points, passes or account status'
            using errcode = '42501';
    end if;
    return new;
end $$;

create trigger customers_guard before update on public.customers
    for each row execute function public.guard_customer_update();

-- Admin: delete a customer completely. Their NFC card and shopping list go with them (cascade);
-- past orders stay in the sales history as guest orders; their app login is removed too.
create or replace function public.admin_delete_customer(target uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare uid uuid;
begin
    if not public.is_admin() then
        raise exception 'admins only' using errcode = '42501';
    end if;
    select user_id into uid from public.customers where id = target;
    delete from public.customers where id = target;
    if uid is not null and not exists (select 1 from public.admins where user_id = uid) then
        delete from auth.users where id = uid;
    end if;
end $$;

revoke execute on function public.admin_delete_customer(uuid) from public, anon;
grant execute on function public.admin_delete_customer(uuid) to authenticated;

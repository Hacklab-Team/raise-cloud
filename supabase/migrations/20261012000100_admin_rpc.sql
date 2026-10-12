-- Admin: re-issue a customer's pass (old QR and printouts stop working immediately).
create or replace function public.reissue_pass(target uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare fresh text;
begin
    if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
    update public.customers set pass_id = public.new_pass_id() where id = target returning pass_id into fresh;
    return fresh;
end $$;

-- Admin: best sellers in the last N days (paid orders only).
create or replace function public.top_products(days integer default 1, max_rows integer default 5)
returns table (barcode text, title text, qty bigint, revenue numeric)
language sql stable security invoker set search_path = public
as $$
    select i.barcode, max(i.title), sum(i.qty), sum(i.qty * i.unit_price)
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.status = 'paid' and o.created_at >= now() - make_interval(days => days)
    group by i.barcode
    order by 3 desc
    limit max_rows
$$;

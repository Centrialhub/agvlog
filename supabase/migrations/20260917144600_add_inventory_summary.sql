create or replace function public.get_inventory_summary_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_tenant_admin(_tenant_id) then
    raise exception 'inventory_not_authorized' using errcode='42501';
  end if;
  select jsonb_build_object(
    'version',1,
    'tenant_id',_tenant_id,
    'actor_id',auth.uid(),
    'balance_count',count(*)::integer,
    'total_pallets',coalesce(sum(balance.pallet_count),0),
    'stagnant_count',count(*) filter(where balance.quantity>0 and balance.first_inbound_at<clock_timestamp()-interval '30 days')::integer,
    'stock_by_client',coalesce((
      select jsonb_agg(jsonb_build_object('client_id',grouped.client_id,'name',grouped.name,'pallets',grouped.pallets)
        order by grouped.pallets desc,grouped.name)
      from (
        select balance_by_client.client_id,
          coalesce(client.company_name,'Sem cliente') name,
          coalesce(sum(balance_by_client.pallet_count),0) pallets
        from public.inventory_balances balance_by_client
        left join public.clients client on client.id=balance_by_client.client_id and client.tenant_id=balance_by_client.tenant_id
        where balance_by_client.tenant_id=_tenant_id and balance_by_client.quantity>0
        group by balance_by_client.client_id,client.company_name
        order by pallets desc,name
        limit 10
      ) grouped
    ),'[]'::jsonb)
  ) into v_result
  from public.inventory_balances balance
  where balance.tenant_id=_tenant_id;
  return v_result;
end;
$function$;
revoke all on function public.get_inventory_summary_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_inventory_summary_v1(uuid) to authenticated,service_role;

create index if not exists inventory_balances_tenant_item_page
on public.inventory_balances(tenant_id,item_description,id);
create index if not exists inventory_balances_tenant_aging_page
on public.inventory_balances(tenant_id,first_inbound_at,id)
where quantity>0 and first_inbound_at is not null;
create index if not exists inventory_movements_tenant_moved_page
on public.inventory_movements(tenant_id,moved_at desc,id desc);

comment on function public.get_inventory_summary_v1(uuid) is
  'Returns global inventory KPIs and the top ten client pallet groups without transferring balance or movement rows to the browser.';

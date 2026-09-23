create or replace function public.get_inventory_summary_v1(_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_tenant_member(_tenant_id) then
    raise exception 'inventory_not_authorized' using errcode='42501';
  end if;
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'balance_count',count(*)::integer,'total_pallets',coalesce(sum(balance.pallet_count),0),
    'stagnant_count',count(*) filter(where balance.first_inbound_at<statement_timestamp()-interval '30 days')::integer,
    'stock_by_client',coalesce((
      select jsonb_agg(jsonb_build_object('client_id',grouped.client_id,'name',grouped.name,'pallets',grouped.pallets)
        order by grouped.pallets desc,grouped.name)
      from (
        select balance_by_client.client_id,coalesce(client.company_name,'Sem cliente') name,
          coalesce(sum(balance_by_client.pallet_count),0) pallets
        from public.inventory_balances balance_by_client
        left join public.clients client on client.id=balance_by_client.client_id and client.tenant_id=balance_by_client.tenant_id
        where balance_by_client.tenant_id=_tenant_id and balance_by_client.quantity>0
        group by balance_by_client.client_id,client.company_name order by pallets desc,name limit 10
      ) grouped
    ),'[]'::jsonb)
  ) into v_result from public.inventory_balances balance
  where balance.tenant_id=_tenant_id and balance.quantity>0;
  return v_result;
end;
$function$;

comment on function public.get_inventory_summary_v1(uuid) is
  'Returns inventory KPIs and top client pallet groups using only strictly positive on-hand balances.';

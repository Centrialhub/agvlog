create index if not exists driver_settlements_driver_filter on public.driver_settlements(tenant_id,driver_id);
create index if not exists driver_settlements_vehicle_filter on public.driver_settlements(tenant_id,vehicle_id);

drop function public.list_driver_settlement_filter_options(uuid);
create function public.list_driver_settlement_filter_options(
 _tenant_id uuid,_kind text,_search text default '',_page integer default 1,_page_size integer default 50,_expected_revision text default null
) returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare page_size integer:=least(greatest(coalesce(_page_size,50),1),50);search text:=btrim(coalesce(_search,''));total integer;revision text;rows jsonb;
begin
 if not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'forbidden' using errcode='42501';end if;
 if _kind not in('drivers','vehicles') or _page is null or _page<1 or length(search)>200 or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'settlement_filter_query_invalid' using errcode='22023';end if;
 if _kind='drivers' then
  with candidates as materialized(
   select driver.id,driver.name label from public.drivers driver where driver.tenant_id=_tenant_id
    and (driver.active or exists(select 1 from public.driver_settlements settlement where settlement.tenant_id=_tenant_id and settlement.driver_id=driver.id))
    and position(lower(search) in lower(coalesce(driver.name,'')))>0
  )
  select count(*)::integer,md5(coalesce(string_agg(md5(to_jsonb(candidates)::text),'' order by label,id),'empty')),
   coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label) order by p.label,p.id) from(select * from candidates order by label,id limit page_size offset ((_page-1)*page_size))p),'[]'::jsonb)
  into total,revision,rows from candidates;
 else
  with candidates as materialized(
   select vehicle.id,coalesce(vehicle.plate,'Sem placa') label from public.vehicles vehicle where vehicle.tenant_id=_tenant_id
    and (vehicle.active or exists(select 1 from public.driver_settlements settlement where settlement.tenant_id=_tenant_id and settlement.vehicle_id=vehicle.id))
    and position(lower(search) in lower(coalesce(vehicle.plate,'')))>0
  )
  select count(*)::integer,md5(coalesce(string_agg(md5(to_jsonb(candidates)::text),'' order by label,id),'empty')),
   coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',p.label) order by p.label,p.id) from(select * from candidates order by label,id limit page_size offset ((_page-1)*page_size))p),'[]'::jsonb)
  into total,revision,rows from candidates;
 end if;
 if _expected_revision is not null and _expected_revision<>revision then raise exception 'settlement_filter_options_changed' using errcode='40001';end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'kind',_kind,'search',search,'page',_page,'page_size',page_size,'total',total,'revision',revision,'rows',rows);
end$$;
revoke all on function public.list_driver_settlement_filter_options(uuid,text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_settlement_filter_options(uuid,text,text,integer,integer,text) to authenticated,service_role;

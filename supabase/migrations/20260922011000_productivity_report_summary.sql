create index if not exists idx_loads_tenant_created_at_productivity
  on public.loads(tenant_id,created_at);
create index if not exists idx_operational_events_tenant_created_at_productivity
  on public.operational_events(tenant_id,created_at);

create or replace function public.productivity_report_summary_v1(
  _tenant_id uuid,
  _driver_id uuid default null,
  _vehicle_id uuid default null,
  _from date default null,
  _to date default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  v_timezone text;
  v_loads integer;
  v_events integer;
  v_delivered integer;
  v_divergent integer;
  v_unsuccessful integer;
  v_impact numeric;
  v_avg_pallets integer;
  v_driver_metrics jsonb;
  v_client_divergences jsonb;
  v_vehicle_efficiency jsonb;
  v_driver_options jsonb;
  v_vehicle_options jsonb;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'operator_required' using errcode='42501';
  end if;
  if _from is not null and _to is not null and _from>_to then
    raise exception 'invalid_productivity_period' using errcode='22023';
  end if;
  select coalesce(timezone,'America/Sao_Paulo') into v_timezone
  from public.tenants where id=_tenant_id;
  if v_timezone is null then raise exception 'tenant_not_found' using errcode='P0002';end if;

  select count(*)::integer,
    count(*) filter(where status='delivered')::integer,
    count(*) filter(where status='divergent')::integer,
    count(*) filter(where status in('divergent','partial_delivery','returned','refused','failed'))::integer
  into v_loads,v_delivered,v_divergent,v_unsuccessful
  from public.loads l
  where l.tenant_id=_tenant_id
    and (_driver_id is null or l.driver_id=_driver_id)
    and (_vehicle_id is null or l.vehicle_id=_vehicle_id)
    and (_from is null or (l.created_at at time zone v_timezone)::date>=_from)
    and (_to is null or (l.created_at at time zone v_timezone)::date<=_to);

  select count(*)::integer,coalesce(sum(e.financial_impact),0)
  into v_events,v_impact
  from public.operational_events e
  where e.tenant_id=_tenant_id
    and (_driver_id is null or e.driver_id=_driver_id)
    and (_vehicle_id is null or e.vehicle_id=_vehicle_id)
    and (_from is null or (e.created_at at time zone v_timezone)::date>=_from)
    and (_to is null or (e.created_at at time zone v_timezone)::date<=_to);

  select coalesce(round(avg(pallets))::integer,0) into v_avg_pallets
  from(
    select sum(coalesce(l.total_pallet_count,0)) pallets
    from public.loads l
    where l.tenant_id=_tenant_id
      and (_driver_id is null or l.driver_id=_driver_id)
      and (_vehicle_id is null or l.vehicle_id=_vehicle_id)
      and (_from is null or (l.created_at at time zone v_timezone)::date>=_from)
      and (_to is null or (l.created_at at time zone v_timezone)::date<=_to)
    group by coalesce(l.trip_id::text,'load:'||l.id::text)
    having sum(coalesce(l.total_pallet_count,0))>0
  ) trips;

  with filtered as(
    select l.* from public.loads l where l.tenant_id=_tenant_id
      and (_driver_id is null or l.driver_id=_driver_id) and (_vehicle_id is null or l.vehicle_id=_vehicle_id)
      and (_from is null or (l.created_at at time zone v_timezone)::date>=_from)
      and (_to is null or (l.created_at at time zone v_timezone)::date<=_to)
  ), load_totals as(
    select driver_id,count(*)::integer loads,count(*) filter(where status='delivered')::integer deliveries,
      count(*) filter(where status='divergent')::integer divergences,
      count(*) filter(where status in('divergent','partial_delivery','returned','refused','failed'))::integer unsuccessful
    from filtered where driver_id is not null group by driver_id
  ), trip_totals as(
    select driver_id,coalesce(trip_id::text,'load:'||id::text) trip_key,sum(coalesce(total_pallet_count,0)) pallets
    from filtered where driver_id is not null group by driver_id,coalesce(trip_id::text,'load:'||id::text)
  ), rows as(
    select totals.driver_id id,coalesce(d.name,'Desconhecido') name,totals.loads,totals.deliveries,totals.divergences,
      case when totals.deliveries+totals.unsuccessful=0 then null else round(totals.deliveries::numeric*100/(totals.deliveries+totals.unsuccessful))::integer end success_rate,
      coalesce((select round(avg(pallets))::integer from trip_totals trips where trips.driver_id=totals.driver_id and trips.pallets>0),0) avg_pallets
    from load_totals totals left join public.drivers d on d.tenant_id=_tenant_id and d.id=totals.driver_id
    order by totals.loads desc,coalesce(d.name,'Desconhecido'),totals.driver_id limit 100
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by loads desc,name,id),'[]'::jsonb) into v_driver_metrics from rows;

  with rows as(
    select e.client_id id,coalesce(c.company_name,'Desconhecido') name,count(*)::integer total,
      coalesce(sum(e.financial_impact),0) impact
    from public.operational_events e left join public.clients c on c.tenant_id=e.tenant_id and c.id=e.client_id
    where e.tenant_id=_tenant_id and e.client_id is not null
      and (_driver_id is null or e.driver_id=_driver_id) and (_vehicle_id is null or e.vehicle_id=_vehicle_id)
      and (_from is null or (e.created_at at time zone v_timezone)::date>=_from)
      and (_to is null or (e.created_at at time zone v_timezone)::date<=_to)
    group by e.client_id,c.company_name order by count(*) desc,coalesce(c.company_name,'Desconhecido'),e.client_id limit 100
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by total desc,name,id),'[]'::jsonb) into v_client_divergences from rows;

  with filtered as(
    select l.* from public.loads l where l.tenant_id=_tenant_id
      and l.status in('delivered','in_transit','loaded')
      and (_driver_id is null or l.driver_id=_driver_id) and (_vehicle_id is null or l.vehicle_id=_vehicle_id)
      and (_from is null or (l.created_at at time zone v_timezone)::date>=_from)
      and (_to is null or (l.created_at at time zone v_timezone)::date<=_to)
  ), load_totals as(
    select vehicle_id,count(distinct coalesce(trip_id::text,'load:'||id::text))::integer trips,
      coalesce(sum(total_pallet_count),0)::integer total_pallets from filtered where vehicle_id is not null group by vehicle_id
  ), rows as(
    select v.id,v.plate,v.nickname,v.max_pallets,coalesce(t.trips,0) trips,coalesce(t.total_pallets,0) total_pallets,
      case when coalesce(t.trips,0)=0 then 0 else round(t.total_pallets::numeric*100/(t.trips*v.max_pallets))::integer end avg_occupancy
    from public.vehicles v left join load_totals t on t.vehicle_id=v.id
    where v.tenant_id=_tenant_id and v.max_pallets>0 and (_vehicle_id is null or v.id=_vehicle_id)
      and (_driver_id is null or coalesce(t.trips,0)>0)
    order by coalesce(t.trips,0) desc,v.plate,v.id limit 100
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by trips desc,plate,id),'[]'::jsonb) into v_vehicle_efficiency from rows;

  with rows as(
    select id,name from public.drivers where tenant_id=_tenant_id
    order by case when id=_driver_id then 0 else 1 end,name,id limit 500
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by name,id),'[]'::jsonb) into v_driver_options from rows;
  with rows as(
    select id,plate,nickname from public.vehicles where tenant_id=_tenant_id
    order by case when id=_vehicle_id then 0 else 1 end,plate,id limit 500
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by plate,id),'[]'::jsonb) into v_vehicle_options from rows;

  return jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'timezone',v_timezone,
    'total_loads',v_loads,'total_events',v_events,'total_delivered',v_delivered,'total_divergent',v_divergent,
    'overall_success',case when v_delivered+v_unsuccessful=0 then null else round(v_delivered::numeric*100/(v_delivered+v_unsuccessful))::integer end,
    'total_financial_impact',v_impact,'avg_pallets_per_trip',v_avg_pallets,
    'driver_metrics',v_driver_metrics,'client_divergences',v_client_divergences,'vehicle_efficiency',v_vehicle_efficiency,
    'driver_options',v_driver_options,'vehicle_options',v_vehicle_options,
    'driver_options_truncated',(select count(*)>500 from public.drivers where tenant_id=_tenant_id),
    'vehicle_options_truncated',(select count(*)>500 from public.vehicles where tenant_id=_tenant_id)
  );
end;$function$;

revoke all on function public.productivity_report_summary_v1(uuid,uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.productivity_report_summary_v1(uuid,uuid,uuid,date,date) to authenticated;

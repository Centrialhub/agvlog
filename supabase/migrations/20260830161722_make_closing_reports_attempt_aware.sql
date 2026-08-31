-- LOCAL CANDIDATE: attempt-aware closing source contract only.
-- The legacy closing writer is NOT switched to these sources in this migration.
-- Atomic, revision-checked draft creation is required before that cutover.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $dependencies$ begin
 if to_regclass('public.delivery_document_metadata_audits') is null
  or to_regclass('public.current_delivery_document_outcomes') is null
  or to_regprocedure('public._delivery_allocation_document(uuid)') is null
  or to_regprocedure('public.get_closing_report_sources(uuid,jsonb)') is not null then
  raise exception 'Closing sources require the intact attempt/conference chain and an unapplied migration';end if;
 if has_function_privilege('authenticated','public._delivery_allocation_document(uuid)','execute')
  or has_function_privilege('anon','public._delivery_allocation_document(uuid)','execute') then
  raise exception 'Closing allocation helper must remain private';end if;
end;$dependencies$;

create function public._closing_attempt_document_sources(_tenant uuid)
returns table(source jsonb) language sql stable security invoker set search_path='' as $fn$
 with allocations as materialized (
  select a.id allocation_id,a.load_id,a.fiscal_document_id,a.delivery_attempt_id,a.dispatch_stop_id,
   to_jsonb(public._delivery_allocation_document(a.id)) document,
   a.delivery_attempt_id is distinct from f.current_delivery_attempt_id historical
  from public.dispatch_stop_documents a join public.fiscal_documents f
   on f.id=a.fiscal_document_id and f.tenant_id=a.tenant_id
  where a.tenant_id=_tenant
  union all
  select null::uuid,f.load_id,f.id,f.current_delivery_attempt_id,null::uuid,to_jsonb(f),false
  from public.fiscal_documents f where f.tenant_id=_tenant and not exists(
   select 1 from public.dispatch_stop_documents a where a.tenant_id=_tenant and a.fiscal_document_id=f.id
    and a.delivery_attempt_id is not distinct from f.current_delivery_attempt_id)
 ), rows as (
 select a.*,l.load_number,l.external_load_number,l.arrival_date,l.gate_departure_at,l.arrival_at,
  l.vehicle_id,l.driver_id,v.plate,dr.name driver_name,
  h.id outcome_id,h.outcome,h.occurred_at,h.recorded_at,h.source outcome_source,h.event_id,h.dispatch_trip_id,
  coalesce(li.physical,'{"item_count":0,"quantity":0,"weight_kg":0,"pallet_count":0,"volume_m3":0}'::jsonb) physical
 from allocations a
 left join public.loads l on l.id=a.load_id and l.tenant_id=_tenant
 left join public.vehicles v on v.id=l.vehicle_id and v.tenant_id=_tenant
 left join public.drivers dr on dr.id=l.driver_id and dr.tenant_id=_tenant
 left join public.current_delivery_document_outcomes h on h.dispatch_stop_document_id=a.allocation_id
  and h.tenant_id=_tenant and h.fiscal_document_id=a.fiscal_document_id
  and h.delivery_attempt_id is not distinct from a.delivery_attempt_id
 left join lateral (
  select jsonb_build_object('item_count',count(*),'quantity',coalesce(sum(i.quantity),0),
   'weight_kg',coalesce(sum(i.weight_kg),0),'pallet_count',coalesce(sum(i.pallet_count),0),
   'volume_m3',coalesce(sum(i.volume_m3),0),'source',coalesce(min(i.source),'none')) physical
  from (
   select i.quantity,i.weight_kg,i.pallet_count,i.volume_m3,'load_items'::text source
   from public.load_items i where i.tenant_id=_tenant and i.fiscal_document_id=a.fiscal_document_id
    and i.load_id is not distinct from a.load_id and i.delivery_attempt_id is not distinct from a.delivery_attempt_id
   union all
   select (j->>'quantity')::numeric,(j->>'weight_kg')::numeric,(j->>'pallet_count')::numeric,
    (j->>'volume_m3')::numeric,'reserved_attempt'::text
   from public.delivery_attempts attempt cross join lateral jsonb_array_elements(attempt.items) j
   where attempt.id=a.delivery_attempt_id and attempt.tenant_id=_tenant and attempt.fiscal_document_id=a.fiscal_document_id
    and a.load_id is null and not exists(select 1 from public.load_items i
     where i.tenant_id=_tenant and i.fiscal_document_id=a.fiscal_document_id and i.delivery_attempt_id=a.delivery_attempt_id)
  ) i
 ) li on true
 where a.document->>'document_type'='inbound' and a.document->>'deleted_at' is null
  and not coalesce((a.document->>'is_duplicate')::boolean,false)
 )
 select jsonb_build_object(
  'key',coalesce(allocation_id::text,'unallocated:'||fiscal_document_id::text||':'||coalesce(delivery_attempt_id::text,'original')),
  'allocation_id',allocation_id,'attempt_id',delivery_attempt_id,'historical',historical,
  'document',jsonb_build_object('id',fiscal_document_id,'load_id',load_id,'client_id',document->'client_id',
   'invoice_number',document->'invoice_number','access_key',document->'access_key','issue_date',document->'issue_date',
   'origin_city',document->'origin_city','origin_state',document->'origin_state','remitter',document->'remitter',
   'remitter_cnpj',document->'remitter_cnpj','recipient',document->'recipient','recipient_cnpj',document->'recipient_cnpj',
   'recipient_city',document->'recipient_city','recipient_state',document->'recipient_state',
   'value',coalesce((document->>'value')::numeric,0),'weight_kg',coalesce((document->>'weight_kg')::numeric,0),
   'volume_count',case when delivery_attempt_id is null then coalesce((document->>'volume_count')::numeric,0) else 0 end,
   'freight_value',case when delivery_attempt_id is null then coalesce((document->>'freight_value')::numeric,0) else 0 end,
   'freight_cif_value',case when delivery_attempt_id is null then coalesce((document->>'freight_cif_value')::numeric,0) else 0 end,
   'freight_fob_value',case when delivery_attempt_id is null then coalesce((document->>'freight_fob_value')::numeric,0) else 0 end,
   'outbound_cte_id',document->'cte_emitted_outbound_id'),
  'load',case when load_number is null and external_load_number is null and load_id is null then null else
   jsonb_build_object('id',load_id,'load_number',coalesce(load_number,external_load_number),
    'arrival_date',arrival_date,'departure_at',gate_departure_at,'arrival_at',arrival_at,
    'vehicle_id',vehicle_id,'vehicle_plate',plate,'driver_id',driver_id,'driver_name',driver_name) end,
  'outcome',case when outcome_id is null then null else jsonb_build_object('id',outcome_id,'status',outcome,
   'occurred_at',occurred_at,'recorded_at',recorded_at,'source',outcome_source,'event_id',event_id,
   'trip_id',dispatch_trip_id,'stop_id',dispatch_stop_id) end,
  'physical',physical,
  'financial_review_required',delivery_attempt_id is not null,
  'volume_count_verified',delivery_attempt_id is null
 ) from rows;
$fn$;
revoke all on function public._closing_attempt_document_sources(uuid) from public,anon,authenticated,service_role;

create function public.get_closing_report_sources(_tenant_id uuid,_filters jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_filters jsonb;v_start date;v_end date;v_basis text;v_client uuid;v_vehicle uuid;v_driver uuid;
 v_delivered boolean;v_sources jsonb;v_ctes jsonb;v_related jsonb;v_result jsonb;
begin
 if auth.uid() is null or _tenant_id is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
  raise exception 'closing_sources_not_authorized' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_filters) k
  where k not in('period_start','period_end','date_basis','client_id','vehicle_id','driver_id','only_delivered'))
  or jsonb_typeof(_filters->'period_start') is distinct from 'string'
  or jsonb_typeof(_filters->'period_end') is distinct from 'string'
  or (_filters ? 'only_delivered' and jsonb_typeof(_filters->'only_delivered') is distinct from 'boolean') then
  raise exception 'closing_sources_invalid_filters' using errcode='22023';end if;
 if (_filters->>'period_start')!~'^\d{4}-\d{2}-\d{2}$' or (_filters->>'period_end')!~'^\d{4}-\d{2}-\d{2}$' then
  raise exception 'closing_sources_invalid_period' using errcode='22023';end if;
 v_start:=(_filters->>'period_start')::date;v_end:=(_filters->>'period_end')::date;
 v_basis:=coalesce(_filters->>'date_basis','invoice_issue');
 v_client:=(_filters->>'client_id')::uuid;v_vehicle:=(_filters->>'vehicle_id')::uuid;v_driver:=(_filters->>'driver_id')::uuid;
 v_delivered:=coalesce((_filters->>'only_delivered')::boolean,false);
 if v_start>v_end or v_end-v_start>366 or v_basis not in('invoice_issue','delivery_result') then
  raise exception 'closing_sources_invalid_period' using errcode='22023';end if;
 v_filters:=jsonb_build_object('period_start',v_start,'period_end',v_end,'date_basis',v_basis,
  'client_id',v_client,'vehicle_id',v_vehicle,'driver_id',v_driver,'only_delivered',v_delivered);
 with selected as (
  select source from public._closing_attempt_document_sources(_tenant_id)
  where (case when v_basis='invoice_issue' then (source->'document'->>'issue_date')::date
   else ((source->'outcome'->>'occurred_at')::timestamptz at time zone 'America/Sao_Paulo')::date end) between v_start and v_end
   and (v_client is null or source->'document'->>'client_id'=v_client::text)
   and (v_vehicle is null or source->'load'->>'vehicle_id'=v_vehicle::text)
   and (v_driver is null or source->'load'->>'driver_id'=v_driver::text)
   and (not v_delivered or source->'outcome'->>'status'='delivered')
  order by source->>'key' limit 501
 ) select coalesce(jsonb_agg(source order by source->>'key'),'[]') into v_sources from selected;
 if jsonb_array_length(v_sources)>500 then raise exception 'closing_sources_refine_filters' using errcode='54000';end if;

 -- A reused NF is NOT evidence that the old CT-e covers a new attempt.
 -- Include non-billable candidates for diagnostics, not as accepted charges.
 select coalesce(jsonb_agg(j order by j->>'kind',j->>'id'),'[]') into v_ctes from (
  select jsonb_build_object('kind','cte_document','id',c.id,'number',c.cte_number,'access_key',c.access_key,
   'freight_value',c.freight_value,'status',c.status,'sefaz_status',c.sefaz_status,'environment',c.sefaz_environment,
   'cancelled_at',c.cancelled_at,'is_voided',c.is_voided,'receivable_id',c.receivable_id,
   'load_ids',c.load_ids,'document_ids',c.fiscal_document_ids) j
  from public.cte_documents c where c.tenant_id=_tenant_id and exists(
   select 1 from jsonb_array_elements(v_sources) s where s->>'attempt_id' is null
    and (s->'document'->>'id')::uuid=any(c.fiscal_document_ids)
    and (s->'document'->>'load_id')::uuid=any(c.load_ids))
  union all
  select jsonb_build_object('kind','outbound_document','id',f.id,'number',f.invoice_number,'access_key',f.access_key,
   'freight_value',f.freight_value,'status',f.status,'sefaz_status',f.sefaz_status,
   'environment',null,'cancelled_at',null,'is_voided',f.deleted_at is not null,'receivable_id',null,
   'load_ids',jsonb_build_array(f.load_id),'document_ids',coalesce((select jsonb_agg(s->'document'->'id')
    from public._closing_attempt_document_sources(_tenant_id) r cross join lateral (select r.source s) x
    where s->>'attempt_id' is null and s->'document'->>'outbound_cte_id'=f.id::text
     and s->'document'->>'load_id'=f.load_id::text),'[]'::jsonb)) j
  from public.fiscal_documents f where f.tenant_id=_tenant_id and f.document_type='outbound' and exists(
   select 1 from jsonb_array_elements(v_sources) s where s->>'attempt_id' is null
    and s->'document'->>'outbound_cte_id'=f.id::text and s->'document'->>'load_id'=f.load_id::text)
 ) candidates;

 -- The rateio denominator is the entire linked original-attempt universe,
 -- before client/date/vehicle filters. Never silently prorate a filtered subset.
 with related as (
  select r.source from public._closing_attempt_document_sources(_tenant_id) r
  where r.source->>'attempt_id' is null and exists(
   select 1 from jsonb_array_elements(v_ctes) c where c->'document_ids' ? (r.source->'document'->>'id')
    and c->'load_ids' ? (r.source->'document'->>'load_id'))
  order by r.source->>'key' limit 2001
 ) select coalesce(jsonb_agg(source order by source->>'key'),'[]') into v_related from related;
 if jsonb_array_length(v_related)>2000 or jsonb_array_length(v_ctes)>500 then
  raise exception 'closing_sources_refine_fiscal_scope' using errcode='54000';end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'filters',v_filters,
  'documents',v_sources,'fiscal_candidates',v_ctes,'allocation_documents',v_related,'complete',true);
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;
$fn$;
revoke all on function public.get_closing_report_sources(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_closing_report_sources(uuid,jsonb) to authenticated;

-- LOCAL CANDIDATE. Atomic report creation; no fiscal transmission/payment.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public.get_closing_report_sources(uuid,jsonb)') is null
  or to_regclass('public.closing_report_creation_requests') is not null then
  raise exception 'Atomic closing requires the source contract and an unapplied migration';end if;
end;$guard$;

create function public._closing_fiscal_eligible(c jsonb) returns boolean language sql immutable security invoker set search_path='' as $fn$
 select coalesce(c->>'environment'='production' and c->>'status'='authorized' and c->>'sefaz_status'='authorized'
  and c->>'cancelled_at' is null and c->'is_voided'='false'::jsonb and (c->>'freight_value')::numeric>=0,false);
$fn$;
revoke all on function public._closing_fiscal_eligible(jsonb) from public,anon,authenticated,service_role;

create function public._closing_freight_share(c jsonb,s jsonb,universe jsonb,mode text)
returns numeric language plpgsql immutable security invoker set search_path='' as $fn$
declare docs jsonb;n int;v_total numeric;v_value numeric;begin
 if not public._closing_fiscal_eligible(c) or jsonb_typeof(c->'document_ids') is distinct from 'array'
  or jsonb_array_length(c->'document_ids')=0 then return null;end if;
 n:=jsonb_array_length(c->'document_ids');
 select coalesce(jsonb_agg(d),'[]') into docs from jsonb_array_elements(universe) d where d->>'attempt_id' is null
  and c->'document_ids' ? (d#>>'{document,id}') and c->'load_ids' ? (d#>>'{document,load_id}');
 if jsonb_array_length(docs)<>n or (select count(distinct value) from jsonb_array_elements(c->'document_ids'))<>n
  or (select count(distinct d#>>'{document,id}') from jsonb_array_elements(docs) d)<>n
  or not exists(select 1 from jsonb_array_elements(docs) d where d->>'key'=s->>'key') then return null;end if;
 v_total:=round((c->>'freight_value')::numeric,2);
 if mode='first_nf_only' then return case when s#>>'{document,id}'=c#>>'{document_ids,0}' then v_total else 0 end;end if;
 with weights as (
  select d->>'key' key,round((d->'document'->>case when mode='cte_by_weight' then 'weight_kg' else 'value' end)::numeric,3)*1000 weight
  from jsonb_array_elements(docs) d
 ), shares as (
  select key,weight,sum(weight) over() denominator from weights
 ), fractions as (
  select key,weight,denominator,floor(v_total*100*weight/nullif(denominator,0)) cents,
   mod(v_total*100*weight,nullif(denominator,0)) remainder from shares
 ), ranked as (
  select *,row_number() over(order by remainder desc,key collate "C") rank,
   v_total*100-sum(cents) over() remainder_cents from fractions
 ) select (cents+case when rank<=remainder_cents then 1 else 0 end)/100 into v_value from ranked
 where key=s->>'key' and denominator>0 and not exists(select 1 from weights where weight<0);
 return v_value;
end;$fn$;
revoke all on function public._closing_freight_share(jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function public._project_closing_source_items(sources jsonb,options jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare s jsonb;d jsonb;l jsonb;c jsonb;candidate jsonb;v_item jsonb;v_items jsonb:='[]';v_candidates int;v_accepted int;
 v_mode text:=coalesce(options->>'allocation','per_nf');v_only boolean:=coalesce((options->>'only_with_cte')::boolean,false);
 v_review boolean;v_freight numeric;v_order int:=0;
begin
 if jsonb_typeof(options) is distinct from 'object' or exists(select 1 from jsonb_object_keys(options) k where k not in('allocation','only_with_cte'))
  or v_mode not in('per_nf','cte_by_value','cte_by_weight','first_nf_only')
  or (options ? 'only_with_cte' and jsonb_typeof(options->'only_with_cte')<>'boolean') then
  raise exception 'closing_invalid_options' using errcode='22023';end if;
 if (select count(distinct jsonb_build_array(source_row#>>'{document,id}',source_row->>'attempt_id')) from jsonb_array_elements(sources->'documents') source_row)
  <>jsonb_array_length(sources->'documents') then raise exception 'closing_duplicate_attempt_allocation' using errcode='23514';end if;
 for s in select value from jsonb_array_elements(sources->'documents') loop
  d:=s->'document';l:=s->'load';c:=null;v_candidates:=0;v_accepted:=0;
  for candidate in select value from jsonb_array_elements(sources->'fiscal_candidates') where s->>'attempt_id' is null
   and value->'document_ids' ? (d->>'id') and value->'load_ids' ? (d->>'load_id') loop
   v_candidates:=v_candidates+1;
   if public._closing_fiscal_eligible(candidate) then c:=candidate;v_accepted:=v_accepted+1;end if;
  end loop;
  if v_accepted<>1 then c:=null;end if;
  if v_only and c is null then continue;end if;
  v_review:=coalesce((s->>'financial_review_required')::boolean,false) or v_candidates<>v_accepted or v_accepted>1 or c->>'receivable_id' is not null;
  v_freight:=(d->>'freight_value')::numeric;
  if s->>'attempt_id' is not null then v_freight:=0;v_review:=true;
  elsif v_mode<>'per_nf' then
   v_freight:=case when c is null then null else public._closing_freight_share(c,s,sources->'allocation_documents',v_mode) end;
   if v_freight is null then v_review:=true;v_freight:=0;end if;
  end if;
  if v_freight<0 then v_freight:=0;v_review:=true;end if;
  v_item:=jsonb_build_object('fiscal_document_id',d->'id','cte_document_id',case when c->>'kind'='cte_document' then c->'id' else null end,
   'load_id',d->'load_id','origin_city',d->'origin_city','origin_state',d->'origin_state','remitter_name',d->'remitter','remitter_cnpj',d->'remitter_cnpj',
   'recipient_name',d->'recipient','recipient_cnpj',d->'recipient_cnpj','destination_city',d->'recipient_city','destination_state',d->'recipient_state',
   'issue_date',d->'issue_date','arrival_date',l->'arrival_date','delivery_date',case when s#>>'{outcome,status}'='delivered'
    then ((s#>>'{outcome,occurred_at}')::timestamptz at time zone 'America/Sao_Paulo')::date else null end,
   'invoice_number',d->'invoice_number','invoice_key',d->'access_key','cte_number',c->'number','cte_key',c->'access_key','load_number',l->'load_number',
   'invoice_value',(d->>'value')::numeric,'weight_kg',case when (s#>>'{physical,item_count}')::int>0 then (s#>>'{physical,weight_kg}')::numeric else (d->>'weight_kg')::numeric end,
   'volume_count',case when (s->>'volume_count_verified')::boolean then (d->>'volume_count')::numeric else 0 end,
   'freight_value',round(v_freight,2),'freight_cif_value',(d->>'freight_cif_value')::numeric,'freight_fob_value',(d->>'freight_fob_value')::numeric,
   'delivery_status',s#>'{outcome,status}','observation',null,'source_type','system','sort_order',v_order,
   'vehicle_id',l->'vehicle_id','vehicle_plate',l->'vehicle_plate','driver_id',l->'driver_id','driver_name',l->'driver_name',
   'departure_at',l->'departure_at','arrival_at_ts',l->'arrival_at','route_label',d->'recipient_city','route_complement',d->'origin_city',
   'metadata',jsonb_build_object('version',1,'source_key',s->'key','allocation_id',s->'allocation_id','attempt_id',s->'attempt_id','historical',s->'historical',
    'outcome_id',s#>'{outcome,id}','occurred_at',s#>'{outcome,occurred_at}','physical_source',s#>'{physical,source}',
    'volume_count_verified',s->'volume_count_verified','fiscal_source_kind',c->'kind','fiscal_source_id',c->'id',
    'financial_review_required',v_review,'freight_allocation_mode',v_mode));
  v_items:=v_items||jsonb_build_array(v_item);v_order:=v_order+1;
 end loop;
 if exists(select 1 from jsonb_array_elements(v_items) i group by coalesce(nullif(i->>'invoice_key',''),i->>'fiscal_document_id')
  having min(round((i->>'invoice_value')::numeric,2))<>max(round((i->>'invoice_value')::numeric,2))) then
  raise exception 'closing_conflicting_invoice_values' using errcode='23514';end if;
 return v_items;
end;$fn$;
revoke all on function public._project_closing_source_items(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public._closing_item_totals(items jsonb) returns jsonb language sql immutable security invoker set search_path='' as $fn$
 with rows as (select i,coalesce(nullif(i->>'invoice_key',''),i->>'fiscal_document_id',i->>'sort_order') identity from jsonb_array_elements(items) i),
 invoices as (select identity,max(round((i->>'invoice_value')::numeric,2)) value from rows group by identity)
 select jsonb_build_object('total_invoice_value',coalesce((select sum(value) from invoices),0),
  'total_freight_value',coalesce(sum(round((i->>'freight_value')::numeric,2)),0),'total_weight_kg',coalesce(sum((i->>'weight_kg')::numeric),0),
  'total_volume',coalesce(sum((i->>'volume_count')::numeric),0),'fiscal_document_count',(select count(*) from invoices),
  'cte_count',count(distinct i#>>'{metadata,fiscal_source_id}'),'load_count',count(distinct i->>'load_id'),'attempt_count',count(*)) from rows;
$fn$;
revoke all on function public._closing_item_totals(jsonb) from public,anon,authenticated,service_role;

create function public._closing_item_summaries(items jsonb) returns jsonb language sql immutable security invoker set search_path='' as $fn$
 with groups as (
  select g.kind,coalesce(i->>g.kind,case when g.kind='arrival_date' then 'Sem data' else 'Sem destino' end) label,jsonb_agg(i) rows
  from jsonb_array_elements(items) i cross join(values('arrival_date'),('destination_city')) g(kind) group by 1,2
 ) select coalesce(jsonb_agg(public._closing_item_totals(rows)||jsonb_build_object('group_type',kind,'group_label',label) order by kind,label),'[]') from groups;
$fn$;
revoke all on function public._closing_item_summaries(jsonb) from public,anon,authenticated,service_role;

create function public._closing_import_content(input jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare row jsonb;k text;v_items jsonb:='[]';v_summary jsonb:='[]';v_totals jsonb;v_order int:=0;v_item jsonb;begin
 if jsonb_typeof(input) is distinct from 'object' or coalesce(input->>'model','') not in('summary','detailed')
  or jsonb_typeof(input->'rows') is distinct from 'array' or jsonb_array_length(input->'rows') not between 1 and 500
  or jsonb_typeof(input->'file_name') is distinct from 'string' or coalesce(length(input->>'file_name'),0) not between 1 and 255
  or exists(select 1 from jsonb_object_keys(input) field where field not in('model','file_name','rows')) then
  raise exception 'closing_invalid_import' using errcode='22023';end if;
 for row in select value from jsonb_array_elements(input->'rows') loop
  if jsonb_typeof(row) is distinct from 'object' or exists(select 1 from jsonb_each(row) p where p.key not in(
   'origin','remitter','recipient','destination','issue_date','invoice_number','cte_number','invoice_value','weight_kg','freight_value','delivery_date','observation','arrival_date','billing_period')) then
   raise exception 'closing_invalid_import_row' using errcode='22023';end if;
  if input->>'model'='summary' and (not (row ?& array['arrival_date','billing_period','invoice_value','weight_kg']) or
   exists(select 1 from jsonb_object_keys(row) field where field not in('arrival_date','billing_period','invoice_value','weight_kg'))) then
   raise exception 'closing_invalid_import_summary' using errcode='22023';end if;
  if input->>'model'='detailed' and (not (row ?& array['origin','remitter','recipient','destination','issue_date','invoice_number','cte_number','invoice_value','weight_kg','freight_value','delivery_date','observation']) or row ?| array['arrival_date','billing_period']) then
   raise exception 'closing_invalid_import_detail' using errcode='22023';end if;
  foreach k in array array['invoice_value','weight_kg','freight_value'] loop
   if k<>'freight_value' or input->>'model'='detailed' then
    if jsonb_typeof(row->k) is distinct from 'number' or (row->>k)::numeric not between 0 and 999999999999.99 then
     raise exception 'closing_invalid_import_amount' using errcode='22023';end if;
   end if;
  end loop;
  for k in select key from jsonb_object_keys(row) key where key not in('invoice_value','weight_kg','freight_value') loop
   if jsonb_typeof(row->k) not in('null','string') or length(row->>k)>2000 then raise exception 'closing_invalid_import_text' using errcode='22023';end if;
   if k in('issue_date','delivery_date','arrival_date') and row->>k is not null then
    if (row->>k)!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'closing_invalid_import_date' using errcode='22023';end if;perform (row->>k)::date;
   end if;
  end loop;
  if input->>'model'='summary' then
   v_summary:=v_summary||jsonb_build_array(jsonb_build_object('group_type','billing_period',
    'group_label',coalesce(row->>'arrival_date','Sem data')||' · '||coalesce(row->>'billing_period','Sem período'),
    'arrival_date',row->'arrival_date','billing_period_label',row->'billing_period','total_invoice_value',round((row->>'invoice_value')::numeric,2),
    'total_weight_kg',round((row->>'weight_kg')::numeric,3),'total_freight_value',0,'total_volume',0,
    'load_count',0,'fiscal_document_count',0,'cte_count',0,'sort_order',v_order));
  else
   v_item:=jsonb_build_object('fiscal_document_id',null,'cte_document_id',null,'load_id',null,'source_type','spreadsheet_import',
    'origin_city',row->'origin','remitter_name',row->'remitter','recipient_name',row->'recipient','destination_city',row->'destination',
    'issue_date',row->'issue_date','invoice_number',row->'invoice_number','cte_number',row->'cte_number',
    'invoice_value',round((row->>'invoice_value')::numeric,2),'weight_kg',round((row->>'weight_kg')::numeric,3),
    'freight_value',round((row->>'freight_value')::numeric,2),'freight_cif_value',0,'freight_fob_value',0,'volume_count',0,
    'delivery_date',row->'delivery_date','delivery_status','imported_unverified','observation',row->'observation','sort_order',v_order,
    'metadata',jsonb_build_object('version',1,'source','spreadsheet','operationally_verified',false,'financial_review_required',true));
   v_items:=v_items||jsonb_build_array(v_item);
  end if;v_order:=v_order+1;
 end loop;
 if input->>'model'='summary' then
  select jsonb_build_object('total_invoice_value',sum((s->>'total_invoice_value')::numeric),'total_weight_kg',sum((s->>'total_weight_kg')::numeric),
   'total_freight_value',0,'total_volume',0,'load_count',0,'fiscal_document_count',0,'cte_count',0,'attempt_count',0) into v_totals from jsonb_array_elements(v_summary) s;
 else v_totals:=public._closing_item_totals(v_items);v_summary:=public._closing_item_summaries(v_items);end if;
 return jsonb_build_object('items',v_items,'summary',v_summary,'totals',v_totals);
end;$fn$;
revoke all on function public._closing_import_content(jsonb) from public,anon,authenticated,service_role;

create function public._lock_closing_sources(_tenant uuid,sources jsonb) returns void language plpgsql security invoker set search_path='' as $fn$
declare v_docs uuid[];v_loads uuid[];begin
 select array_agg(distinct (d#>>'{document,id}')::uuid),array_agg(distinct (d#>>'{document,load_id}')::uuid) into v_docs,v_loads
 from jsonb_array_elements((sources->'documents')||(sources->'allocation_documents')) d;
 -- No lock is waited for after membership: readers must not form a reverse
 -- dependency with driver/operation writers which hold trip -> load -> document.
 perform t.id from public.dispatch_trips t where t.tenant_id=_tenant and t.id in(select trip_id from public.loads where tenant_id=_tenant and id=any(v_loads)) order by t.id for share nowait;
 perform l.id from public.loads l where l.tenant_id=_tenant and l.id=any(v_loads) order by l.id for share nowait;
 perform f.id from public.fiscal_documents f where f.tenant_id=_tenant and (f.id=any(v_docs) or f.id in(
  select (c->>'id')::uuid from jsonb_array_elements(sources->'fiscal_candidates') c where c->>'kind'='outbound_document')) order by f.id for share nowait;
 perform i.id from public.load_items i where i.tenant_id=_tenant and i.fiscal_document_id=any(v_docs) order by i.id for share nowait;
 perform c.id from public.cte_documents c where c.tenant_id=_tenant and c.id in(select (c->>'id')::uuid from jsonb_array_elements(sources->'fiscal_candidates') c where c->>'kind'='cte_document') order by c.id for share nowait;
 perform v.id from public.vehicles v where v.tenant_id=_tenant and v.id in(select vehicle_id from public.loads where tenant_id=_tenant and id=any(v_loads)) order by v.id for share nowait;
 perform d.id from public.drivers d where d.tenant_id=_tenant and d.id in(select driver_id from public.loads where tenant_id=_tenant and id=any(v_loads)) order by d.id for share nowait;
end;$fn$;
revoke all on function public._lock_closing_sources(uuid,jsonb) from public,anon,authenticated,service_role;

create table public.closing_report_creation_requests(
 tenant_id uuid not null references public.tenants(id),actor_id uuid not null,request_id uuid not null,
 closing_report_id uuid not null,payload_hash text not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,actor_id,request_id),foreign key(tenant_id,closing_report_id) references public.closing_reports(tenant_id,id)
);
create index closing_creation_report_idx on public.closing_report_creation_requests(tenant_id,closing_report_id);
alter table public.closing_report_creation_requests enable row level security;
revoke all on public.closing_report_creation_requests from public,anon,authenticated,service_role;
grant select on public.closing_report_creation_requests to authenticated;
create policy closing_creation_actor_read on public.closing_report_creation_requests for select to authenticated
 using(actor_id=(select auth.uid()) and public.is_tenant_operator_or_admin(tenant_id));
create function public._preserve_closing_creation() returns trigger language plpgsql security invoker set search_path='' as $fn$
 begin raise exception 'Closing creation acknowledgement is append-only' using errcode='55000';end;$fn$;
revoke all on function public._preserve_closing_creation() from public,anon,authenticated,service_role;
create trigger preserve_closing_creation before update or delete on public.closing_report_creation_requests for each row execute function public._preserve_closing_creation();

create function public.create_closing_report_draft(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid();tenant uuid;request uuid;h public.closing_reports%rowtype;r public.closing_reports%rowtype;
 previous public.closing_report_creation_requests%rowtype;payload_hash text;mode text;sources jsonb;fresh jsonb;items jsonb;summary jsonb;totals jsonb;
 snapshot jsonb;content jsonb;reason text;result jsonb;review boolean;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>1048576 or _payload->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','actor_id','request_id','mode','header','system','import','reason')) then
  raise exception 'closing_invalid_request' using errcode='22023';end if;
 tenant:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;mode:=_payload->>'mode';reason:=btrim(_payload->>'reason');
 if actor is null or actor::text is distinct from _payload->>'actor_id' or tenant is null or not coalesce(public.is_tenant_operator_or_admin(tenant),false) then raise exception 'closing_not_authorized' using errcode='42501';end if;
 if request is null or coalesce(mode,'') not in('system','spreadsheet') or jsonb_typeof(_payload->'reason') is distinct from 'string' or coalesce(length(reason),0) not between 5 and 2000
  or jsonb_typeof(_payload->'header') is distinct from 'object' or exists(select 1 from jsonb_object_keys(_payload->'header') k
   where k not in('client_id','payer_client_id','title','report_type','report_model','period_start','period_end','expected_payment_date','notes'))
  or exists(select 1 from jsonb_each(_payload->'header') p where jsonb_typeof(p.value) not in('string','null')) then
  raise exception 'closing_invalid_header' using errcode='22023';end if;
 h:=jsonb_populate_record(null::public.closing_reports,_payload->'header');
 if coalesce(length(btrim(h.title)),0) not between 1 and 250 or coalesce(h.report_type,'') not in('weekly','ten_day','fortnightly','monthly','custom')
  or coalesce(h.report_model,'') not in('summary','detailed','combined') or h.period_start is null or h.period_end is null or not isfinite(h.period_start) or not isfinite(h.period_end)
  or h.period_start>h.period_end or h.period_end-h.period_start>366 or length(h.notes)>5000 or (h.expected_payment_date is not null and not isfinite(h.expected_payment_date)) then
  raise exception 'closing_invalid_header' using errcode='22023';end if;
 payload_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('create_closing_report_draft'),hashtext(tenant::text||':'||actor::text||':'||request::text));
 perform tenant_id from public.tenant_memberships where tenant_id=tenant and user_id=actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'closing_not_authorized' using errcode='42501';end if;
 select * into previous from public.closing_report_creation_requests where tenant_id=tenant and actor_id=actor and request_id=request;
 if found then
  if previous.payload_hash is distinct from payload_hash then raise exception 'closing_request_key_mismatch' using errcode='22023';end if;
  return previous.response;
 end if;
 perform id from public.clients where tenant_id=tenant and id in(h.client_id,h.payer_client_id) order by id for share nowait;
 if (h.client_id is not null and not exists(select 1 from public.clients where id=h.client_id and tenant_id=tenant))
  or (h.payer_client_id is not null and not exists(select 1 from public.clients where id=h.payer_client_id and tenant_id=tenant)) then
  raise exception 'closing_client_not_in_tenant' using errcode='23514';end if;
 if mode='system' then
  if _payload ? 'import' or jsonb_typeof(_payload->'system') is distinct from 'object' or exists(select 1 from jsonb_object_keys(_payload->'system') k where k not in('filters','options','revision')) then
   raise exception 'closing_invalid_system_source' using errcode='22023';end if;
  sources:=public.get_closing_report_sources(tenant,_payload#>'{system,filters}');
  if sources->>'revision' is distinct from _payload#>>'{system,revision}' then raise exception 'closing_source_changed' using errcode='40001';end if;
  perform public._lock_closing_sources(tenant,sources);
  fresh:=public.get_closing_report_sources(tenant,_payload#>'{system,filters}');
  if fresh->>'revision' is distinct from sources->>'revision' then raise exception 'closing_source_changed' using errcode='40001';end if;
  if h.period_start::text is distinct from fresh#>>'{filters,period_start}' or h.period_end::text is distinct from fresh#>>'{filters,period_end}'
   or h.client_id::text is distinct from fresh#>>'{filters,client_id}' then raise exception 'closing_header_filter_mismatch' using errcode='22023';end if;
  items:=public._project_closing_source_items(fresh,_payload#>'{system,options}');
  if jsonb_array_length(items)=0 then raise exception 'closing_no_items' using errcode='23514';end if;
  select jsonb_agg(i||jsonb_build_object('metadata',(i->'metadata')||jsonb_build_object('source_fingerprint',md5(public._closing_source_fact(i)::text)))) into items from jsonb_array_elements(items) i;
  totals:=public._closing_item_totals(items);summary:=public._closing_item_summaries(items);
  select coalesce(bool_or((i#>>'{metadata,financial_review_required}')::boolean),false) into review from jsonb_array_elements(items) i;
  snapshot:=jsonb_build_object('contract','closing_attempts_v1','mode',mode,'filters',fresh->'filters','options',_payload#>'{system,options}',
   'source_revision',fresh->'revision','source_actor_id',actor,'financial_review_required',review,'reason',reason);
 else
  if _payload ? 'system' then raise exception 'closing_invalid_import' using errcode='22023';end if;
  content:=public._closing_import_content(_payload->'import');items:=content->'items';summary:=content->'summary';totals:=content->'totals';
  if h.report_model is distinct from _payload#>>'{import,model}' then raise exception 'closing_import_model_mismatch' using errcode='22023';end if;
  snapshot:=jsonb_build_object('contract','closing_attempts_v1','mode',mode,'file_name',_payload#>'{import,file_name}',
   'source_actor_id',actor,'financial_review_required',true,'operationally_verified',false,'reason',reason);
 end if;
 insert into public.closing_reports(tenant_id,client_id,payer_client_id,closing_number,title,report_type,report_model,period_start,period_end,
  expected_payment_date,notes,total_invoice_value,total_freight_value,total_weight_kg,total_volume,fiscal_document_count,cte_count,load_count,
  gross_amount,total_amount,open_amount,filters_snapshot,totals_snapshot,created_by,updated_by)
 values(tenant,h.client_id,h.payer_client_id,public.next_closing_report_number(tenant,h.period_end),btrim(h.title),h.report_type,h.report_model,h.period_start,h.period_end,
  h.expected_payment_date,h.notes,(totals->>'total_invoice_value')::numeric,(totals->>'total_freight_value')::numeric,(totals->>'total_weight_kg')::numeric,(totals->>'total_volume')::numeric,
  (totals->>'fiscal_document_count')::int,(totals->>'cte_count')::int,(totals->>'load_count')::int,
  (totals->>'total_freight_value')::numeric,(totals->>'total_freight_value')::numeric,(totals->>'total_freight_value')::numeric,snapshot,totals,actor,actor) returning * into r;
 insert into public.closing_report_items(tenant_id,closing_report_id,fiscal_document_id,cte_document_id,load_id,source_type,origin_city,origin_state,
  remitter_name,remitter_cnpj,recipient_name,recipient_cnpj,destination_city,destination_state,issue_date,arrival_date,delivery_date,invoice_number,invoice_key,cte_number,cte_key,load_number,
  invoice_value,weight_kg,volume_count,freight_value,freight_cif_value,freight_fob_value,delivery_status,observation,sort_order,metadata,
  vehicle_id,vehicle_plate,driver_id,driver_name,departure_at,arrival_at_ts,route_label,route_complement)
 select tenant,r.id,i.fiscal_document_id,i.cte_document_id,i.load_id,i.source_type,i.origin_city,i.origin_state,i.remitter_name,i.remitter_cnpj,i.recipient_name,i.recipient_cnpj,
  i.destination_city,i.destination_state,i.issue_date,i.arrival_date,i.delivery_date,i.invoice_number,i.invoice_key,i.cte_number,i.cte_key,i.load_number,
  i.invoice_value,i.weight_kg,i.volume_count,i.freight_value,i.freight_cif_value,i.freight_fob_value,i.delivery_status,i.observation,i.sort_order,i.metadata,
  i.vehicle_id,i.vehicle_plate,i.driver_id,i.driver_name,i.departure_at,i.arrival_at_ts,i.route_label,i.route_complement
 from jsonb_populate_recordset(null::public.closing_report_items,items) i;
 insert into public.closing_report_summary_lines(tenant_id,closing_report_id,group_type,group_label,arrival_date,billing_period_label,
  total_invoice_value,total_freight_value,total_weight_kg,total_volume,load_count,fiscal_document_count,cte_count,sort_order)
 select tenant,r.id,s.group_type,s.group_label,s.arrival_date,s.billing_period_label,s.total_invoice_value,s.total_freight_value,s.total_weight_kg,s.total_volume,
  s.load_count,s.fiscal_document_count,s.cte_count,(row_number() over())::int-1 from jsonb_populate_recordset(null::public.closing_report_summary_lines,summary) s;
 update public.closing_reports set vehicle_plates_snapshot=coalesce((select array_agg(distinct upper(vehicle_plate)) from public.closing_report_items where closing_report_id=r.id and nullif(vehicle_plate,'') is not null),'{}'),
  driver_names_snapshot=coalesce((select array_agg(distinct upper(driver_name)) from public.closing_report_items where closing_report_id=r.id and nullif(driver_name,'') is not null),'{}') where id=r.id;
 insert into public.closing_report_history(tenant_id,closing_report_id,action,reason,metadata,created_by)
 values(tenant,r.id,'created',reason,jsonb_build_object('request_id',request,'contract','closing_attempts_v1','mode',mode,'source_revision',snapshot->'source_revision'),actor);
 result:=jsonb_build_object('version',1,'status','confirmed','tenant_id',tenant,'actor_id',actor,'request_id',request,
  'report',jsonb_build_object('id',r.id,'closing_number',r.closing_number,'status','draft'),'mode',mode,'source_revision',snapshot->'source_revision',
  'item_count',jsonb_array_length(items),'summary_count',jsonb_array_length(summary),'totals',totals);
 insert into public.closing_report_creation_requests(tenant_id,actor_id,request_id,closing_report_id,payload_hash,response)
 values(tenant,actor,request,r.id,payload_hash,result);
 return result;
exception when lock_not_available then raise exception 'closing_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function public.create_closing_report_draft(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_closing_report_draft(jsonb) to authenticated;

create function public._closing_source_fact(item jsonb) returns jsonb language sql immutable security invoker set search_path='' as $fn$
 select coalesce(jsonb_object_agg(key,value),'{}')||jsonb_build_object('metadata',(item->'metadata')-array['historical','source_fingerprint'])
 from jsonb_each(item) where key in('fiscal_document_id','cte_document_id','load_id','origin_city','origin_state','remitter_name','remitter_cnpj',
  'recipient_name','recipient_cnpj','destination_city','destination_state','issue_date','arrival_date','delivery_date','invoice_number','invoice_key',
  'cte_number','cte_key','load_number','invoice_value','weight_kg','volume_count','freight_value','freight_cif_value','freight_fob_value','delivery_status','source_type','vehicle_id','driver_id');
$fn$;
revoke all on function public._closing_source_fact(jsonb) from public,anon,authenticated,service_role;

create function public._assert_closing_sources_current(_report uuid) returns void language plpgsql security invoker set search_path='' as $fn$
declare r public.closing_reports%rowtype;sources jsonb;items jsonb;i public.closing_report_items%rowtype;j jsonb;begin
 select * into strict r from public.closing_reports where id=_report;
 if r.filters_snapshot->>'contract' is distinct from 'closing_attempts_v1' then return;end if;
 if (r.filters_snapshot->>'financial_review_required')::boolean then raise exception 'closing_financial_review_required' using errcode='55000';end if;
 if r.filters_snapshot->>'mode'<>'system' then raise exception 'closing_import_review_required' using errcode='55000';end if;
 sources:=public.get_closing_report_sources(r.tenant_id,r.filters_snapshot->'filters');perform public._lock_closing_sources(r.tenant_id,sources);
 sources:=public.get_closing_report_sources(r.tenant_id,r.filters_snapshot->'filters');
 items:=public._project_closing_source_items(sources,r.filters_snapshot->'options');
 for i in select * from public.closing_report_items where closing_report_id=r.id order by id loop
  select value into j from jsonb_array_elements(items) where value#>>'{metadata,source_key}'=i.metadata->>'source_key';
  if j is null or i.metadata->>'source_fingerprint' is distinct from md5(public._closing_source_fact(j)::text)
   or (j#>>'{metadata,financial_review_required}')::boolean then raise exception 'closing_source_changed_requires_review' using errcode='55000';end if;
 end loop;
end;$fn$;
revoke all on function public._assert_closing_sources_current(uuid) from public,anon,authenticated,service_role;

create function public._guard_closing_source_snapshot() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_table_name='closing_report_items' then
  if old.source_type='system' and public._closing_source_fact(to_jsonb(new)) is distinct from public._closing_source_fact(to_jsonb(old)) then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
  if new.tenant_id is distinct from old.tenant_id or new.closing_report_id is distinct from old.closing_report_id
   or new.invoice_value is distinct from old.invoice_value or new.freight_value is distinct from old.freight_value or new.metadata is distinct from old.metadata then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
 else
  if new.tenant_id is distinct from old.tenant_id or new.filters_snapshot is distinct from old.filters_snapshot or new.totals_snapshot is distinct from old.totals_snapshot
   or new.total_amount is distinct from old.total_amount or new.total_freight_value is distinct from old.total_freight_value
   or new.total_invoice_value is distinct from old.total_invoice_value or new.client_id is distinct from old.client_id
   or new.payer_client_id is distinct from old.payer_client_id or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
  if (new.status is distinct from old.status and new.status in('closed','sent','invoiced','paid','partially_paid'))
   or new.received_amount is distinct from old.received_amount or new.client_invoice_id is distinct from old.client_invoice_id then
   perform public._assert_closing_sources_current(old.id);
  end if;
 end if;return new;
end;$fn$;
revoke all on function public._guard_closing_source_snapshot() from public,anon,authenticated,service_role;
create trigger guard_closing_source_item before update on public.closing_report_items for each row execute function public._guard_closing_source_snapshot();
create trigger guard_closing_source_header before update on public.closing_reports for each row execute function public._guard_closing_source_snapshot();

create function public.mark_closing_report_sent(_tenant_id uuid,_report_id uuid,_sent_to text default null,_channel text default null)
returns void language plpgsql security definer set search_path='' as $fn$
declare r public.closing_reports%rowtype;begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'closing_not_authorized' using errcode='42501';end if;
 perform tenant_id from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'closing_not_authorized' using errcode='42501';end if;
 select * into r from public.closing_reports where id=_report_id and tenant_id=_tenant_id for update nowait;
 if not found then raise exception 'closing_report_not_found' using errcode='23514';end if;
 if r.status not in('closed','sent','invoiced') then raise exception 'closing_report_not_ready_to_send' using errcode='23514';end if;
 if length(_sent_to)>500 or length(_channel)>100 then raise exception 'closing_invalid_delivery_channel' using errcode='22023';end if;
 if r.sent_at is not null and r.sent_to is not distinct from _sent_to and r.sent_channel is not distinct from _channel then return;end if;
 perform public._assert_closing_sources_current(r.id);
 update public.closing_reports set status=case when r.status='invoiced' then 'invoiced' else 'sent' end,sent_at=clock_timestamp(),sent_to=_sent_to,sent_channel=_channel,updated_by=auth.uid(),updated_at=clock_timestamp() where id=r.id;
 insert into public.closing_report_history(tenant_id,closing_report_id,action,created_by) values(r.tenant_id,r.id,'marked_sent',auth.uid());
exception when lock_not_available then raise exception 'closing_concurrent_change' using errcode='40001';end;$fn$;
revoke all on function public.mark_closing_report_sent(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_closing_report_sent(uuid,uuid,text,text) to authenticated;

create function public.update_closing_report_trip_fields(_tenant_id uuid,_report_id uuid,_item_id uuid,_expected jsonb,_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r public.closing_reports%rowtype;i public.closing_report_items%rowtype;n public.closing_report_items%rowtype;e public.closing_report_items%rowtype;field text;v_total_km numeric;v_total_liters numeric;v_total_fuel numeric;unchanged boolean:=true;begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'closing_not_authorized' using errcode='42501';end if;
 perform tenant_id from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'closing_not_authorized' using errcode='42501';end if;
 if jsonb_typeof(_patch) is distinct from 'object' or jsonb_typeof(_expected) is distinct from 'object' or octet_length(_patch::text)>10000 or octet_length(_expected::text)>10000
  or exists(select 1 from jsonb_object_keys(_patch||_expected) k where k not in('km_initial','km_final','fuel_liters','fuel_unit_price','vehicle_plate','driver_name','departure_at','arrival_at_ts','route_label','route_complement')) then
  raise exception 'closing_invalid_trip_patch' using errcode='22023';end if;
 foreach field in array array['km_initial','km_final','fuel_liters','fuel_unit_price','vehicle_plate','driver_name','departure_at','arrival_at_ts','route_label','route_complement'] loop
  if not (_expected ? field) then raise exception 'closing_invalid_trip_expected' using errcode='22023';end if;
  if field in('km_initial','km_final','fuel_liters','fuel_unit_price') then
   if (_patch ? field and jsonb_typeof(_patch->field) not in('number','null')) or jsonb_typeof(_expected->field) not in('number','null') then
    raise exception 'closing_invalid_trip_number' using errcode='22023';end if;
  elsif (_patch ? field and jsonb_typeof(_patch->field) not in('string','null')) or jsonb_typeof(_expected->field) not in('string','null') then
   raise exception 'closing_invalid_trip_text' using errcode='22023';end if;
 end loop;
 select * into r from public.closing_reports where id=_report_id and tenant_id=_tenant_id for update nowait;
 if not found or r.status not in('draft','reviewing') then raise exception 'closing_report_not_editable' using errcode='23514';end if;
 select * into i from public.closing_report_items where id=_item_id and tenant_id=_tenant_id and closing_report_id=r.id for update nowait;
 if not found then raise exception 'closing_item_not_found' using errcode='23514';end if;
 n:=jsonb_populate_record(i,_patch);e:=jsonb_populate_record(null::public.closing_report_items,_expected);
 for field in select jsonb_object_keys(_patch) loop
  unchanged:=unchanged and (to_jsonb(i)->field is not distinct from to_jsonb(n)->field);
 end loop;
 -- A lost response can be retried as a no-op, without another audit entry.
 if unchanged then return jsonb_build_object('item_id',i.id,'report_id',r.id,'tenant_id',_tenant_id,'actor_id',auth.uid(),'fields',to_jsonb(i));end if;
 foreach field in array array['km_initial','km_final','fuel_liters','fuel_unit_price','vehicle_plate','driver_name','departure_at','arrival_at_ts','route_label','route_complement'] loop
  if to_jsonb(i)->field is distinct from to_jsonb(e)->field then raise exception 'closing_trip_context_changed' using errcode='40001';end if;
  if i.load_id is not null and exists(select 1 from public.closing_report_items sibling where sibling.closing_report_id=r.id and sibling.load_id=i.load_id
   and to_jsonb(sibling)->field is distinct from to_jsonb(i)->field) then raise exception 'closing_trip_group_requires_review' using errcode='23514';end if;
 end loop;
 if i.source_type='system' and (n.vehicle_plate is distinct from i.vehicle_plate or n.driver_name is distinct from i.driver_name
  or n.departure_at is distinct from i.departure_at or n.arrival_at_ts is distinct from i.arrival_at_ts) then
  raise exception 'closing_operational_identity_is_readonly' using errcode='23514';end if;
 if n.km_initial<0 or n.km_final<0 or n.km_final<n.km_initial or n.fuel_liters<0 or n.fuel_unit_price<0
  or n.arrival_at_ts<n.departure_at or not isfinite(n.arrival_at_ts) or not isfinite(n.departure_at)
  or n.km_initial>999999999999.99 or n.km_final>999999999999.99 or n.fuel_liters>999999999999.99 or n.fuel_unit_price>999999999999.99
  or length(n.route_label)>500 or length(n.route_complement)>500 or length(n.vehicle_plate)>30 or length(n.driver_name)>250 then
  raise exception 'closing_invalid_trip_values' using errcode='22023';end if;
 n.km_driven:=n.km_final-n.km_initial;n.fuel_total:=n.fuel_liters*n.fuel_unit_price;n.consumption_km_l:=n.km_driven/nullif(n.fuel_liters,0);
 n.days_count:=ceil(extract(epoch from n.arrival_at_ts-n.departure_at)/86400);
 -- The editor represents a trip/load, not one charge per NF. Apply shared
 -- annotations to its rows and aggregate this trip exactly once in the header.
 update public.closing_report_items set km_initial=n.km_initial,km_final=n.km_final,km_driven=n.km_driven,fuel_liters=n.fuel_liters,
  fuel_unit_price=n.fuel_unit_price,fuel_total=n.fuel_total,consumption_km_l=n.consumption_km_l,days_count=n.days_count,
  vehicle_plate=n.vehicle_plate,driver_name=n.driver_name,departure_at=n.departure_at,arrival_at_ts=n.arrival_at_ts,route_label=n.route_label,route_complement=n.route_complement
 where closing_report_id=r.id and tenant_id=_tenant_id and (id=i.id or i.load_id is not null and load_id=i.load_id);
 select sum(km),sum(liters),sum(fuel) into v_total_km,v_total_liters,v_total_fuel from(
  select coalesce(load_id::text,id::text) trip,max(km_driven) km,max(fuel_liters) liters,max(fuel_total) fuel from public.closing_report_items where closing_report_id=r.id group by 1) trips;
 update public.closing_reports set total_km_driven=coalesce(v_total_km,0),total_liters=coalesce(v_total_liters,0),total_fuel_cost=coalesce(v_total_fuel,0),
  avg_consumption_km_l=coalesce(v_total_km/nullif(v_total_liters,0),0),updated_at=clock_timestamp(),updated_by=auth.uid(),
  vehicle_plates_snapshot=coalesce((select array_agg(distinct upper(vehicle_plate)) from public.closing_report_items where closing_report_id=r.id and nullif(vehicle_plate,'') is not null),'{}'),
  driver_names_snapshot=coalesce((select array_agg(distinct upper(driver_name)) from public.closing_report_items where closing_report_id=r.id and nullif(driver_name,'') is not null),'{}') where id=r.id;
 insert into public.closing_report_history(tenant_id,closing_report_id,action,metadata,created_by) values(_tenant_id,r.id,'trip_fields_updated',jsonb_build_object('item_id',i.id,'before',_expected,'patch',_patch),auth.uid());
 return jsonb_build_object('item_id',i.id,'report_id',r.id,'tenant_id',_tenant_id,'actor_id',auth.uid(),'fields',to_jsonb(n));
exception when lock_not_available then raise exception 'closing_concurrent_change' using errcode='40001';end;$fn$;
revoke all on function public.update_closing_report_trip_fields(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_closing_report_trip_fields(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- All known browser consumers are replaced together with this migration.
revoke insert,update,delete,truncate,references,trigger on public.closing_reports,public.closing_report_items,public.closing_report_summary_lines,
 public.closing_report_history,public.closing_report_payments,public.closing_report_sequences from public,anon,authenticated;
revoke execute on function public.next_closing_report_number(uuid,date) from public,anon,authenticated;
do $policies$ declare tab text;begin
 foreach tab in array array['closing_reports','closing_report_items','closing_report_summary_lines','closing_report_history','closing_report_payments','closing_report_sequences'] loop
  execute format('create policy closing_operator_scope on public.%I as restrictive for all to authenticated using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id)) with check(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id))',tab);
 end loop;
end;$policies$;

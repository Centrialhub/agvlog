set lock_timeout='3s';
set statement_timeout='30s';
-- Additive economic coverage; no money, allocations, payment links or historical snapshots are rewritten.
do $guard$
declare expected record;p record;
begin
 if to_regclass('finance_private.expense_cost_regularizations') is null then raise exception 'finance_cost_regularization_dependency_missing' using errcode='55000';end if;
 for expected in select * from (values
 ('finance_private.canonical_trip_costs(uuid,uuid)','558bf0dac47b24791fed9c0810fdd326',false),
 ('finance_private.list_expenses(uuid,jsonb)','b79b65a61060da9e38dae0cbeca8e94f',true),
 ('finance_private.payable_effective_cost_evidence(uuid,uuid,jsonb)','2c6cc6342a2f1184b3fa892f1b38fbe2',false),
 ('finance_private.payable_portfolio(uuid,jsonb,integer,text)','c6e29a8c0d55ae3191d7e16f990fda91',true),
 ('finance_private.settlement_expense_context(uuid,uuid,integer)','62af9a434d681f81f90570ab9e9f52ba',true)
 ) x(signature,hash,authenticated) loop
 select * into p from pg_proc where oid=to_regprocedure(expected.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from expected.hash or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from expected.authenticated or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) then raise exception 'finance_cost_disposition_reader_changed: %',expected.signature using errcode='55000';end if;
 end loop;
end$guard$;

create function finance_private.expense_cost_coverage(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare e public.finance_expense_items%rowtype;p public.payables%rowtype;cost jsonb;reg jsonb;d jsonb;issue text;raw_alloc numeric:=0;raw_paid numeric:=0;alloc_applied numeric:=0;pay_applied numeric:=0;gross numeric:=0;applied numeric:=0;residual numeric:=0;custody numeric:=0;recovery numeric:=0;g numeric;a numeric;r numeric;nominal numeric:=0;complement numeric;seen text[]:='{}';
begin
 select * into e from public.finance_expense_items where tenant_id=t and id=expense;
 if not found then issue:='finance_cost_source_missing';else
 cost:=finance_private.expense_cost_effective(t,expense);reg:=nullif(cost->'regularization','null'::jsonb);
 select coalesce(sum(amount_cents),0) into raw_alloc from public.finance_expense_allocations where tenant_id=t and expense_id=expense;
 if e.payable_id is not null then
  select * into p from public.payables where tenant_id=t and id=e.payable_id;
  if not found or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id then issue:='finance_cost_obligation_missing';end if;
  nominal:=p.amount*100;select coalesce(sum(amount*100),0) into raw_paid from finance_private.active_payable_payments where tenant_id=t and payable_id=e.payable_id;
 end if;
 if cost->'verified' is distinct from 'true'::jsonb or coalesce(cost->>'effective_amount_cents','') !~ '^[0-9]{1,14}$' then issue:='finance_cost_version_unverified';end if;
 if raw_alloc<0 or raw_alloc<>trunc(raw_alloc) or raw_paid<0 or raw_paid<>trunc(raw_paid) or nominal<0 or nominal<>trunc(nominal) then issue:='finance_cost_source_amount_invalid';end if;
 raw_alloc:=trunc(raw_alloc);raw_paid:=trunc(raw_paid);nominal:=trunc(nominal);if raw_alloc::text !~ '^[0-9]+$' or raw_paid::text !~ '^[0-9]+$' or nominal::text !~ '^[0-9]+$' then issue:='finance_cost_source_amount_invalid';end if;
 if reg is null then
  gross:=raw_alloc+raw_paid;alloc_applied:=raw_alloc;pay_applied:=raw_paid;applied:=gross;
  if issue is null then complement:=(cost->>'effective_amount_cents')::numeric-raw_alloc;if complement<0 or applied>(cost->>'effective_amount_cents')::numeric then issue:='finance_cost_coverage_unverified';end if;end if;
 else
  if jsonb_typeof(reg->'dispositions') is distinct from 'array' or jsonb_array_length(reg->'dispositions')=0 then issue:='finance_cost_disposition_unverified';
  else
   for d in select value from jsonb_array_elements(reg->'dispositions') loop
    if coalesce(d->>'gross_reserved_cents','') !~ '^[0-9]{1,14}$' or coalesce(d->>'applied_cents','') !~ '^[0-9]{1,14}$' or coalesce(d->>'residual_cents','') !~ '^[0-9]{1,14}$'
    or d->>'status' is distinct from 'pending' or ((d->>'source_kind')||':'||(d->>'source_id'))=any(seen) then issue:='finance_cost_disposition_unverified';exit;end if;
    seen:=array_append(seen,(d->>'source_kind')||':'||(d->>'source_id'));g:=(d->>'gross_reserved_cents')::numeric;a:=(d->>'applied_cents')::numeric;r:=(d->>'residual_cents')::numeric;
    if g<=0 or g<>a+r then issue:='finance_cost_disposition_unverified';exit;end if;
    if d->>'source_kind'='expense_allocation' then
     if d->>'disposition_type' is distinct from 'driver_custody' or not exists(select 1 from public.finance_expense_allocations x where x.tenant_id=t and x.expense_id=expense and x.id::text=d->>'source_id' and x.movement_id::text=d->>'movement_id' and x.amount_cents=g) then issue:='finance_cost_disposition_source_mismatch';exit;end if;
     alloc_applied:=alloc_applied+a;custody:=custody+r;
    elsif d->>'source_kind'='payable_link' then
     if d->>'disposition_type' is distinct from 'payment_recovery' or not exists(select 1 from public.finance_payable_movement_links x join finance_private.active_payable_payments pp on pp.tenant_id=x.tenant_id and pp.id=x.payment_id where x.tenant_id=t and x.payable_id=e.payable_id and x.id::text=d->>'source_id' and x.payment_id::text=d->>'payment_id' and x.movement_id::text=d->>'movement_id' and x.amount_cents=g and pp.amount*100=g and not exists(select 1 from public.finance_payable_link_reversals rv where rv.tenant_id=t and rv.link_id=x.id)) then issue:='finance_cost_disposition_source_mismatch';exit;end if;
     pay_applied:=pay_applied+a;recovery:=recovery+r;
    else issue:='finance_cost_disposition_source_mismatch';exit;end if;
    gross:=gross+g;applied:=applied+a;residual:=residual+r;
   end loop;
  end if;
  if issue is null and (gross<>raw_alloc+raw_paid or raw_alloc>0 and raw_paid>0 or applied<>(cost->>'effective_amount_cents')::numeric or gross::text is distinct from reg->>'gross_reserved_cents' or applied::text is distinct from reg->>'applied_cents' or residual::text is distinct from reg->>'residual_cents') then issue:='finance_cost_disposition_totals_mismatch';end if;
  complement:=case when e.payable_id is null then 0 else nominal end;
 end if;
 end if;
 return jsonb_build_object('verified',issue is null,'issue',issue,'regularization_id',reg->'id','allocation_reserved_cents',case when issue is null then raw_alloc::text end,'payment_reserved_cents',case when issue is null then raw_paid::text end,'gross_reserved_cents',case when issue is null then gross::text end,'allocation_applied_cents',case when issue is null then alloc_applied::text end,'payment_applied_cents',case when issue is null then pay_applied::text end,'applied_cents',case when issue is null then applied::text end,'residual_cents',case when issue is null then residual::text end,'driver_custody_cents',case when issue is null then custody::text end,'payment_recovery_cents',case when issue is null then recovery::text end,'complement_cents',case when issue is null then complement::text end,'obligation_nominal_cents',case when issue is null then nominal::text end,'uncovered_cents',case when issue is null then (case when reg is not null then 0 else (cost->>'effective_amount_cents')::numeric-applied end)::text end,'dispositions',case when issue is null then coalesce(reg->'dispositions','[]'::jsonb) else '[]'::jsonb end);
end$fn$;
revoke all on function finance_private.expense_cost_coverage(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.require_expense_cost_coverage(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare v jsonb;begin v:=finance_private.expense_cost_coverage(t,expense);if v->'verified' is distinct from 'true'::jsonb then raise exception 'finance_cost_coverage_unverified' using errcode='55000';end if;return v;end$$;
revoke all on function finance_private.require_expense_cost_coverage(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION finance_private.canonical_trip_costs(_tenant uuid, _trip uuid)
 RETURNS TABLE(source_id uuid, amount numeric, description text, metadata jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select e.id,finance_private.effective_cost_amount(e.tenant_id,e.id,true)::numeric/100,e.description,jsonb_build_object(
  'expense_cost_version',finance_private.expense_cost_version(e.tenant_id,e.id),'original_amount_cents',e.amount_cents::text,'canonical_cost_version',2,'source_table','finance_expense_items','batch_id',b.id,
  'category',e.category,'occurred_on',e.occurred_on,'supplier_id',e.supplier_id,'supplier_name',e.supplier_name,
  'cost_center_id',e.cost_center_id,'receipt_path',e.receipt_path,'no_receipt_reason',e.no_receipt_reason,
  'payable_id',e.payable_id,'unloading_id',e.unloading_id,'approval_status','approved',
  'reimbursable',false,'settlement_credit_created',false,
  'coverage',finance_private.require_expense_cost_coverage(e.tenant_id,e.id),'allocation_total_cents',coalesce((select sum(a.amount_cents) from public.finance_expense_allocations a where a.tenant_id=_tenant and a.expense_id=e.id),0))
 from finance_private.active_expense_items e join public.finance_expense_batches b on b.id=e.batch_id and b.tenant_id=e.tenant_id
 where e.tenant_id=_tenant and b.context='trip' and b.trip_id=_trip and not exists(select 1 from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and l.cost_id=e.id and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id));
$function$
;

CREATE OR REPLACE FUNCTION finance_private.list_expenses(_tenant uuid, _filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);
 from_date date:=nullif(_filters->>'from','')::date;to_date date:=nullif(_filters->>'to','')::date;
 search text:=lower(coalesce(_filters->>'search',''));result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 100
   or length(search)>200 or from_date>to_date
   or exists(select 1 from jsonb_object_keys(_filters) k where k not in('page','page_size','from','to','search','category','context','trip_id','missing_receipt','cost_center')) then
   raise exception 'finance_invalid_expense_filters' using errcode='22023';end if;
 with filtered as materialized (
   select e.*,finance_private.expense_cost_coverage(e.tenant_id,e.id) coverage,(finance_private.expense_cost_coverage(e.tenant_id,e.id)->>'complement_cents') complement_cents,finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,finance_private.effective_cost_amount(e.tenant_id,e.id) effective_amount_cents,secure_upload_private.expense_receipt_count(e.tenant_id,e.id) receipt_artifact_count,x.id is not null cancelled,to_jsonb(x)-'source_snapshot' cancellation,b.context,b.trip_id,b.driver_id,b.description batch_description,c.name cost_center_name,
     coalesce(a.allocated,0)::bigint allocated_cents,p.status payable_status,
     u.receivable_id,u.supplier_id reimbursement_supplier_id,u.source_snapshot->>'supplier_name' reimbursement_supplier_name,
     r.status receivable_status
   from public.finance_expense_items e
   left join public.finance_expense_cancellations x on x.tenant_id=e.tenant_id and x.expense_id=e.id
   join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id
   left join public.cost_centers c on c.id=e.cost_center_id and c.tenant_id=e.tenant_id
   left join public.payables p on p.id=e.payable_id and p.tenant_id=e.tenant_id
   left join public.finance_unloading_charges u on u.id=e.unloading_id and u.tenant_id=e.tenant_id
   left join public.receivables r on r.id=u.receivable_id and r.tenant_id=e.tenant_id
   left join lateral(select sum(a.amount_cents) allocated from public.finance_expense_allocations a
     where a.tenant_id=e.tenant_id and a.expense_id=e.id) a on true
   where e.tenant_id=_tenant and (from_date is null or e.occurred_on>=from_date) and (to_date is null or e.occurred_on<=to_date)
     and (nullif(_filters->>'cost_center','') is null or ((_filters->>'cost_center'='unassigned' and e.cost_center_id is null) or e.cost_center_id=nullif(nullif(_filters->>'cost_center',''),'unassigned')::uuid))
     and (nullif(_filters->>'category','') is null or e.category=_filters->>'category')
     and (nullif(_filters->>'context','') is null or b.context=_filters->>'context')
     and (nullif(_filters->>'trip_id','') is null or b.trip_id=(_filters->>'trip_id')::uuid)
     and (not coalesce((_filters->>'missing_receipt')::boolean,false) or (e.receipt_path is null and secure_upload_private.expense_receipt_count(e.tenant_id,e.id)=0))
     and position(search in lower(e.description||' '||e.supplier_name||' '||b.description||' '||coalesce(e.document_number,'')))>0
 ), paged as (
   select * from filtered order by occurred_on desc,created_at desc,id desc limit size offset (page-1)*size
 ), category_totals as (
   select category,case when bool_or(effective_amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else sum(effective_amount_cents)::text end amount_cents,count(*) item_count from filtered where not cancelled group by category
 ), center_totals as (
   select cost_center_id,cost_center_name,case when bool_or(effective_amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else sum(effective_amount_cents)::text end amount_cents,count(*) item_count from filtered where not cancelled group by cost_center_id,cost_center_name
 ), rows as (
   select p.*,case when p.unloading_id is null then null else finance_private.unloading_effective_origin(p.tenant_id,p.unloading_id) end unloading_origin,coalesce((select jsonb_agg(jsonb_build_object('movement_id',m.id,'amount_cents',a.amount_cents,
     'movement_amount_cents',m.amount_cents,'beneficiary_name',m.beneficiary_name,'occurred_on',m.occurred_on,'bank_reference',m.bank_reference)
     order by m.occurred_on,m.id) from public.finance_expense_allocations a join public.finance_movements m on m.id=a.movement_id and m.tenant_id=a.tenant_id
     where a.expense_id=p.id and a.tenant_id=_tenant),'[]') allocations,
     coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'actor_name',v.actor_name,'action',v.action,
       'reason',v.reason,'created_at',v.created_at) order by v.created_at,v.id) from public.finance_events v
       where v.tenant_id=_tenant and ((v.entity_type='expense_batch' and v.entity_id=p.batch_id) or (v.entity_type='expense_item' and v.entity_id=p.id))),'[]') history
   from paged p
 ) select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,
   'total',(select count(*) from filtered),
   'active_count',(select count(*) from filtered where not cancelled),'cancelled_count',(select count(*) from filtered where cancelled),
   'historical_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered),'cancelled_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered where cancelled),
   'cost_needs_review_count',(select count(*) from filtered where not cancelled and (effective_amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb)),'total_cents',(select case when bool_or(effective_amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(effective_amount_cents),0)::text end from filtered where not cancelled),
   'allocated_cents',(select coalesce(sum(allocated_cents),0)::text from filtered where not cancelled),
   'complement_cents',(select case when bool_or(effective_amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(complement_cents::numeric),0)::text end from filtered where not cancelled),
   'allocation_applied_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'allocation_applied_cents')::numeric),0)::text end from filtered where not cancelled),'payment_applied_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'payment_applied_cents')::numeric),0)::text end from filtered where not cancelled),'gross_reserved_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'gross_reserved_cents')::numeric),0)::text end from filtered where not cancelled),'residual_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'residual_cents')::numeric),0)::text end from filtered where not cancelled),'driver_custody_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'driver_custody_cents')::numeric),0)::text end from filtered where not cancelled),'payment_recovery_cents',(select case when bool_or(coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum((coverage->>'payment_recovery_cents')::numeric),0)::text end from filtered where not cancelled),'missing_receipt_count',(select count(*) from filtered where not cancelled and receipt_path is null and receipt_artifact_count=0),
   'cost_centers',coalesce((select jsonb_agg(to_jsonb(c) order by cost_center_name nulls last,cost_center_id) from center_totals c),'[]'),
   'categories',coalesce((select jsonb_agg(to_jsonb(c) order by category) from category_totals c),'[]'),
   'rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('effective_amount_cents',r.effective_amount_cents::text) order by occurred_on desc,created_at desc,id desc) from rows r),'[]')) into result;
 return result;
end;$function$
;

CREATE OR REPLACE FUNCTION finance_private.payable_effective_cost_evidence(t uuid, payable uuid, ev jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare p public.payables%rowtype;cost jsonb;versions jsonb;coverage jsonb;begin

 select * into p from public.payables where tenant_id=t and id=payable;

 if p.source_table is distinct from 'finance_expense_items' then return ev;end if;

 if not exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.id=p.source_id and e.payable_id=p.id) then

  return ev||jsonb_build_object('valid',false,'nominal_cents',null,'paid_cents',null,'open_cents',null,'expense_cost_version',null,'payment_cost_versions','[]'::jsonb,'issues',coalesce(ev->'issues','[]')||jsonb_build_array('finance_cost_version_unverified'),'revision',md5(jsonb_build_object('prior',ev->'revision','missing_cost_source',p.source_id)::text));

 end if;

 cost:=finance_private.expense_cost_version(t,p.source_id);coverage:=finance_private.expense_cost_coverage(t,p.source_id);

 select coalesce(jsonb_agg(jsonb_build_object('payment_id',e.entity_id,'event_id',e.id,'cost_version',e.after_data->'expense_cost_version') order by e.id),'[]') into versions

 from public.finance_events e join public.payables_payments pp on pp.tenant_id=e.tenant_id and pp.id=e.entity_id

 where e.tenant_id=t and pp.payable_id=payable and e.action='payable_movement_applied' and e.after_data ? 'expense_cost_version';

 ev:=ev||jsonb_build_object('coverage',coverage,'expense_cost_version',cost,'payment_cost_versions',versions,'revision',md5(jsonb_build_object('prior',ev->'revision','cost',cost,'coverage',coverage,'payments',versions)::text));

 if cost->'verified' is distinct from 'true'::jsonb or coverage->'verified' is distinct from 'true'::jsonb then ev:=ev||jsonb_build_object('valid',false,'nominal_cents',null,'paid_cents',null,'open_cents',null,'issues',coalesce(ev->'issues','[]')||jsonb_build_array('finance_cost_version_unverified'));end if;

 return ev;

end$function$
;

CREATE OR REPLACE FUNCTION finance_private.payable_portfolio(_tenant uuid, _filters jsonb, _page integer, _revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare basis text;starts date;ends date;supplier uuid;filter_category text;filter_search text;filter_status text;filter_source text;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;result jsonb;

begin

 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;

 if jsonb_typeof(_filters) is distinct from 'object' or _page is null or _page not between 1 and 1000000 or exists(select 1 from jsonb_each(_filters) f where f.key<>all(array['date_basis','from','to','category','supplier_id','search','status','source']) or jsonb_typeof(f.value) not in('string','null')) then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 if exists(select 1 from jsonb_each_text(_filters) f where f.key in('from','to') and f.value is not null and f.value !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 basis:=coalesce(_filters->>'date_basis','due_date');starts:=nullif(_filters->>'from','')::date;ends:=nullif(_filters->>'to','')::date;supplier:=nullif(_filters->>'supplier_id','')::uuid;filter_category:=nullif(btrim(_filters->>'category'),'');

 filter_search:=nullif(btrim(_filters->>'search'),'');filter_status:=nullif(_filters->>'status','');filter_source:=nullif(_filters->>'source','');

 if length(filter_search)>200 or filter_status<>all(array['pending','approved','partial','paid','overdue','cancelled','unknown']) or filter_source<>all(array['manual','system','unknown']) then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 if basis<>all(array['due_date','created_at']) or starts>ends or (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) or length(filter_category)>100 or (_revision is not null and _revision !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 with selected as materialized(

 select p.*,case when basis='due_date' then case when isfinite(p.due_date) then p.due_date end else case when isfinite(p.created_at) then (p.created_at at time zone 'America/Sao_Paulo')::date end end filter_day

 from public.payables p where p.tenant_id=_tenant and (supplier is null or p.supplier_id=supplier) and (filter_category is null or p.category=filter_category)

 and (filter_search is null or strpos(lower(concat_ws(' ',p.supplier_name,p.description,p.document_number)),lower(filter_search))>0)

 and (filter_source is null or (filter_source='unknown' and coalesce(p.source,'system')<>all(array['manual','system'])) or coalesce(p.source,'system')=filter_source)

 and (filter_status is null or (filter_status='overdue' and isfinite(p.due_date) and p.due_date<today and coalesce(p.status,'unknown')<>all(array['paid','cancelled'])) or (filter_status='unknown' and (p.status is null or p.status<>all(array['pending','approved','partial','paid','overdue','cancelled']))) or (filter_status<>'overdue' and p.status=filter_status))

 ), scoped as materialized(select * from selected where filter_day is null or ((starts is null or filter_day>=starts) and (ends is null or filter_day<=ends))),

 evidence as materialized(select p.*,finance_private.payable_effective_cost_evidence(_tenant,p.id,finance_private.payable_portfolio_evidence(_tenant,p.id)) ev from scoped p),

 rows as materialized(select id,coalesce(status,'unknown') status,filter_day,

 jsonb_build_object('source_table','payables','source_id',id,'status',coalesce(status,'unknown'),'supplier_id',supplier_id,'supplier_name',supplier_name,'category',category,'description',description,

 'due_on',case when isfinite(due_date) then due_date end,'created_on',case when isfinite(created_at) then (created_at at time zone 'America/Sao_Paulo')::date end,

 'date_in_range',filter_day is not null,'origin',jsonb_build_object('source_table',source_table,'source_id',source_id),'declared_amount',amount::text,'declared_paid',paid_amount::text,

 'coverage',ev->'coverage','expense_cost_version',ev->'expense_cost_version','payment_cost_versions',coalesce(ev->'payment_cost_versions','[]'::jsonb),'payment_ids',ev->'payment_ids','valid',ev->'valid','issues',ev->'issues','nominal_cents',ev->'nominal_cents','paid_cents',ev->'paid_cents','open_cents',ev->'open_cents','source_revision',ev->'revision') value,

 (ev->>'valid')::boolean valid,(ev->>'nominal_cents')::numeric nominal,(ev->>'paid_cents')::numeric paid,(ev->>'open_cents')::numeric remaining,

 case when isfinite(due_date) then due_date end due_on from evidence),

 summary as(select count(*) total,count(*) filter(where status='cancelled') cancelled,count(*) filter(where not valid) invalid,count(*) filter(where filter_day is null) undated,

 coalesce(sum(nominal),0) nominal,coalesce(sum(paid),0) paid,coalesce(sum(remaining),0) remaining,coalesce(sum(remaining) filter(where due_on<today),0) overdue from rows),

 fingerprint as(select md5(jsonb_build_object('tenant',_tenant,'filters',jsonb_build_object('date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source),'day',today,'sources',coalesce(jsonb_agg(value order by id),'[]'))::text) revision from rows),

 paged as(select value,filter_day,id from rows order by filter_day nulls last,id limit 30 offset (_page-1)*30),

 grouped as(select status,count(*) count from rows group by status),issues as(select issue,count(*) count from rows cross join lateral jsonb_array_elements_text(value->'issues')issue group by issue)

 select jsonb_build_object('version',1,'tenant_id',_tenant,'basis','current_operational','date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source,'as_of',today,

 'revision',f.revision,'page',_page,'page_size',30,'total_titles',s.total,'cancelled_titles',s.cancelled,'invalid_titles',s.invalid,'undated_titles',s.undated,'totals_valid',s.invalid=0,

 'nominal_cents',case when s.invalid=0 then s.nominal::text end,'paid_cents',case when s.invalid=0 then s.paid::text end,'open_cents',case when s.invalid=0 then s.remaining::text end,'overdue_cents',case when s.invalid=0 then s.overdue::text end,

 'status_counts',coalesce((select jsonb_agg(to_jsonb(g) order by status) from grouped g),'[]'),'issue_counts',coalesce((select jsonb_agg(to_jsonb(g) order by issue) from issues g),'[]'),

 'rows',coalesce((select jsonb_agg(value order by filter_day nulls last,id) from paged),'[]')) into result from summary s cross join fingerprint f;

 if _revision is not null and result->>'revision'<>_revision then raise exception 'finance_payable_portfolio_changed' using errcode='40001';end if;

 return result;

end$function$
;

CREATE OR REPLACE FUNCTION finance_private.settlement_expense_context(_tenant uuid, _settlement uuid, _page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.driver_settlements%rowtype;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_settlement;
 if not found then raise exception 'finance_settlement_not_found' using errcode='22023';end if;
 with source_rows as materialized(
  select finance_private.expense_cost_coverage(e.tenant_id,e.id) coverage,e.id,e.batch_id,e.category,e.description,e.occurred_on,finance_private.effective_cost_amount(e.tenant_id,e.id) amount_cents,finance_private.expense_cost_effective(e.tenant_id,e.id) cost_origin,
   coalesce(a.cents,0) allocated,e.payable_id,p.id title_id,p.status payable_status,p.supplier_name payee_name,p.amount title_amount,
   p.source_table,p.source_id,b.driver_id,
   trunc(coalesce(paid.amount,0)*100) paid,coalesce(paid.amount,0)*100<>trunc(coalesce(paid.amount,0)*100) paid_invalid,origin.payee_type original_payee,
   (finance_private.expense_cost_coverage(e.tenant_id,e.id)->>'complement_cents')::numeric complement
  from finance_private.active_expense_items e join public.finance_expense_batches b on b.id=e.batch_id and b.tenant_id=_tenant
  left join public.payables p on p.id=e.payable_id and p.tenant_id=_tenant
  left join lateral(select sum(amount_cents) cents from public.finance_expense_allocations where tenant_id=_tenant and expense_id=e.id) a on true
  left join lateral(select sum(amount) amount from finance_private.active_payable_payments where tenant_id=_tenant and payable_id=p.id) paid on true
  left join lateral(
   select case when count(*)=1 then min(line->>'payee_type') end payee_type
   from public.finance_commands c cross join lateral jsonb_array_elements(c.payload->'items') line
   where c.tenant_id=_tenant and c.action='record_expense_batch' and c.result->>'batch_id'=e.batch_id::text and line->>'id'=e.id::text
  ) origin on true
  where e.tenant_id=_tenant and b.context='trip' and b.trip_id=s.dispatch_trip_id
 ), assessed as materialized(
  select *,case when complement=0 and payable_id is null then 'none' when original_payee in('driver','supplier') then original_payee else 'unknown' end payee_type,
   case when payable_status='cancelled' then 0 else greatest(complement-paid,0) end outstanding,
   (amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb or paid_invalid or (coverage->>'allocation_applied_cents')::numeric>amount_cents or paid>complement or driver_id is distinct from s.driver_id
    or (complement>0 and (title_id is null or source_table is distinct from 'finance_expense_items' or source_id is distinct from id
       or title_amount*100 is distinct from complement or coalesce(original_payee,'') not in('driver','supplier') or payable_status='cancelled'))
    or (complement=0 and payable_id is not null)) needs_review
  from source_rows
 ), paged as(select * from assessed order by occurred_on desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'settlement_id',s.id,'trip_id',s.dispatch_trip_id,'page',_page,'page_size',30,
  'total',(select count(*) from assessed),'total_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(amount_cents),0)::text end from assessed),
  'allocated_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(allocated),0)::text end from assessed),'payable_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(complement),0)::text end from assessed),
  'paid_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(paid),0)::text end from assessed),'outstanding_cents',(select case when bool_or(amount_cents is null or coverage->'verified' is distinct from 'true'::jsonb) then null else coalesce(sum(outstanding),0)::text end from assessed),
  'needs_review_count',(select count(*) from assessed where needs_review),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'batch_id',batch_id,'category',category,'description',description,'occurred_on',occurred_on,
   'coverage',coverage,'complement_cents',complement::text,'cost_origin',cost_origin,'amount_cents',amount_cents::text,'allocated_cents',allocated::text,'payable_id',payable_id,'payee_type',payee_type,'payee_name',payee_name,
   'payable_cents',complement::text,'paid_cents',paid::text,'outstanding_cents',outstanding::text,'payable_status',payable_status,'needs_review',needs_review)
   order by occurred_on desc,id) from paged),'[]')) into result;
 return result;
end$function$
;

-- Current pending economic positions, separate from bank cash and historical titles.
create function finance_private.cost_dispositions(t uuid,_page integer default 1,_expected_revision text default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb;
begin
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _expected_revision is not null and _expected_revision !~ '^[a-f0-9]{32}$' then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_cost_dispositions_revision_required' using errcode='22023';end if;
 with origins as materialized(select expense_id,min(charge_id::text)::uuid charge_id from finance_private.expense_cost_regularizations where tenant_id=t group by expense_id),
 sources as materialized(select o.expense_id,o.charge_id,e.payable_id,e.description,case when isfinite(e.occurred_on) then e.occurred_on end occurred_on,finance_private.expense_cost_coverage(t,o.expense_id) coverage from origins o left join public.finance_expense_items e on e.tenant_id=t and e.id=o.expense_id),
 totals as(select count(*) n,count(*) filter(where coverage->'verified' is distinct from 'true'::jsonb) invalid,
  coalesce(sum((coverage->>'gross_reserved_cents')::numeric),0) gross,coalesce(sum((coverage->>'applied_cents')::numeric),0) applied,coalesce(sum((coverage->>'residual_cents')::numeric),0) residual,coalesce(sum((coverage->>'driver_custody_cents')::numeric),0) custody,coalesce(sum((coverage->>'payment_recovery_cents')::numeric),0) recovery,
  md5(t::text||coalesce(string_agg(md5(to_jsonb(s)::text),'' order by expense_id),'')) revision from sources s),
 paged as(select * from sources order by occurred_on desc nulls last,expense_id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',t,'page',_page,'page_size',30,'total',n,'revision',revision,'needs_review_count',invalid,
 'gross_reserved_cents',case when invalid=0 then trunc(gross)::text end,'applied_cents',case when invalid=0 then trunc(applied)::text end,'residual_cents',case when invalid=0 then trunc(residual)::text end,'driver_custody_cents',case when invalid=0 then trunc(custody)::text end,'payment_recovery_cents',case when invalid=0 then trunc(recovery)::text end,
 'rows',coalesce((select jsonb_agg(to_jsonb(p) order by occurred_on desc nulls last,expense_id) from paged p),'[]'::jsonb)) into result from totals;
 if _expected_revision is not null and _expected_revision is distinct from result->>'revision' then raise exception 'finance_cost_dispositions_changed' using errcode='40001';end if;
 return result;
end$fn$;
revoke all on function finance_private.cost_dispositions(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.cost_dispositions(uuid,integer,text) to authenticated;
create function public.get_finance_cost_dispositions(_tenant_id uuid,_page integer default 1,_expected_revision text default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.cost_dispositions(_tenant_id,_page,_expected_revision)$$;
revoke all on function public.get_finance_cost_dispositions(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_cost_dispositions(uuid,integer,text) to authenticated;

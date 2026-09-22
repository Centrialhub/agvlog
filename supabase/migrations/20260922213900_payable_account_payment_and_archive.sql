-- Register an already executed payment and its allocation atomically.
create or replace function finance_private.pay_payable_from_account(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=(_payload->>'tenant_id')::uuid; req uuid:=(_payload->>'request_id')::uuid;
 actor uuid:=auth.uid(); prior public.finance_commands%rowtype; p public.payables%rowtype;
 movement jsonb; allocation jsonb; result jsonb;
begin
 perform finance_private.require_access(t);
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->>'version' is distinct from '1' or req is null
 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','payable_id','bank_account_id','amount_cents','paid_on','method','reason','bank_reference'])) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.require_access(t);
 select * into prior from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if prior.actor_id is distinct from actor or prior.action<>'pay_payable_from_account' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into p from public.payables where tenant_id=t and id=(_payload->>'payable_id')::uuid for update;
 if p.id is null or p.status not in('approved','partial') then raise exception 'finance_payable_not_payable' using errcode='22023';end if;
 movement:=finance_private.record_movement(jsonb_build_object('version',1,'tenant_id',t,'request_id',gen_random_uuid(),
  'bank_account_id',_payload->>'bank_account_id','direction','out','nature','payment','amount_cents',_payload->'amount_cents',
  'occurred_on',_payload->>'paid_on','description',coalesce(nullif(btrim(p.description),''),'Pagamento de conta a pagar'),
  'beneficiary_name',p.supplier_name,'driver_id',p.driver_id,'bank_reference',_payload->>'bank_reference','reason',_payload->>'reason'));
 allocation:=finance_private.apply_payable_movement(jsonb_build_object('version',1,'tenant_id',t,'request_id',gen_random_uuid(),
  'payable_id',p.id,'movement_id',movement->>'movement_id','amount_cents',_payload->'amount_cents','method',_payload->>'method','reason',_payload->>'reason'));
 result:=allocation||jsonb_build_object('request_id',req,'bank_account_id',_payload->>'bank_account_id','paid_on',_payload->>'paid_on','confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'pay_payable_from_account',_payload,result);
 return result;
end $$;
revoke all on function finance_private.pay_payable_from_account(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.pay_payable_from_account(jsonb) to authenticated;
create or replace function public.pay_finance_payable_from_account(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.pay_payable_from_account(_payload)$$;
revoke all on function public.pay_finance_payable_from_account(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pay_finance_payable_from_account(jsonb) to authenticated;

-- Exclusion is an auditable cancellation/archive, never a deletion of evidence.
create table if not exists finance_private.payable_archives(
 tenant_id uuid not null references public.tenants(id),payable_id uuid not null references public.payables(id),
 actor_id uuid not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 source_snapshot jsonb not null,request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,payable_id)
);
alter table finance_private.payable_archives enable row level security;
revoke all on finance_private.payable_archives from public,anon,authenticated,service_role;

create or replace function finance_private.protect_archived_payable() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from finance_private.payable_archives where tenant_id=old.tenant_id and payable_id=old.id)
  and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
  raise exception 'finance_archived_payable_immutable' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function finance_private.protect_archived_payable() from public,anon,authenticated,service_role;
create trigger protect_archived_payable before update or delete on public.payables
for each row execute function finance_private.protect_archived_payable();

create or replace function finance_private.archive_payables(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=(_payload->>'tenant_id')::uuid;req uuid:=(_payload->>'request_id')::uuid;actor uuid:=auth.uid();
 prior public.finance_commands%rowtype;p public.payables%rowtype;item jsonb;ev jsonb;ctx jsonb;result jsonb;actor_name text;
begin
 perform finance_private.require_access(t);
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->>'version' is distinct from '1' or req is null
 or jsonb_typeof(_payload->'items') is distinct from 'array' or jsonb_array_length(_payload->'items') not between 1 and 100
 or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','items','reason'])) then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if (select count(distinct x->>'payable_id') from jsonb_array_elements(_payload->'items') x)<>jsonb_array_length(_payload->'items') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.require_access(t);
 select * into prior from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if prior.actor_id is distinct from actor or prior.action<>'archive_payables' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 for item in select value from jsonb_array_elements(_payload->'items') order by value->>'payable_id' loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'revision','')!~'^[a-f0-9]{32}$'
   or exists(select 1 from jsonb_object_keys(item) k where k not in('payable_id','revision')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
  select * into p from public.payables where tenant_id=t and id=(item->>'payable_id')::uuid for update;
  if p.id is null then raise exception 'finance_payable_not_found' using errcode='22023';end if;
  if exists(select 1 from finance_private.payable_archives where tenant_id=t and payable_id=p.id) then continue;end if;
  ev:=finance_private.payable_effective_cost_evidence(t,p.id,finance_private.payable_portfolio_evidence(t,p.id));
  if ev->>'revision' is distinct from item->>'revision' then raise exception 'finance_payable_archive_changed' using errcode='40001';end if;
  if exists(select 1 from public.payables_payments where tenant_id=t and payable_id=p.id)
   or exists(select 1 from public.finance_payable_movement_links where tenant_id=t and payable_id=p.id)
   or coalesce(p.paid_amount,0)<>0 or p.status in('paid','partial') then raise exception 'finance_payable_archive_has_payments' using errcode='55000';end if;
  if p.status is null or p.status not in('pending','approved','overdue','cancelled') then raise exception 'finance_payable_archive_origin_required' using errcode='55000';end if;
  if p.status<>'cancelled' then
   if p.source_table is not null or p.source_id is not null
    or exists(select 1 from public.finance_expense_items where tenant_id=t and payable_id=p.id)
    or exists(select 1 from public.employee_advances where tenant_id=t and payable_id=p.id) then raise exception 'finance_payable_archive_origin_required' using errcode='55000';end if;
   ctx:=finance_private.manual_expense_cancellation_context(t,p.id);
   if ctx->>'original_request_id' is not null then
    perform finance_private.cancel_manual_expense(jsonb_build_object('version',1,'tenant_id',t,'request_id',gen_random_uuid(),'payable_id',p.id,'revision',ctx->>'revision','reason',_payload->>'reason'));
   else
    -- The same dependency projection protects plain manually registered titles.
    if exists(select 1 from jsonb_each(ctx->'snapshot') x where x.key in('expense_items','advances','payroll_items','settlement_items','obligations') and case when jsonb_typeof(x.value)='array' then jsonb_array_length(x.value)>0 else false end) then
     raise exception 'finance_payable_archive_origin_required' using errcode='55000';end if;
    perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));
    update public.payables set status='cancelled',approved_at=null,approved_by=null,updated_at=clock_timestamp() where tenant_id=t and id=p.id;
   end if;
  end if;
  insert into finance_private.payable_archives(tenant_id,payable_id,actor_id,reason,source_snapshot,request_id)
   values(t,p.id,actor,btrim(_payload->>'reason'),to_jsonb(p),req);
  insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
   values(t,'payable',p.id,'payable_archived',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(p),jsonb_build_object('status','cancelled','archived',true,'request_id',req));
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',req,'confirmed',true,'payable_ids',(select jsonb_agg(x->>'payable_id' order by x->>'payable_id') from jsonb_array_elements(_payload->'items') x));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'archive_payables',_payload,result);
 return result;
end $$;
revoke all on function finance_private.archive_payables(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.archive_payables(jsonb) to authenticated;
create or replace function public.archive_finance_payables(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.archive_payables(_payload)$$;
revoke all on function public.archive_finance_payables(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.archive_finance_payables(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION finance_private.payable_portfolio(_tenant uuid, _filters jsonb, _page integer, _revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare basis text;starts date;ends date;supplier uuid;filter_category text;filter_search text;filter_status text;filter_source text;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;result jsonb;

begin

 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;

 if jsonb_typeof(_filters) is distinct from 'object' or _page is null or _page not between 1 and 1000000 or exists(select 1 from jsonb_each(_filters) f where f.key<>all(array['date_basis','from','to','category','supplier_id','search','status','source','visibility']) or jsonb_typeof(f.value) not in('string','null')) then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 if exists(select 1 from jsonb_each_text(_filters) f where f.key in('from','to') and f.value is not null and f.value !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 basis:=coalesce(_filters->>'date_basis','due_date');starts:=nullif(_filters->>'from','')::date;ends:=nullif(_filters->>'to','')::date;supplier:=nullif(_filters->>'supplier_id','')::uuid;filter_category:=nullif(btrim(_filters->>'category'),'');

 filter_search:=nullif(btrim(_filters->>'search'),'');filter_status:=nullif(_filters->>'status','');filter_source:=nullif(_filters->>'source','');

 if length(filter_search)>200 or filter_status<>all(array['pending','approved','partial','paid','overdue','cancelled','unknown']) or filter_source<>all(array['manual','system','unknown']) then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 if basis<>all(array['due_date','created_at']) or starts>ends or (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) or length(filter_category)>100 or (_revision is not null and _revision !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;

 if coalesce(_filters->>'visibility','active') not in ('active','archived','all') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with selected as materialized(

 select p.*,case when basis='due_date' then case when isfinite(p.due_date) then p.due_date end else case when isfinite(p.created_at) then (p.created_at at time zone 'America/Sao_Paulo')::date end end filter_day

 from public.payables p where p.tenant_id=_tenant and (coalesce(_filters->>'visibility','active')='all' or exists(select 1 from finance_private.payable_archives a where a.tenant_id=p.tenant_id and a.payable_id=p.id)=(coalesce(_filters->>'visibility','active')='archived')) and (supplier is null or p.supplier_id=supplier) and (filter_category is null or p.category=filter_category)

 and (filter_search is null or strpos(lower(concat_ws(' ',p.supplier_name,p.description,p.document_number)),lower(filter_search))>0)

 and (filter_source is null or (filter_source='unknown' and coalesce(p.source,'system')<>all(array['manual','system'])) or coalesce(p.source,'system')=filter_source)

 and (filter_status is null or (filter_status='overdue' and isfinite(p.due_date) and p.due_date<today and coalesce(p.status,'unknown')<>all(array['paid','cancelled'])) or (filter_status='unknown' and (p.status is null or p.status<>all(array['pending','approved','partial','paid','overdue','cancelled']))) or (filter_status<>'overdue' and p.status=filter_status))

 ), scoped as materialized(select * from selected where filter_day is null or ((starts is null or filter_day>=starts) and (ends is null or filter_day<=ends))),

 evidence as materialized(select p.*,finance_private.payable_effective_cost_evidence(_tenant,p.id,finance_private.payable_portfolio_evidence(_tenant,p.id)) ev from scoped p),

 rows as materialized(select id,coalesce(status,'unknown') status,filter_day,

 jsonb_build_object('archived',exists(select 1 from finance_private.payable_archives a where a.tenant_id=_tenant and a.payable_id=id),'source_table','payables','source_id',id,'status',coalesce(status,'unknown'),'supplier_id',supplier_id,'supplier_name',supplier_name,'category',category,'description',description,

 'due_on',case when isfinite(due_date) then due_date end,'created_on',case when isfinite(created_at) then (created_at at time zone 'America/Sao_Paulo')::date end,

 'date_in_range',filter_day is not null,'origin',jsonb_build_object('source_table',source_table,'source_id',source_id),'declared_amount',amount::text,'declared_paid',paid_amount::text,

 'coverage',ev->'coverage','expense_cost_version',ev->'expense_cost_version','payment_cost_versions',coalesce(ev->'payment_cost_versions','[]'::jsonb),'payment_ids',ev->'payment_ids','valid',ev->'valid','issues',ev->'issues','nominal_cents',ev->'nominal_cents','paid_cents',ev->'paid_cents','open_cents',ev->'open_cents','source_revision',ev->'revision') value,

 (ev->>'valid')::boolean valid,(ev->>'nominal_cents')::numeric nominal,(ev->>'paid_cents')::numeric paid,(ev->>'open_cents')::numeric remaining,

 case when isfinite(due_date) then due_date end due_on from evidence),

 summary as(select count(*) total,count(*) filter(where status='cancelled') cancelled,count(*) filter(where not valid) invalid,count(*) filter(where filter_day is null) undated,

 coalesce(sum(nominal),0) nominal,coalesce(sum(paid),0) paid,coalesce(sum(remaining),0) remaining,coalesce(sum(remaining) filter(where due_on<today),0) overdue from rows),

 fingerprint as(select md5(jsonb_build_object('tenant',_tenant,'filters',jsonb_build_object('date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source,'visibility',coalesce(_filters->>'visibility','active')),'day',today,'sources',coalesce(jsonb_agg(value order by id),'[]'))::text) revision from rows),

 paged as(select value,filter_day,id from rows order by filter_day nulls last,id limit 30 offset (_page-1)*30),

 grouped as(select status,count(*) count from rows group by status),issues as(select issue,count(*) count from rows cross join lateral jsonb_array_elements_text(value->'issues')issue group by issue)

 select jsonb_build_object('version',1,'tenant_id',_tenant,'basis','current_operational','date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source,'visibility',coalesce(_filters->>'visibility','active'),'as_of',today,

 'revision',f.revision,'page',_page,'page_size',30,'total_titles',s.total,'cancelled_titles',s.cancelled,'invalid_titles',s.invalid,'undated_titles',s.undated,'totals_valid',s.invalid=0,

 'nominal_cents',case when s.invalid=0 then s.nominal::text end,'paid_cents',case when s.invalid=0 then s.paid::text end,'open_cents',case when s.invalid=0 then s.remaining::text end,'overdue_cents',case when s.invalid=0 then s.overdue::text end,

 'status_counts',coalesce((select jsonb_agg(to_jsonb(g) order by status) from grouped g),'[]'),'issue_counts',coalesce((select jsonb_agg(to_jsonb(g) order by issue) from issues g),'[]'),

 'rows',coalesce((select jsonb_agg(value order by filter_day nulls last,id) from paged),'[]')) into result from summary s cross join fingerprint f;

 if _revision is not null and result->>'revision'<>_revision then raise exception 'finance_payable_portfolio_changed' using errcode='40001';end if;

 return result;

end$function$
;

notify pgrst, 'reload schema';

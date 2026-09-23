create table finance_private.fiscal_review_assignments(
 tenant_id uuid not null references public.tenants(id),emission_id uuid not null references public.hub_fiscal_emissions(id),
 actor_id uuid not null,actor_name text not null,due_on date not null,note text not null check(length(btrim(note)) between 5 and 2000),
 updated_at timestamptz not null default clock_timestamp(),primary key(tenant_id,emission_id));
create index fiscal_review_emission_idx on finance_private.fiscal_review_assignments(emission_id);
alter table finance_private.fiscal_review_assignments enable row level security;
revoke all on finance_private.fiscal_review_assignments from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION finance_private.fiscal_work_queue(_tenant uuid, _status text, _cursor_observed_order bigint DEFAULT NULL::bigint, _cursor_observation_id uuid DEFAULT NULL::uuid, _current_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rows jsonb;
  total bigint;
  counts jsonb;
  scheduler_active boolean:=false;
  has_more boolean;
  next_cursor jsonb;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if _current_only is null or _status is null or _status not in('','pending','review','applied','superseded')
     or (_cursor_observed_order is null) <> (_cursor_observation_id is null) then
    raise exception 'finance_invalid_fiscal_queue_filter' using errcode='22023';
  end if;

  select count(*) into total from public.finance_fiscal_projection_jobs j join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
  where j.tenant_id=_tenant and (_status='' or j.status=_status) and (not _current_only or not exists(select 1 from public.finance_fiscal_observations latest where latest.tenant_id=_tenant and latest.emission_id=o.emission_id and latest.observed_order>o.observed_order));
  select jsonb_build_object('pending',count(*) filter(where status='pending'),'review',count(*) filter(where status='review'),
    'applied',count(*) filter(where status='applied'),'superseded',count(*) filter(where status='superseded')) into counts
  from public.finance_fiscal_projection_jobs j join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id where j.tenant_id=_tenant and (not _current_only or not exists(select 1 from public.finance_fiscal_observations latest where latest.tenant_id=_tenant and latest.emission_id=o.emission_id and latest.observed_order>o.observed_order));

  with candidates as materialized (
    select o.observed_order,j.observation_id,jsonb_build_object(
      'observation_id',j.observation_id,'tenant_id',j.tenant_id,'status',j.status,
      'document_type',o.snapshot->>'doc_type','document_number',o.snapshot->>'number','fiscal_status',o.snapshot->>'status',
      'attempts',j.attempts,'automatic_failures',j.automatic_failures,'issue',j.issue,'available_at',j.available_at,
      'created_at',j.created_at,'updated_at',j.updated_at,'receivable_id',j.result->>'receivable_id','emission_id',o.emission_id,'cte_document_id',o.snapshot->>'cte_document_id','fiscal_document_id',o.snapshot->>'fiscal_document_id','nfse_document_id',o.snapshot->>'nfse_document_id',
      'is_current',not exists(select 1 from public.finance_fiscal_observations newer where newer.tenant_id=_tenant and newer.emission_id=o.emission_id and newer.observed_order>o.observed_order),
      'assignment',to_jsonb(a),'assignment_revision',md5(coalesce(to_jsonb(a),'{}'::jsonb)::text)) row_data
    from public.finance_fiscal_projection_jobs j
    join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
    left join finance_private.fiscal_review_assignments a on a.tenant_id=j.tenant_id and a.emission_id=o.emission_id
    where j.tenant_id=_tenant and (_status='' or j.status=_status) and (not _current_only or not exists(select 1 from public.finance_fiscal_observations latest where latest.tenant_id=_tenant and latest.emission_id=o.emission_id and latest.observed_order>o.observed_order))
      and (_cursor_observed_order is null or (o.observed_order,j.observation_id)<(_cursor_observed_order,_cursor_observation_id))
    order by o.observed_order desc,j.observation_id desc limit 31
  ), page as (
    select * from candidates order by observed_order desc,observation_id desc limit 30
  )
  select coalesce((select jsonb_agg(row_data order by observed_order desc,observation_id desc) from page),'[]'::jsonb),
    (select count(*)>30 from candidates),
    case when (select count(*)>30 from candidates) then
      (select jsonb_build_object('observed_order',observed_order::text,'observation_id',observation_id)
       from page order by observed_order,observation_id limit 1)
    else null end
  into rows,has_more,next_cursor;

  if to_regclass('cron.job') is not null then
    execute $query$select exists(select 1 from cron.job where jobname='finance-fiscal-projection-every-minute' and active
      and command='SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);')$query$ into scheduler_active;
  end if;
  return jsonb_build_object('version',3,'current_only',_current_only,'tenant_id',_tenant,'page_size',30,'status_filter',_status,'total',total,
    'cursor',case when _cursor_observed_order is null then null else jsonb_build_object('observed_order',_cursor_observed_order::text,'observation_id',_cursor_observation_id) end,
    'next_cursor',next_cursor,'has_more',has_more,'counts',counts,'scheduler_active',scheduler_active,'rows',rows);
end;$function$;create or replace function finance_private.assign_fiscal_review(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t uuid:=(_payload->>'tenant_id')::uuid;req uuid:=(_payload->>'request_id')::uuid;actor uuid:=auth.uid();o public.finance_fiscal_observations%rowtype;
 old_row jsonb;new_row jsonb;prior public.finance_commands%rowtype;result jsonb;actor_name text;
begin
 perform finance_private.require_access(t);
 if _payload->>'version' is distinct from '1' or req is null or jsonb_typeof(_payload)<>'object' or length(btrim(coalesce(_payload->>'note',''))) not between 5 and 2000
 or coalesce(_payload->>'due_on','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','observation_id','revision','due_on','note')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.require_access(t);
 select * into prior from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if prior.actor_id is distinct from actor or prior.action<>'assign_fiscal_review' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into o from public.finance_fiscal_observations where tenant_id=t and id=(_payload->>'observation_id')::uuid;
 if o.id is null or exists(select 1 from public.finance_fiscal_observations where tenant_id=t and emission_id=o.emission_id and observed_order>o.observed_order)
  or not exists(select 1 from public.finance_fiscal_projection_jobs where tenant_id=t and observation_id=o.id and status='review') then raise exception 'finance_fiscal_review_changed' using errcode='40001';end if;
 select to_jsonb(a) into old_row from finance_private.fiscal_review_assignments a where tenant_id=t and emission_id=o.emission_id for update;
 if md5(coalesce(old_row,'{}'::jsonb)::text) is distinct from _payload->>'revision' then raise exception 'finance_fiscal_review_changed' using errcode='40001';end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 insert into finance_private.fiscal_review_assignments(tenant_id,emission_id,actor_id,actor_name,due_on,note)
 values(t,o.emission_id,actor,coalesce(actor_name,actor::text),(_payload->>'due_on')::date,btrim(_payload->>'note'))
 on conflict(tenant_id,emission_id) do update set actor_id=excluded.actor_id,actor_name=excluded.actor_name,due_on=excluded.due_on,note=excluded.note,updated_at=clock_timestamp()
 returning to_jsonb(fiscal_review_assignments.*) into new_row;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'fiscal_review',o.emission_id,'review_assigned',actor,coalesce(actor_name,actor::text),btrim(_payload->>'note'),old_row,new_row);
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',req,'observation_id',o.id,'confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'assign_fiscal_review',_payload,result);
 return result;
end;$function$;
revoke all on function finance_private.assign_fiscal_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.assign_fiscal_review(jsonb) to authenticated;
create or replace function public.assign_finance_fiscal_review(_payload jsonb) returns jsonb language sql security invoker set search_path=''
as $$select finance_private.assign_fiscal_review(_payload)$$;
revoke all on function public.assign_finance_fiscal_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.assign_finance_fiscal_review(jsonb) to authenticated;

revoke all on function finance_private.fiscal_work_queue(uuid,text,bigint,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function finance_private.fiscal_work_queue(uuid,text,bigint,uuid,boolean) to authenticated;
create or replace function public.list_finance_fiscal_work_queue(_tenant_id uuid,_status text,_cursor_observed_order bigint default null,_cursor_observation_id uuid default null,_current_only boolean default true)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.fiscal_work_queue(_tenant_id,_status,_cursor_observed_order,_cursor_observation_id,_current_only)$$;
revoke all on function public.list_finance_fiscal_work_queue(uuid,text,bigint,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_fiscal_work_queue(uuid,text,bigint,uuid,boolean) to authenticated;
notify pgrst,'reload schema';

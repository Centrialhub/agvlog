create table public.finance_unloading_charges (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 delivery_stop_id uuid not null references public.dispatch_stops(id),
 recorded_stop_id uuid not null references public.dispatch_stops(id),
 supplier_id uuid not null references public.clients(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 occurred_on date not null, receipt_path text not null,
 receivable_id uuid not null unique references public.receivables(id),
 source_snapshot jsonb not null, created_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,delivery_stop_id)
);
alter table public.finance_unloading_charges enable row level security;
revoke all on public.finance_unloading_charges from public,anon,authenticated,service_role;
grant select on public.finance_unloading_charges to authenticated,service_role;
create policy finance_unloading_read on public.finance_unloading_charges for select to authenticated
 using(finance_private.can_access(tenant_id));
create trigger preserve_finance_unloading before update or delete on public.finance_unloading_charges
 for each row execute function finance_private.preserve_event();

create function finance_private.delivery_context(_tenant uuid,_stop uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.dispatch_stops%rowtype; docs jsonb; supplier uuid; suppliers integer;
 missing integer; roots uuid[]; result jsonb; supplier_name text; document_count integer; root_documents integer;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501'; end if;
 select * into s from public.dispatch_stops where id=_stop and tenant_id=_tenant;
 if not found then raise exception 'finance_delivery_not_found' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('allocation_id',d.id,'document_id',f.id,
  'supplier_id',f.supplier_id,'client_id',f.client_id,'attempt_id',to_jsonb(d)->>'delivery_attempt_id')
  order by d.id),'[]'::jsonb),count(*),count(distinct f.supplier_id),
  count(*) filter(where f.id is null or f.supplier_id is null), (array_agg(f.supplier_id order by f.id))[1]
 into docs,document_count,suppliers,missing,supplier
 from public.dispatch_stop_documents d left join public.fiscal_documents f on f.id=d.fiscal_document_id and f.tenant_id=_tenant
 where d.dispatch_stop_id=_stop and d.tenant_id=_tenant;
 -- Follow preserved allocation history, so reattempts do not recreate an
 -- unloading entitlement for the original delivery.
 roots:=array[_stop]; root_documents:=document_count;
 if to_regclass('public.delivery_attempts') is not null then
 with recursive ancestry as (
  select d.id,d.id origin_id,d.dispatch_stop_id,(to_jsonb(d)->>'delivery_attempt_id')::uuid delivery_attempt_id,array[d.id] path,0 depth
  from public.dispatch_stop_documents d where d.dispatch_stop_id=_stop and d.tenant_id=_tenant
  union all
  select parent.id,a.origin_id,parent.dispatch_stop_id,(to_jsonb(parent)->>'delivery_attempt_id')::uuid,a.path||parent.id,a.depth+1
  from ancestry a join public.delivery_attempts h on h.id=a.delivery_attempt_id and h.tenant_id=_tenant
  join public.dispatch_stop_documents parent on parent.id=h.source_allocation_id and parent.tenant_id=_tenant
  where not parent.id=any(a.path) and a.depth<100
 ) select array_agg(distinct dispatch_stop_id) filter(where delivery_attempt_id is null),
  count(distinct origin_id) filter(where delivery_attempt_id is null) into roots,root_documents from ancestry;
 elsif exists(select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=_stop and d.tenant_id=_tenant
  and to_jsonb(d)->>'delivery_attempt_id' is not null) then
  roots:=null; root_documents:=0;
 end if;
 select company_name into supplier_name from public.clients where id=supplier and tenant_id=_tenant and active;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'stop_id',_stop,'trip_id',s.dispatch_trip_id,
  'destination',s.destination,'document_count',document_count,'documents',docs,
  'supplier_id',case when suppliers=1 and missing=0 and supplier_name is not null then supplier end,
  'supplier_name',supplier_name,'delivery_stop_id',case when cardinality(roots)=1 then roots[1] end,
  'issue',case when document_count=0 then 'documents_missing' when missing>0 then 'supplier_missing'
   when suppliers<>1 then 'mixed_suppliers' when supplier_name is null then 'supplier_unavailable'
   when cardinality(roots) is distinct from 1 or root_documents<>document_count then 'delivery_identity_ambiguous'
   when exists(select 1 from public.fiscal_documents f join public.dispatch_stop_documents d on d.fiscal_document_id=f.id
     where d.dispatch_stop_id=_stop and d.tenant_id=_tenant and f.tenant_id=_tenant
      and f.client_id is distinct from s.client_id) then 'destination_mismatch'
   else null end);
 return result||jsonb_build_object('revision',md5(result::text));
end;
$$;
revoke all on function finance_private.delivery_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.delivery_context(uuid,uuid) to authenticated;
create function public.get_finance_delivery_context(_tenant_id uuid,_stop_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.delivery_context(_tenant_id,_stop_id);$$;
revoke all on function public.get_finance_delivery_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_delivery_context(uuid,uuid) to authenticated;

create function finance_private.record_unloading(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid; request uuid; actor uuid:=auth.uid(); stop uuid; context jsonb;
 existing public.finance_commands%rowtype; charge uuid; receivable uuid; cents bigint; result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid; request:=(_payload->>'request_id')::uuid; stop:=(_payload->>'stop_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or stop is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in
 ('version','tenant_id','request_id','stop_id','expected_revision','amount_cents','occurred_on','due_date','receipt_path','reason'))
 or coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$'
 or coalesce(_payload->>'receipt_path','') not like t::text||'/%' or (_payload->>'receipt_path') like '%..%' then
  raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_unloading' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;
 end if;
 perform 1 from public.dispatch_stops where id=stop and tenant_id=t for update;
 perform 1 from public.dispatch_stop_documents where dispatch_stop_id=stop and tenant_id=t for share;
 perform 1 from public.fiscal_documents f where f.tenant_id=t and exists(
  select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=stop and d.tenant_id=t and d.fiscal_document_id=f.id) for share;
 context:=finance_private.delivery_context(t,stop);
 if context->>'issue' is not null then raise exception 'finance_delivery_invalid: %',context->>'issue' using errcode='23514';end if;
 if context->>'revision' is distinct from _payload->>'expected_revision' then
  raise exception 'finance_delivery_changed' using errcode='40001';end if;
 if exists(select 1 from public.finance_unloading_charges where tenant_id=t and delivery_stop_id=(context->>'delivery_stop_id')::uuid) then
  raise exception 'finance_delivery_already_charged' using errcode='23505';end if;
 cents:=(_payload->>'amount_cents')::bigint;
 if cents<=0 or (_payload->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
  raise exception 'finance_invalid_unloading_amount_or_date' using errcode='22023';end if;
 insert into public.receivables(tenant_id,client_id,description,amount,status,due_date,created_by)
 values(t,(context->>'supplier_id')::uuid,'Descarga — '||coalesce(context->>'destination','Entrega'),
  cents::numeric/100,'pending',nullif(_payload->>'due_date','')::date,actor) returning id into receivable;
 insert into public.finance_unloading_charges(tenant_id,delivery_stop_id,recorded_stop_id,supplier_id,
  amount_cents,occurred_on,receipt_path,receivable_id,source_snapshot,created_by)
 values(t,(context->>'delivery_stop_id')::uuid,stop,(context->>'supplier_id')::uuid,cents,
  (_payload->>'occurred_on')::date,_payload->>'receipt_path',receivable,context,actor) returning id into charge;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 select t,'unloading',charge,'recorded',actor,coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text),
  btrim(_payload->>'reason'),jsonb_build_object('context',context,'amount_cents',cents,'receivable_id',receivable)
 from auth.users u where u.id=actor;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'charge_id',charge,
  'receivable_id',receivable,'supplier_id',context->'supplier_id','confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_unloading',_payload,result);
 return result;
end;
$$;
revoke all on function finance_private.record_unloading(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_unloading(jsonb) to authenticated;
create function public.record_finance_unloading(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.record_unloading(_payload);$$;
revoke all on function public.record_finance_unloading(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_finance_unloading(jsonb) to authenticated;

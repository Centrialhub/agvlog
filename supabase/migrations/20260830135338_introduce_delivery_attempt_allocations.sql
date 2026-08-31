-- LOCAL CANDIDATE, STAGE A: private attempt foundation, ACTIVATION CLOSED.
-- No public re-delivery mutation is added; no historical rows are reset.
-- Not a standalone production release. See docs/qa/TENTATIVAS-ENTREGA-2026-08-30.md.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$
declare c record;
begin
 if to_regclass('public.delivery_attempts') is not null then raise exception 'Delivery attempt contract already exists';end if;
 for c in select * from(values
  ('public.record_operation_document_correction(jsonb)','be885bd42fe5a3a6b97840d97d571173'),
  ('public.record_operation_document_outcome(jsonb)','bc9c55ae4aeea3a7fe53227ba34cbf30'),
  ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','c3ce3d1b62954f5fc4d91567ad51f477'),
  ('public._guard_recorded_delivery_document()','aa2546392b8791f9ad25e70152a70925'),
  ('public._preserve_delivery_document_outcome()','d64c6d648e261271ac86a97e46701450'),
  ('public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamptz)','87045bcd032515b747b8427f76d10626')
 ) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Delivery attempt dependency changed: %',c.signature;end if;
 end loop;
end;
$guard$;

create table public.delivery_attempts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 fiscal_document_id uuid not null references public.fiscal_documents(id),
 previous_attempt_id uuid references public.delivery_attempts(id),
 previous_outcome_id uuid not null unique references public.delivery_document_outcomes(id),
 source_allocation_id uuid not null unique references public.dispatch_stop_documents(id),
 event_id uuid not null unique references public.dispatch_events(id),
 actor_id uuid not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 source_document_snapshot jsonb not null,source_items_snapshot jsonb not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
 financial_snapshot jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 check(previous_attempt_id is distinct from id)
);
create index delivery_attempts_tenant_doc_idx on public.delivery_attempts(tenant_id,fiscal_document_id);
create index delivery_attempts_document_idx on public.delivery_attempts(fiscal_document_id);
create index delivery_attempts_previous_idx on public.delivery_attempts(previous_attempt_id);
alter table public.delivery_attempts enable row level security;
revoke all on public.delivery_attempts from public,anon,authenticated,service_role;
grant select on public.delivery_attempts to authenticated,service_role;
create policy delivery_attempts_operator_read on public.delivery_attempts for select to authenticated
 using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id));
create trigger preserve_delivery_attempt before update or delete on public.delivery_attempts
 for each row execute function public._preserve_delivery_document_outcome();

alter table public.fiscal_documents add column current_delivery_attempt_id uuid references public.delivery_attempts(id);
alter table public.load_items add column delivery_attempt_id uuid references public.delivery_attempts(id),
 add column source_delivery_item_id uuid references public.load_items(id);
alter table public.dispatch_stop_documents add column delivery_attempt_id uuid references public.delivery_attempts(id);
alter table public.delivery_document_outcomes add column delivery_attempt_id uuid references public.delivery_attempts(id);
create index fiscal_documents_current_attempt_idx on public.fiscal_documents(current_delivery_attempt_id);
create index load_items_attempt_idx on public.load_items(delivery_attempt_id);
create index load_items_source_delivery_idx on public.load_items(source_delivery_item_id);
create index dispatch_stop_documents_attempt_idx on public.dispatch_stop_documents(delivery_attempt_id);
create index delivery_document_outcomes_attempt_idx on public.delivery_document_outcomes(delivery_attempt_id);

-- NULL is the original attempt: adding the contract does not rewrite past data.
create view public.current_load_items with(security_invoker=true) as
 select i.* from public.load_items i where i.fiscal_document_id is null or exists(
  select 1 from public.fiscal_documents f where f.id=i.fiscal_document_id
   and f.current_delivery_attempt_id is not distinct from i.delivery_attempt_id);
create view public.current_dispatch_stop_documents with(security_invoker=true) as
 select d.* from public.dispatch_stop_documents d where exists(
  select 1 from public.fiscal_documents f where f.id=d.fiscal_document_id
   and d.delivery_attempt_id is not distinct from f.current_delivery_attempt_id);
create or replace view public.current_delivery_document_outcomes with(security_invoker=true) as
 select h.* from public.delivery_document_outcomes h where not exists(
  select 1 from public.delivery_document_corrections c where c.previous_outcome_id=h.id);
create view public.active_delivery_document_outcomes with(security_invoker=true) as
 select h.* from public.current_delivery_document_outcomes h join public.fiscal_documents f on f.id=h.fiscal_document_id
 where h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id;
revoke all on public.current_load_items,public.current_dispatch_stop_documents,public.active_delivery_document_outcomes from public,anon,authenticated,service_role;

create function public._delivery_allocation_document(_allocation uuid)
returns public.fiscal_documents language plpgsql stable security invoker set search_path='' as $fn$
declare d public.dispatch_stop_documents%rowtype;f public.fiscal_documents%rowtype;j jsonb;
begin
 select * into strict d from public.dispatch_stop_documents where id=_allocation;
 select * into strict f from public.fiscal_documents where id=d.fiscal_document_id;
 if d.delivery_attempt_id is not distinct from f.current_delivery_attempt_id then return f;end if;
 select source_document_snapshot into strict j from public.delivery_attempts where source_allocation_id=d.id
  and tenant_id=d.tenant_id and fiscal_document_id=d.fiscal_document_id;
 return jsonb_populate_record(null::public.fiscal_documents,j);
end;
$fn$;
revoke all on function public._delivery_allocation_document(uuid) from public,anon,authenticated,service_role;
create view public.delivery_allocation_documents with(security_invoker=true) as
 select d.id allocation_id,x.* from public.dispatch_stop_documents d
 cross join lateral public._delivery_allocation_document(d.id) x;
revoke all on public.delivery_allocation_documents from public,anon,authenticated,service_role;

create function public._validate_delivery_attempt() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare h public.delivery_document_outcomes%rowtype;f public.fiscal_documents%rowtype;e public.dispatch_events%rowtype;
 r jsonb;j jsonb;x jsonb;v_sources jsonb;
begin
 select * into strict h from public.current_delivery_document_outcomes where id=new.previous_outcome_id;
 select * into strict f from public.fiscal_documents where id=new.fiscal_document_id;
 select * into strict e from public.dispatch_events where id=new.event_id;
 if new.actor_id is distinct from auth.uid() or not coalesce(public.is_tenant_operator_or_admin(new.tenant_id),false)
  or h.tenant_id<>new.tenant_id or f.tenant_id<>new.tenant_id
  or h.fiscal_document_id<>f.id or h.dispatch_stop_document_id<>new.source_allocation_id
  or h.delivery_attempt_id is distinct from new.previous_attempt_id or f.current_delivery_attempt_id is distinct from new.previous_attempt_id
  or h.load_id is distinct from f.load_id or h.outcome is distinct from f.status
  or h.outcome not in('returned','refused','failed','not_delivered','partial_delivery')
  or e.created_by is distinct from new.actor_id or e.tenant_id<>new.tenant_id or e.event_type<>'redelivery_requested'
  or e.dispatch_trip_id<>h.dispatch_trip_id or e.dispatch_stop_id<>h.dispatch_stop_id
  or e.payload->>'source' is distinct from 'operation'
  or e.payload->>'document_id' is distinct from f.id::text or e.payload->>'attempt_id' is distinct from new.id::text
  or new.source_document_snapshot is distinct from to_jsonb(f) then
  raise exception 'Invalid delivery attempt chain' using errcode='23514';end if;
 r:=public._delivery_redelivery_remainder(h.id);
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into v_sources from public.load_items i
  where i.fiscal_document_id=f.id and i.delivery_attempt_id is not distinct from f.current_delivery_attempt_id;
 if new.source_items_snapshot is distinct from v_sources
  or new.financial_snapshot is distinct from public._delivery_attempt_financial_snapshot(h.tenant_id,h.dispatch_trip_id)
  or jsonb_typeof(new.items) is distinct from 'array' or jsonb_array_length(new.items)<>jsonb_array_length(r->'items') then
  raise exception 'Invalid delivery attempt snapshots' using errcode='23514';end if;
 if (select count(distinct item->>'id') from jsonb_array_elements(new.items) item)<>jsonb_array_length(new.items)
  or (select count(distinct item->>'source_item_id') from jsonb_array_elements(new.items) item)<>jsonb_array_length(new.items) then
  raise exception 'Duplicated delivery remainder item' using errcode='23514';end if;
 for j in select value from jsonb_array_elements(new.items) loop
  select value into x from jsonb_array_elements(r->'items') where value->>'id'=j->>'source_item_id';
  if x is null or jsonb_typeof(j) is distinct from 'object'
   or coalesce(j->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or exists(select 1 from public.load_items where id=(j->>'id')::uuid)
   or jsonb_typeof(j->'quantity') is distinct from 'number' or j->'quantity' is distinct from x->'remaining_quantity'
   or jsonb_typeof(j->'pallet_count') is distinct from 'number' or (j->>'pallet_count')::numeric<0
   or (j->>'pallet_count')::numeric<>trunc((j->>'pallet_count')::numeric) or (j->>'pallet_count')::numeric>2147483647
   or jsonb_typeof(j->'weight_kg') is distinct from 'number' or (j->>'weight_kg')::numeric<0
   or jsonb_typeof(j->'volume_m3') is distinct from 'number' or (j->>'volume_m3')::numeric<0
   or jsonb_typeof(j->'item_description') is distinct from 'string' or length(btrim(j->>'item_description')) not between 1 and 2000
   or exists(select 1 from jsonb_object_keys(j) k where k not in('id','source_item_id','quantity','pallet_count','weight_kg','volume_m3','item_description')) then
   raise exception 'Invalid delivery remainder item' using errcode='23514';end if;
 end loop;
 return new;
end;
$fn$;
revoke all on function public._validate_delivery_attempt() from public,anon,authenticated,service_role;
create trigger validate_delivery_attempt before insert on public.delivery_attempts
 for each row execute function public._validate_delivery_attempt();

-- Private integrity trigger, including legacy SD writers. No browser API grants.
create function public._guard_delivery_allocation_rows() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;j jsonb;v_doc uuid;
begin
 if tg_op='UPDATE' and (new.fiscal_document_id is distinct from old.fiscal_document_id
  or new.delivery_attempt_id is distinct from old.delivery_attempt_id) then
  raise exception 'Delivery allocation identity is immutable' using errcode='23514';end if;
 v_doc:=case when tg_op='INSERT' then new.fiscal_document_id else old.fiscal_document_id end;
 if v_doc is null then
  if tg_op='DELETE' then return old;end if;
  if new.delivery_attempt_id is not null then raise exception 'Manual cargo cannot use a fiscal delivery attempt' using errcode='23514';end if;
  if tg_table_name='load_items' then
   if new.source_delivery_item_id is not null then raise exception 'Manual cargo cannot use a fiscal delivery attempt' using errcode='23514';end if;
  end if;
  return new;
 end if;
 select * into strict f from public.fiscal_documents where id=v_doc for share nowait;
 if tg_op<>'INSERT' then
  if old.delivery_attempt_id is distinct from f.current_delivery_attempt_id
   or exists(select 1 from public.current_delivery_document_outcomes h where h.fiscal_document_id=v_doc
    and h.delivery_attempt_id is not distinct from old.delivery_attempt_id and h.load_id=old.load_id) then
   raise exception 'Historical delivery allocation is immutable' using errcode='55000';end if;
  if tg_op='DELETE' then return old;end if;
 else
  if new.delivery_attempt_id is not null and new.delivery_attempt_id is distinct from f.current_delivery_attempt_id then
   raise exception 'Delivery attempt is not current' using errcode='23514';end if;
  new.delivery_attempt_id:=f.current_delivery_attempt_id;
  if exists(select 1 from public.current_delivery_document_outcomes h where h.fiscal_document_id=v_doc
   and h.delivery_attempt_id is not distinct from new.delivery_attempt_id) then
   raise exception 'Recorded delivery attempt cannot receive new allocations' using errcode='55000';end if;
 end if;
 if new.tenant_id is distinct from f.tenant_id then raise exception 'Delivery allocation tenant mismatch' using errcode='23514';end if;
 if tg_table_name='load_items' then
  if new.delivery_attempt_id is null and new.source_delivery_item_id is not null then
   raise exception 'Original item cannot reference a previous attempt' using errcode='23514';end if;
  if new.delivery_attempt_id is not null then
   select item into j from public.delivery_attempts a cross join lateral jsonb_array_elements(a.items) item
    where a.id=new.delivery_attempt_id and item->>'id'=new.id::text;
   if j is null or new.quantity is distinct from (j->>'quantity')::numeric
    or new.source_delivery_item_id is distinct from (j->>'source_item_id')::uuid then
    raise exception 'Redelivery items must match their recorded remainder' using errcode='23514';end if;
  end if;
 end if;
 return new;
exception when lock_not_available then raise exception 'delivery_attempt_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public._guard_delivery_allocation_rows() from public,anon,authenticated,service_role;
create trigger guard_delivery_item_attempt before insert or update or delete on public.load_items
 for each row execute function public._guard_delivery_allocation_rows();
create trigger guard_delivery_stop_attempt before insert or update or delete on public.dispatch_stop_documents
 for each row execute function public._guard_delivery_allocation_rows();

create function public._guard_delivery_attempt_head() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare a public.delivery_attempts%rowtype;
begin
 if new.current_delivery_attempt_id is not distinct from old.current_delivery_attempt_id then return new;end if;
 select * into a from public.delivery_attempts where id=new.current_delivery_attempt_id;
 if not found or a.previous_attempt_id is distinct from old.current_delivery_attempt_id
  or a.tenant_id<>new.tenant_id or a.fiscal_document_id<>new.id or a.actor_id is distinct from auth.uid()
  or a.source_document_snapshot is distinct from to_jsonb(old) then
  raise exception 'Delivery attempt requires an audited transition' using errcode='23514';end if;
 return new;
end;
$fn$;
revoke all on function public._guard_delivery_attempt_head() from public,anon,authenticated,service_role;
create trigger guard_delivery_attempt_head before update of current_delivery_attempt_id on public.fiscal_documents
 for each row execute function public._guard_delivery_attempt_head();

-- A single source of remaining quantities. It reads the immutable outcome and
-- the event which produced it, never the current UI's editable metadata. Values
-- and units are per source item; no proportional pallets/weights are invented.
create function public._delivery_redelivery_remainder(_outcome uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare h public.delivery_document_outcomes%rowtype;f public.fiscal_documents%rowtype;
 d public.dispatch_stop_documents%rowtype;e public.dispatch_events%rowtype;
 i public.load_items%rowtype;j jsonb;m jsonb;v_quantity numeric;v_total numeric:=0;v_remaining numeric:=0;
 v_items jsonb:='[]'::jsonb;v_original jsonb;
begin
 select * into h from public.current_delivery_document_outcomes where id=_outcome;
 if not found then raise exception 'redelivery_requires_current_outcome' using errcode='23514';end if;
 select * into strict f from public.fiscal_documents where id=h.fiscal_document_id;
 select * into strict d from public.dispatch_stop_documents where id=h.dispatch_stop_document_id;
 select * into strict e from public.dispatch_events where id=h.event_id;
 if h.tenant_id is distinct from f.tenant_id or d.tenant_id is distinct from f.tenant_id
  or e.tenant_id is distinct from f.tenant_id or d.fiscal_document_id is distinct from f.id
  or d.dispatch_stop_id is distinct from h.dispatch_stop_id or e.dispatch_stop_id is distinct from h.dispatch_stop_id
  or e.dispatch_trip_id is distinct from h.dispatch_trip_id or d.load_id is distinct from h.load_id
  or h.load_id is distinct from f.load_id or h.outcome is distinct from f.status
  or h.delivery_attempt_id is distinct from f.current_delivery_attempt_id
  or d.delivery_attempt_id is distinct from f.current_delivery_attempt_id
  or (select count(*) from public.active_delivery_document_outcomes where fiscal_document_id=f.id)<>1
  or (select count(*) from public.current_dispatch_stop_documents where fiscal_document_id=f.id)<>1 then
  raise exception 'redelivery_source_changed' using errcode='23514';end if;
 if h.outcome not in('returned','refused','failed','not_delivered','partial_delivery') then
  raise exception 'redelivery_requires_undelivered_balance' using errcode='23514';end if;
 if jsonb_typeof(h.items_snapshot) is distinct from 'array' or jsonb_array_length(h.items_snapshot)=0 then
  raise exception 'redelivery_source_items_missing' using errcode='23514';end if;
 m:=case when h.source='driver' then e.payload#>'{delivery_request,details,returned_items}' else e.payload->'returned_items' end;
 if h.outcome='partial_delivery' and jsonb_typeof(m) is distinct from 'object' then
  raise exception 'redelivery_partial_balance_missing' using errcode='23514';end if;
 for i in select * from public.load_items where fiscal_document_id=f.id
  and delivery_attempt_id is not distinct from h.delivery_attempt_id order by id loop
  select value into v_original from jsonb_array_elements(h.items_snapshot) where value->>'id'=i.id::text;
  if v_original is null or i.tenant_id is distinct from h.tenant_id or i.load_id is distinct from h.load_id
   or i.quantity is null or i.quantity<=0 or i.quantity::text in('NaN','Infinity','-Infinity')
   or jsonb_typeof(v_original->'quantity') is distinct from 'number'
   or (v_original->>'quantity')::numeric is distinct from i.quantity
   or (v_original-array['delivery_attempt_id','source_delivery_item_id','updated_at'])
    is distinct from (to_jsonb(i)-array['delivery_attempt_id','source_delivery_item_id','updated_at']) then
   raise exception 'redelivery_source_items_changed' using errcode='23514';end if;
  v_total:=v_total+i.quantity;
  if h.outcome='partial_delivery' then
   j:=m->i.id::text;
   if j is not null and jsonb_typeof(j)<>'number' then raise exception 'redelivery_invalid_balance' using errcode='23514';end if;
   v_quantity:=coalesce((j::text)::numeric,0);
  else v_quantity:=i.quantity;end if;
  if v_quantity<0 or v_quantity>i.quantity then raise exception 'redelivery_invalid_balance' using errcode='23514';end if;
  v_remaining:=v_remaining+v_quantity;
  if v_quantity>0 then v_items:=v_items||jsonb_build_array(to_jsonb(i)||jsonb_build_object('remaining_quantity',v_quantity));end if;
 end loop;
 if v_total<=0 or v_remaining<=0 or (h.outcome='partial_delivery' and v_remaining>=v_total)
  or (select count(*) from public.load_items where fiscal_document_id=f.id and delivery_attempt_id is not distinct from h.delivery_attempt_id)
   <>jsonb_array_length(h.items_snapshot) then raise exception 'redelivery_invalid_balance' using errcode='23514';end if;
 -- Driver events can include several notes; all keys must belong to this event's
 -- recorded item snapshots. Operation corrections are scoped to exactly one note.
 if h.outcome='partial_delivery' and exists(select 1 from jsonb_each(m) r where
  jsonb_typeof(r.value)<>'number' or not exists(select 1 from public.delivery_document_outcomes x
   cross join lateral jsonb_array_elements(x.items_snapshot) item
   where x.event_id=h.event_id and x.tenant_id=h.tenant_id and item->>'id'=r.key
    and (h.source='driver' or x.id=h.id))) then raise exception 'redelivery_invalid_balance' using errcode='23514';end if;
 return jsonb_build_object('outcome_id',h.id,'source_allocation_id',d.id,'tenant_id',h.tenant_id,
  'document_id',h.fiscal_document_id,'previous_attempt_id',h.delivery_attempt_id,'load_id',h.load_id,
  'trip_id',h.dispatch_trip_id,'stop_id',h.dispatch_stop_id,'outcome',h.outcome,'items',v_items);
end;
$fn$;
revoke all on function public._delivery_redelivery_remainder(uuid) from public,anon,authenticated,service_role;

create function public._delivery_attempt_financial_snapshot(_tenant uuid,_trip uuid)
returns jsonb language sql stable security invoker set search_path='' as $fn$
 select coalesce((select jsonb_build_object('settlement',to_jsonb(s),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by id) from public.driver_settlement_items i where settlement_id=s.id),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.driver_settlement_payments p where settlement_id=s.id),'[]'::jsonb))
  from public.driver_settlements s where tenant_id=_tenant and dispatch_trip_id=_trip),'{}'::jsonb);
$fn$;
revoke all on function public._delivery_attempt_financial_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

-- Activation remains closed until ALL canonical writers/readers are adapted.
-- No API can create an attempt or advance its head in this additive stage.
create function public._delivery_attempt_activation_gate() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
 if (tg_op='INSERT' and new.current_delivery_attempt_id is not null)
  or (tg_op='UPDATE' and new.current_delivery_attempt_id is distinct from old.current_delivery_attempt_id) then
  raise exception 'delivery_attempt_activation_not_ready' using errcode='55000';end if;
 return new;
end;
$fn$;
revoke all on function public._delivery_attempt_activation_gate() from public,anon,authenticated,service_role;
create trigger delivery_attempt_activation_gate before insert or update of current_delivery_attempt_id on public.fiscal_documents
 for each row execute function public._delivery_attempt_activation_gate();

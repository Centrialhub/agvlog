-- Recorded money is separate from statement evidence and expense composition.
-- Additive foundation: legacy writers are migrated in subsequent steps.
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon;
grant usage on schema finance_private to authenticated;

create function finance_private.can_access(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text in ('owner','admin','operator'))
 and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text='driver')
 and not exists(select 1 from public.drivers d where d.tenant_id=_tenant
   and d.user_id=auth.uid() and d.active);
$$;
revoke all on function finance_private.can_access(uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.can_access(uuid) to authenticated,service_role;

create table public.finance_movements (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 bank_account_id uuid not null references public.bank_accounts(id),
 direction text not null check(direction in ('in','out')),
 nature text not null check(nature in ('driver_advance','payment','receipt','transfer','refund','customer_advance','other')),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 occurred_on date not null, description text not null check(length(btrim(description)) between 1 and 1000),
 beneficiary_name text not null check(length(btrim(beneficiary_name)) between 1 and 300),
 beneficiary_document text, driver_id uuid references public.drivers(id),
 bank_reference text, receipt_path text,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id)
);
create index finance_movements_account_date on public.finance_movements(tenant_id,bank_account_id,occurred_on,id);
create index finance_movements_driver_date on public.finance_movements(tenant_id,driver_id,occurred_on);
-- Reference is evidence, not a globally unique value. Duplicate identities are
-- checked in commands; manual review must resolve ambiguous imported references.

create table public.finance_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 entity_type text not null, entity_id uuid not null, action text not null,
 actor_id uuid not null, actor_name text not null,
 reason text not null check(length(btrim(reason)) between 5 and 2000),
 before_data jsonb, after_data jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index finance_events_entity on public.finance_events(tenant_id,entity_type,entity_id,created_at,id);

create table public.finance_commands (
 tenant_id uuid not null references public.tenants(id), request_id uuid not null,
 actor_id uuid not null, action text not null, payload jsonb not null,
 result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,request_id)
);

create function finance_private.preserve_event() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'finance_immutable_record' using errcode='55000'; end;
$$;
revoke all on function finance_private.preserve_event() from public,anon,authenticated,service_role;
create trigger preserve_finance_event before update or delete on public.finance_events
 for each row execute function finance_private.preserve_event();
create trigger preserve_finance_command before update or delete on public.finance_commands
 for each row execute function finance_private.preserve_event();
create trigger preserve_finance_movement before update or delete on public.finance_movements
 for each row execute function finance_private.preserve_event();

alter table public.finance_movements enable row level security;
alter table public.finance_events enable row level security;
alter table public.finance_commands enable row level security;
revoke all on public.finance_movements,public.finance_events,public.finance_commands from public,anon,authenticated,service_role;
grant select on public.finance_movements,public.finance_events to authenticated,service_role;
create policy finance_movements_read on public.finance_movements for select to authenticated
 using(finance_private.can_access(tenant_id));
create policy finance_events_read on public.finance_events for select to authenticated
 using(finance_private.can_access(tenant_id));

create function finance_private.record_movement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 t uuid; actor uuid:=auth.uid(); request uuid; existing public.finance_commands%rowtype;
 movement uuid; account uuid; driver uuid; cents bigint; result jsonb; actor_name text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 t:=(_payload->>'tenant_id')::uuid; request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501'; end if;
 if request is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in
 ('version','tenant_id','request_id','bank_account_id','direction','nature','amount_cents','occurred_on',
  'description','beneficiary_name','beneficiary_document','driver_id','bank_reference','receipt_path','reason')) then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 -- Serializes retries and reference checks, including requests with different IDs.
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if existing.actor_id<>actor or existing.action<>'record_movement' or existing.payload<>_payload then
   raise exception 'finance_request_conflict' using errcode='23505'; end if;
  return existing.result;
 end if;
 if coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or coalesce(_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' then
  raise exception 'finance_invalid_payload' using errcode='22023'; end if;
 cents:=(_payload->>'amount_cents')::bigint;
 if cents<=0 or (_payload->>'occurred_on')::date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then
  raise exception 'finance_invalid_realized_movement' using errcode='22023'; end if;
 account:=(_payload->>'bank_account_id')::uuid; driver:=nullif(_payload->>'driver_id','')::uuid;
 perform 1 from public.bank_accounts where id=account and tenant_id=t and active for share;
 if not found then raise exception 'finance_invalid_account' using errcode='22023'; end if;
 if driver is not null then
  perform 1 from public.drivers where id=driver and tenant_id=t and active for share;
  if not found then raise exception 'finance_invalid_driver' using errcode='22023'; end if;
 end if;
 if _payload->>'nature'='driver_advance' and (driver is null or _payload->>'direction' is distinct from 'out') then
  raise exception 'finance_invalid_driver_advance' using errcode='22023'; end if;
 if (_payload->>'nature' in ('receipt','customer_advance') and _payload->>'direction' is distinct from 'in')
 or (_payload->>'nature'='payment' and _payload->>'direction' is distinct from 'out') then
  raise exception 'finance_invalid_direction' using errcode='22023';end if;
 if nullif(btrim(_payload->>'receipt_path'),'') is not null and
  ((_payload->>'receipt_path') not like t::text||'/%' or (_payload->>'receipt_path') like '%..%') then
  raise exception 'finance_invalid_receipt_scope' using errcode='22023'; end if;
 if nullif(btrim(_payload->>'bank_reference'),'') is not null and exists(
  select 1 from public.finance_movements where tenant_id=t and bank_account_id=account
   and bank_reference=btrim(_payload->>'bank_reference')) then
  raise exception 'finance_reference_already_recorded' using errcode='23505'; end if;
 insert into public.finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,
  description,beneficiary_name,beneficiary_document,driver_id,bank_reference,receipt_path,created_by)
 values(t,account,_payload->>'direction',_payload->>'nature',cents,(_payload->>'occurred_on')::date,
  btrim(_payload->>'description'),btrim(_payload->>'beneficiary_name'),nullif(btrim(_payload->>'beneficiary_document'),''),
  driver,nullif(btrim(_payload->>'bank_reference'),''),nullif(btrim(_payload->>'receipt_path'),''),actor)
 returning id into movement;
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 select t,'movement',movement,'recorded',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),to_jsonb(m)
 from public.finance_movements m where m.id=movement;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'movement_id',movement,'confirmed',true);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 values(t,request,actor,'record_movement',_payload,result);
 return result;
end;
$$;
revoke all on function finance_private.record_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.record_movement(jsonb) to authenticated;
create function public.record_finance_movement(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.record_movement(_payload);$$;
revoke all on function public.record_finance_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_finance_movement(jsonb) to authenticated;

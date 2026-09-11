-- Settlements generated before cargo custody became authoritative are retained
-- as history but cannot be approved, paid or exposed as usable finance data.
create table public.driver_settlement_cargo_quarantines(
  settlement_id uuid primary key references public.driver_settlements(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  status text not null default 'pending' check(status in('pending','resolved')),
  reason text not null,
  detected_at timestamptz not null default clock_timestamp(),
  detected_snapshot jsonb not null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_reason text,
  resolution_snapshot jsonb,
  check((status='pending' and resolved_at is null and resolved_by is null and resolution_reason is null)
    or(status='resolved' and resolved_at is not null and resolved_by is not null
      and length(btrim(resolution_reason)) between 10 and 1000 and resolution_snapshot is not null))
);
create index driver_settlement_cargo_quarantine_queue_idx
  on public.driver_settlement_cargo_quarantines(tenant_id,status,detected_at,settlement_id);
alter table public.driver_settlement_cargo_quarantines enable row level security;
revoke all on table public.driver_settlement_cargo_quarantines from public,anon,authenticated,service_role;
grant select on table public.driver_settlement_cargo_quarantines to authenticated;
grant all on table public.driver_settlement_cargo_quarantines to service_role;
create policy driver_settlement_cargo_quarantine_read on public.driver_settlement_cargo_quarantines
for select to authenticated using(private.request_tenant_id()=tenant_id
  and public.is_tenant_operator_or_admin(tenant_id) and finance_private.can_access(tenant_id));

create table public.trip_cargo_historical_reconciliations(
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  control_id uuid not null references public.trip_cargo_controls(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  payload_hash text not null check(payload_hash~'^[0-9a-f]{32}$'),
  reason text not null check(length(btrim(reason)) between 20 and 1000),
  evidence_snapshot jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,dispatch_trip_id)
);
alter table public.trip_cargo_historical_reconciliations enable row level security;
revoke all on table public.trip_cargo_historical_reconciliations from public,anon,authenticated,service_role;
grant select on table public.trip_cargo_historical_reconciliations to authenticated;
grant all on table public.trip_cargo_historical_reconciliations to service_role;
create policy trip_cargo_historical_reconciliation_read on public.trip_cargo_historical_reconciliations
for select to authenticated using(private.request_tenant_id()=tenant_id and public.is_tenant_admin(tenant_id));

with inserted as (
  insert into public.driver_settlement_cargo_quarantines(
    settlement_id,tenant_id,dispatch_trip_id,reason,detected_snapshot)
  select settlement.id,settlement.tenant_id,settlement.dispatch_trip_id,
    'legacy_settlement_created_before_cargo_close_gate',
    jsonb_build_object('settlement_status',settlement.status,'driver_payable_amount',settlement.driver_payable_amount,
      'total_paid_amount',settlement.total_paid_amount,'payment_balance',settlement.payment_balance,
      'trip_id',settlement.dispatch_trip_id)
  from public.driver_settlements settlement
  where settlement.dispatch_trip_id is not null
    and not private.trip_cargo_is_closed_v1(settlement.tenant_id,settlement.dispatch_trip_id)
  on conflict do nothing returning *
)
select public._log_entity_audit(inserted.tenant_id,'driver_settlement',inserted.settlement_id,
  'cargo_close_quarantined',null,inserted.detected_snapshot||jsonb_build_object(
    'quarantine_status','pending','reason',inserted.reason),'cargo_close_gate_migration') from inserted;

create or replace function private.driver_settlement_is_cargo_released_v1(_tenant_id uuid,_settlement_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select coalesce((select settlement.dispatch_trip_id is null or (
      private.trip_cargo_is_closed_v1(settlement.tenant_id,settlement.dispatch_trip_id)
      and not exists(select 1 from public.driver_settlement_cargo_quarantines quarantine
        where quarantine.settlement_id=settlement.id and quarantine.status='pending'))
    from public.driver_settlements settlement
    where settlement.tenant_id=_tenant_id and settlement.id=_settlement_id),false)
$function$;
revoke all on function private.driver_settlement_is_cargo_released_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.can_read_driver_settlement_cargo_v1(
  _tenant_id uuid,_settlement_id uuid
) returns boolean language plpgsql stable security definer set search_path='' as $function$
begin
  if auth.uid() is null
    or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_operator_or_admin(_tenant_id)
    or not finance_private.can_access(_tenant_id) then
    return false;
  end if;
  return private.driver_settlement_is_cargo_released_v1(_tenant_id,_settlement_id);
end;$function$;
revoke all on function private.can_read_driver_settlement_cargo_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_driver_settlement_cargo_v1(uuid,uuid) to authenticated;

create or replace function private.resolve_driver_settlement_cargo_quarantine_v1(
  _tenant_id uuid,_settlement_id uuid,_actor_id uuid,_reason text
) returns boolean language plpgsql security definer set search_path='' as $function$
declare v_row public.driver_settlement_cargo_quarantines%rowtype;v_snapshot jsonb;
begin
  select * into v_row from public.driver_settlement_cargo_quarantines
    where tenant_id=_tenant_id and settlement_id=_settlement_id for update;
  if not found or v_row.status='resolved' then return false;end if;
  if not private.trip_cargo_is_closed_v1(_tenant_id,v_row.dispatch_trip_id) then
    raise exception 'trip_cargo_not_closed' using errcode='23514';end if;
  v_snapshot:=jsonb_build_object('trip_id',v_row.dispatch_trip_id,'cargo_closed',true,
    'settlement_id',v_row.settlement_id);
  update public.driver_settlement_cargo_quarantines set status='resolved',resolved_at=clock_timestamp(),
    resolved_by=_actor_id,resolution_reason=btrim(_reason),resolution_snapshot=v_snapshot
    where settlement_id=v_row.settlement_id;
  perform public._log_entity_audit(_tenant_id,'driver_settlement',v_row.settlement_id,
    'cargo_close_quarantine_resolved',jsonb_build_object('status','pending'),
    v_snapshot||jsonb_build_object('status','resolved','reason',btrim(_reason)),'cargo_close_gate');
  return true;
end;$function$;
revoke all on function private.resolve_driver_settlement_cargo_quarantine_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.reconcile_driver_settlement_cargo_quarantine_v1(
  _tenant_id uuid,_settlement_id uuid,_reason text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_changed boolean;
begin
  perform finance_private.require_access(_tenant_id);
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_operator_or_admin(_tenant_id)
    or length(btrim(coalesce(_reason,''))) not between 10 and 1000 then
    raise exception 'settlement_cargo_reconciliation_not_authorized' using errcode='42501';end if;
  v_changed:=private.resolve_driver_settlement_cargo_quarantine_v1(
    _tenant_id,_settlement_id,auth.uid(),_reason);
  return jsonb_build_object('version',1,'settlement_id',_settlement_id,'released',
    private.driver_settlement_is_cargo_released_v1(_tenant_id,_settlement_id),'changed',v_changed);
end;$function$;
revoke all on function public.reconcile_driver_settlement_cargo_quarantine_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_driver_settlement_cargo_quarantine_v1(uuid,uuid,text) to authenticated;

create or replace function public.reconcile_historical_trip_cargo_v1(
  _tenant_id uuid,_trip_id uuid,_request_id uuid,_reason text,_evidence_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_existing public.trip_cargo_historical_reconciliations%rowtype;
  v_control public.trip_cargo_controls%rowtype;v_hash text;v_result jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_admin(_tenant_id) then
    raise exception 'historical_cargo_reconciliation_not_authorized' using errcode='42501';end if;
  if _request_id is null or length(btrim(coalesce(_reason,''))) not between 20 and 1000
    or jsonb_typeof(_evidence_snapshot) is distinct from 'object'
    or length(btrim(coalesce(_evidence_snapshot->>'basis','')))<10
    or pg_catalog.octet_length(_evidence_snapshot::text)>131072 then
    raise exception 'historical_cargo_reconciliation_invalid' using errcode='22023';end if;
  v_hash:=md5(jsonb_build_object('tenant_id',_tenant_id,'trip_id',_trip_id,
    'reason',btrim(_reason),'evidence_snapshot',_evidence_snapshot)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'trip_cargo_historical:'||_tenant_id::text||':'||_trip_id::text,0));
  select * into v_existing from public.trip_cargo_historical_reconciliations
    where request_id=_request_id;
  if found then
    if v_existing.tenant_id<>_tenant_id or v_existing.dispatch_trip_id<>_trip_id
      or v_existing.actor_id<>auth.uid() or v_existing.payload_hash<>v_hash then
      raise exception 'historical_cargo_reconciliation_request_conflict' using errcode='23505';end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;
  select * into v_trip from public.dispatch_trips where tenant_id=_tenant_id and id=_trip_id for update;
  if not found then raise exception 'trip_not_found' using errcode='P0002';end if;
  if v_trip.status<>'completed' or v_trip.actual_end_at is null or v_trip.driver_id is null or v_trip.vehicle_id is null then
    raise exception 'historical_cargo_trip_not_reconcilable' using errcode='23514';end if;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id
    and dispatch_trip_id=_trip_id for update;
  if found then raise exception 'historical_cargo_control_already_exists' using errcode='23505';end if;
  insert into public.trip_cargo_controls(tenant_id,dispatch_trip_id,driver_id,vehicle_id,status,
    seal_not_applicable_reason,closed_at,closed_by,close_override_reason)
  values(_tenant_id,_trip_id,v_trip.driver_id,v_trip.vehicle_id,'closed',
    'Reconciliação histórica sem registro digital de lacre',clock_timestamp(),auth.uid(),btrim(_reason))
  returning * into v_control;
  v_result:=jsonb_build_object('version',1,'confirmed',true,'changed',true,'tenant_id',_tenant_id,
    'trip_id',_trip_id,'control_id',v_control.id,'status','closed','request_id',_request_id,
    'quarantines_pending',(select count(*) from public.driver_settlement_cargo_quarantines
      where tenant_id=_tenant_id and dispatch_trip_id=_trip_id and status='pending'),'replayed',false);
  insert into public.trip_cargo_historical_reconciliations(request_id,tenant_id,dispatch_trip_id,
    control_id,actor_id,payload_hash,reason,evidence_snapshot,result)
  values(_request_id,_tenant_id,_trip_id,v_control.id,auth.uid(),v_hash,btrim(_reason),_evidence_snapshot,v_result);
  perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,
    'historical_cargo_reconciled',null,jsonb_build_object('trip_id',_trip_id,'request_id',_request_id,
      'reason',btrim(_reason),'evidence_snapshot',_evidence_snapshot,'status','closed'),'cargo_close_historical_reconciliation');
  return v_result;
end;$function$;
revoke all on function public.reconcile_historical_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_historical_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) to authenticated;

create or replace function private.resolve_trip_settlement_quarantines_on_close_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_row record;v_actor uuid:=coalesce(new.closed_by,auth.uid());
begin
  if new.status<>'closed' or (tg_op='UPDATE' and old.status='closed') then return new;end if;
  for v_row in select settlement_id from public.driver_settlement_cargo_quarantines
    where tenant_id=new.tenant_id and dispatch_trip_id=new.dispatch_trip_id and status='pending'
    order by settlement_id for update
  loop
    perform private.resolve_driver_settlement_cargo_quarantine_v1(new.tenant_id,v_row.settlement_id,v_actor,
      'Reconciliado automaticamente no fechamento canônico da custódia da carga');
  end loop;
  return new;
end;$function$;
revoke all on function private.resolve_trip_settlement_quarantines_on_close_v1()
  from public,anon,authenticated,service_role;
create trigger trip_cargo_closed_00_resolve_settlement_quarantines_v1
after insert or update of status on public.trip_cargo_controls
for each row execute function private.resolve_trip_settlement_quarantines_on_close_v1();

create or replace function private.guard_settlement_financial_release_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_tenant uuid;v_settlement uuid;
begin
  if tg_table_name='driver_settlement_payments' then
    v_tenant:=new.tenant_id;v_settlement:=new.settlement_id;
  else
    v_tenant:=new.tenant_id;v_settlement:=new.id;
    if new.status not in('approved','paid','closed') then return new;end if;
  end if;
  if not private.driver_settlement_is_cargo_released_v1(v_tenant,v_settlement) then
    raise exception 'driver_settlement_cargo_quarantined' using errcode='23514';end if;
  return new;
end;$function$;
revoke all on function private.guard_settlement_financial_release_v1()
  from public,anon,authenticated,service_role;
create trigger driver_settlement_status_requires_cargo_release_v1
before update of status on public.driver_settlements
for each row execute function private.guard_settlement_financial_release_v1();
create trigger driver_settlement_payment_requires_cargo_release_v1
before insert on public.driver_settlement_payments
for each row execute function private.guard_settlement_financial_release_v1();

-- Keep the historical implementation private and place the gate directly on
-- the effective financial command as well as on its target table.
alter function finance_private.record_settlement_payment(jsonb)
  rename to record_settlement_payment_without_cargo_gate_v1;
revoke all on function finance_private.record_settlement_payment_without_cargo_gate_v1(jsonb)
  from public,anon,authenticated,service_role;
create function finance_private.record_settlement_payment(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare v_tenant uuid;v_settlement uuid;
begin
  begin
    v_tenant:=(_payload->>'tenant_id')::uuid;v_settlement:=(_payload->>'settlement_id')::uuid;
  exception when others then raise exception 'finance_invalid_payload' using errcode='22023';end;
  if not private.driver_settlement_is_cargo_released_v1(v_tenant,v_settlement) then
    raise exception 'driver_settlement_cargo_quarantined' using errcode='23514';end if;
  return finance_private.record_settlement_payment_without_cargo_gate_v1(_payload);
end;$function$;
revoke all on function finance_private.record_settlement_payment(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function finance_private.record_settlement_payment(jsonb) to authenticated;

-- Direct browser reads and the security-definer list RPC omit quarantined rows.
drop policy if exists settlements_select on public.driver_settlements;
create policy settlements_select on public.driver_settlements for select to authenticated
using(private.request_tenant_id()=tenant_id and public.is_tenant_operator_or_admin(tenant_id)
  and finance_private.can_access(tenant_id)
  and private.can_read_driver_settlement_cargo_v1(tenant_id,id));

do $patch_list$
declare definition text;needle text:='WHERE s.tenant_id = _tenant_id';
begin
  definition:=pg_get_functiondef('public.list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,integer,integer)'::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then
    raise exception 'list_driver_settlements_contract_changed';end if;
  execute replace(definition,needle,needle||E'\n       AND private.driver_settlement_is_cargo_released_v1(s.tenant_id,s.id)');
end;$patch_list$;

do $policy_postcondition$
declare settlement_policy text;quarantine_policy text;
begin
  select pg_get_expr(polqual,polrelid) into settlement_policy from pg_policy
    where polrelid='public.driver_settlements'::regclass and polname='settlements_select';
  select pg_get_expr(polqual,polrelid) into quarantine_policy from pg_policy
    where polrelid='public.driver_settlement_cargo_quarantines'::regclass
      and polname='driver_settlement_cargo_quarantine_read';
  if settlement_policy not like '%request_tenant_id()%'
    or settlement_policy not like '%can_access%'
    or quarantine_policy not like '%request_tenant_id()%'
    or quarantine_policy not like '%can_access%' then
    raise exception 'settlement_cargo_quarantine_policy_contract_failed';end if;
end;$policy_postcondition$;

comment on table public.driver_settlement_cargo_quarantines is
  'Non-destructive, audited quarantine for legacy trip settlements created before canonical cargo closure.';

-- The recoverable chat migrations predate the product decision that email and
-- password are sufficient for every application role. Reapplying those
-- migrations during production recovery restored four obsolete AAL2 checks.
-- Keep the tenant, role and row boundaries while aligning chat with the
-- current authentication policy.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regprocedure('driver_chat_private.can_read(uuid,uuid,uuid)') is null
    or to_regprocedure('driver_chat_private.context(uuid,uuid)') is null
    or to_regprocedure('driver_chat_private.event_can_access(uuid,uuid)') is null
    or to_regprocedure('driver_chat_private.event_context(uuid,uuid)') is null then
    raise exception 'Recoverable driver and event chat contracts are required';
  end if;
end;
$preflight$;

create or replace function driver_chat_private.can_read(_tenant uuid, _driver uuid, _recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.drivers driver on driver.tenant_id = membership.tenant_id
    where membership.tenant_id = _tenant
      and membership.user_id = auth.uid()
      and membership.active
      and driver.id = _driver
      and (
        membership.role::text in ('owner', 'admin', 'operator')
        or (
          membership.role::text = 'driver'
          and driver.active
          and driver.user_id = auth.uid()
          and _recipient = auth.uid()
        )
      )
  );
$function$;

create or replace function driver_chat_private.context(_tenant uuid, _driver uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  driver_row public.drivers%rowtype;
  sender_name text;
  context_revision text;
  recipient_active boolean;
begin
  select membership.role::text
    into actor_role
  from public.tenant_memberships membership
  where membership.tenant_id = _tenant
    and membership.user_id = actor_id
    and membership.active;

  select *
    into driver_row
  from public.drivers
  where tenant_id = _tenant and id = _driver;

  if actor_id is null
    or actor_role is null
    or driver_row.id is null
    or not (
      actor_role in ('owner', 'admin', 'operator')
      or (actor_role = 'driver' and driver_row.user_id = actor_id and driver_row.active)
    ) then
    raise exception 'driver_chat_not_authorized' using errcode = '42501';
  end if;

  if actor_role = 'driver' then
    sender_name := driver_row.name;
  else
    select profile.full_name into sender_name from public.profiles profile where profile.id = actor_id;
  end if;

  sender_name := coalesce(nullif(btrim(sender_name), ''), case when actor_role = 'driver' then 'Motorista' else 'Operação' end);
  recipient_active := exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = _tenant
      and membership.user_id = driver_row.user_id
      and membership.active
      and membership.role::text = 'driver'
  );
  context_revision := md5(jsonb_build_object(
    'driver_id', driver_row.id,
    'tenant_id', driver_row.tenant_id,
    'driver_user', driver_row.user_id,
    'active', driver_row.active,
    'recipient_active', recipient_active,
    'role', actor_role,
    'actor', actor_id,
    'sender_name', sender_name
  )::text);

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant,
    'actor_id', actor_id,
    'driver_id', _driver,
    'driver_name', driver_row.name,
    'conversation_user_id', driver_row.user_id,
    'sender_role', actor_role,
    'sender_name', sender_name,
    'can_send', coalesce(driver_row.active and driver_row.user_id is not null and recipient_active, false),
    'revision', context_revision
  );
end;
$function$;

create or replace function driver_chat_private.event_can_access(_tenant uuid, _event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    join public.operational_events event on event.tenant_id = membership.tenant_id
    where membership.tenant_id = _tenant
      and membership.user_id = auth.uid()
      and membership.active
      and event.id = _event
      and (
        membership.role::text in ('owner', 'admin', 'operator')
        or (
          membership.role::text = 'driver'
          and exists (
            select 1
            from public.drivers driver
            where driver.tenant_id = _tenant
              and driver.id = (driver_chat_private.event_binding(_tenant, _event)->>'driver_id')::uuid
              and driver.user_id = auth.uid()
              and driver.active
          )
        )
      )
  );
$function$;

create or replace function driver_chat_private.event_context(_tenant uuid, _event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  binding jsonb;
  driver_id uuid;
  driver_row public.drivers%rowtype;
  sender_name text;
  recipient_active boolean;
  can_send boolean;
begin
  select membership.role::text
    into actor_role
  from public.tenant_memberships membership
  where membership.tenant_id = _tenant
    and membership.user_id = actor_id
    and membership.active;

  if actor_id is null
    or actor_role is null
    or not exists (select 1 from public.operational_events where tenant_id = _tenant and id = _event) then
    raise exception 'driver_chat_not_authorized' using errcode = '42501';
  end if;

  if not driver_chat_private.event_can_access(_tenant, _event) then
    raise exception 'driver_chat_not_authorized' using errcode = '42501';
  end if;

  binding := driver_chat_private.event_binding(_tenant, _event);
  if binding is null then
    raise exception 'event_chat_invalid_binding' using errcode = '23514';
  end if;

  driver_id := (binding->>'driver_id')::uuid;
  select * into driver_row from public.drivers where tenant_id = _tenant and id = driver_id;

  if actor_role = 'driver' then
    sender_name := driver_row.name;
  else
    select profile.full_name into sender_name from public.profiles profile where profile.id = actor_id;
  end if;

  sender_name := coalesce(nullif(btrim(sender_name), ''), case when actor_role = 'driver' then 'Motorista' else 'Operação' end);
  recipient_active := exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = _tenant
      and membership.user_id = driver_row.user_id
      and membership.active
      and membership.role::text = 'driver'
  );
  can_send := driver_id is null or coalesce(driver_row.active and driver_row.user_id is not null and recipient_active, false);

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant,
    'actor_id', actor_id,
    'event_id', _event,
    'driver_id', driver_id,
    'driver_name', coalesce(driver_row.name, 'Sem motorista vinculado'),
    'conversation_user_id', driver_row.user_id,
    'sender_role', actor_role,
    'sender_name', sender_name,
    'audience', case when driver_id is null then 'operation' else 'driver' end,
    'can_send', can_send,
    'revision', md5(jsonb_build_object(
      'binding', binding,
      'driver_user', driver_row.user_id,
      'active', driver_row.active,
      'recipient_active', recipient_active,
      'role', actor_role,
      'actor', actor_id,
      'sender_name', sender_name
    )::text)
  );
end;
$function$;

do $verify$
begin
  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'driver_chat_private'
      and (procedure.prosrc ~* 'aal2' or procedure.prosrc like '%session_has_privileged_mfa_v1%')
  ) then
    raise exception 'A driver chat function still requires obsolete MFA';
  end if;
end;
$verify$;

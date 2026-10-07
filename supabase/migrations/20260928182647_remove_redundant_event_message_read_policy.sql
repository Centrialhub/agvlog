-- Retire the SELECT policy left by the 2026-08 tenant-member rollout.
-- The recoverable chat rollout removed the older "Authorized users" names,
-- leaving this policy alongside the canonical permissive/restrictive pair.
-- With that pair intact, (legacy OR can_read) AND can_read equals can_read.
-- Preserve the active-tenant boundary, all writes, grants, helpers and RPCs.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $event_read_policy$
declare
  v_relation oid := pg_catalog.to_regclass('public.operational_event_messages');
  v_authenticated oid;
  v_search_path text := pg_catalog.current_setting('search_path');
  v_expected_predicate constant text :=
    'driver_chat_private.event_can_read(tenant_id, event_id, conversation_driver_id, conversation_user_id)';
begin
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);
  select oid into v_authenticated from pg_catalog.pg_roles where rolname = 'authenticated';
  if v_relation is null or v_authenticated is null
    or not exists (select 1 from pg_catalog.pg_class where oid = v_relation and relrowsecurity) then
    raise exception 'Event message read consolidation requires the existing RLS table';
  end if;

  lock table public.operational_event_messages in share row exclusive mode;
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = pg_catalog.to_regprocedure('driver_chat_private.event_can_read(uuid,uuid,uuid,uuid)')
      and provolatile = 's'
  ) or (
    select count(*) from pg_catalog.pg_policy
    where polrelid = v_relation
      and polcmd = 'r'
      and polroles = array[v_authenticated]
      and polwithcheck is null
      and pg_catalog.pg_get_expr(polqual, polrelid) = v_expected_predicate
      and ((polname = 'event_chat_read' and polpermissive)
        or (polname = 'event_chat_read_boundary' and not polpermissive))
  ) <> 2 then
    raise exception 'Event message read consolidation requires the unchanged canonical read boundary';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = v_relation and polname = 'Tenant members read event messages'
      and (not polpermissive or polcmd <> 'r'
        or polroles is distinct from array[v_authenticated]
        or polwithcheck is not null
        or pg_catalog.pg_get_expr(polqual, polrelid) is distinct from 'public.is_tenant_member(tenant_id)')
  ) then
    raise exception 'Legacy event message read policy changed; review before consolidation';
  end if;

  drop policy if exists "Tenant members read event messages" on public.operational_event_messages;
  perform pg_catalog.set_config('search_path', v_search_path, true);
end;
$event_read_policy$;

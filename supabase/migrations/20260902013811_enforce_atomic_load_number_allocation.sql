set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Number allocation is part of the canonical create command.  Keeping the
-- advisory lock and the uniqueness constraint together makes the returned
-- number a committed fact instead of a client-side prediction.
create unique index if not exists loads_tenant_load_number_unique
  on public.loads (tenant_id, load_number);

do $guard$
declare
  v_writer regprocedure;
  v_writer_row record;
  v_definition text;
  v_ledger record;
begin
  v_writer := to_regprocedure('public.apply_load_aggregate_command(jsonb)');
  if v_writer is null then
    raise exception 'apply_load_aggregate_command(jsonb) is required before retiring the load-number preview';
  end if;

  select p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) definition
    into v_writer_row
    from pg_proc p
   where p.oid = v_writer;
  v_definition := v_writer_row.definition;
  if not v_writer_row.prosecdef
     or coalesce(array_to_string(v_writer_row.proconfig, ','), '')
          not like '%search_path=pg_catalog, public, private%' then
    raise exception 'apply_load_aggregate_command(jsonb) has an unsafe execution context';
  end if;
  if position('pg_advisory_xact_lock' in v_definition) = 0
     or position('load-number:' in v_definition) = 0
     or position('l.tenant_id = v_tenant_id' in v_definition) = 0
     or position('extensions.digest' in v_definition) = 0
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'apply_load_aggregate_command(jsonb) must allocate load numbers atomically per tenant';
  end if;

  if not has_function_privilege('authenticated', v_writer, 'execute')
     or has_function_privilege('anon', v_writer, 'execute')
     or has_function_privilege('service_role', v_writer, 'execute') then
    raise exception 'apply_load_aggregate_command(jsonb) does not have the expected browser-only ACL';
  end if;

  if to_regprocedure('private.bump_load_revision()') is null
     or to_regprocedure('private.load_command_snapshot(uuid,uuid[])') is null
     or to_regprocedure('private.insert_load_from_json(jsonb)') is null
     or to_regprocedure('private.update_load_from_json(uuid,uuid,jsonb)') is null then
    raise exception 'Private load command helpers are incomplete';
  end if;
  if has_function_privilege('authenticated', 'private.bump_load_revision()'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'private.load_command_snapshot(uuid,uuid[])'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'private.insert_load_from_json(jsonb)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'private.update_load_from_json(uuid,uuid,jsonb)'::regprocedure, 'execute') then
    raise exception 'A private load command helper is executable by authenticated';
  end if;

  select c.relrowsecurity, c.relforcerowsecurity
    into v_ledger
    from pg_class c
   where c.oid = to_regclass('private.load_aggregate_commands')
     and c.relkind = 'r';
  if not found or not v_ledger.relrowsecurity
     or has_table_privilege('authenticated', 'private.load_aggregate_commands', 'select')
     or has_table_privilege('authenticated', 'private.load_aggregate_commands', 'insert')
     or has_table_privilege('authenticated', 'private.load_aggregate_commands', 'update')
     or has_table_privilege('authenticated', 'private.load_aggregate_commands', 'delete') then
    raise exception 'The private load command ledger is not isolated from authenticated';
  end if;

  if not exists (
    select 1 from pg_index i
     where i.indexrelid = to_regclass('public.loads_tenant_load_number_unique')
       and i.indrelid = 'public.loads'::regclass
       and i.indisunique and i.indisvalid and i.indisready
  ) then
    raise exception 'The tenant/load-number uniqueness index is missing or invalid';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.loads'::regclass
       and t.tgname = 'trg_zz_bump_load_revision'
       and not t.tgisinternal and t.tgenabled = 'O'
       and t.tgfoid = 'private.bump_load_revision()'::regprocedure
  ) then
    raise exception 'The final-row load revision trigger is missing';
  end if;
end;
$guard$;

-- A "next number" reader can never reserve its answer.  Removing it prevents
-- browser code (or newly generated clients) from reintroducing the TOCTOU race.
drop function if exists public.get_next_load_number_v1(uuid);

comment on function public.apply_load_aggregate_command(jsonb) is
  'Canonical authenticated load writer. Create commands that omit changes.load_number allocate it under a tenant-scoped transaction advisory lock and return the committed load row. SECURITY DEFINER is limited to this command because its idempotency ledger and audit helpers are private; actor, membership and tenant are validated inside the function.';

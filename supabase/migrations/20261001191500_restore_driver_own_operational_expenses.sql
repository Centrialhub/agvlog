-- Product decision 2026-10-01: an authenticated driver may create/read only
-- their own operational expenses. Financial approval/payment stays unchanged.
-- Forward-only. Preserve command evidence, retries, locks and private adapters.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $preflight$
declare s record;p record;
begin
 if not pg_try_advisory_xact_lock(hashtext('driver-expense-release'),1) then
  raise exception 'driver_expense_release_busy' using errcode='55000';end if;
 if to_regprocedure('expense_creation_private.owns_driver(uuid,uuid)') is not null then
  raise exception 'driver_own_expense_forward_already_applied' using errcode='55000';end if;
 for s in select * from(values
 ('expense_creation_private.create_driver_expense_command(jsonb)','d35a0b96bbed50100c089e9a5b56004e','v',true),
 ('expense_creation_private.get_expense_creation_context(uuid,text,uuid)','ae35793cfd2bac049dfa6d3baa8e1b46','v',true),
 ('expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb)','6d5efb5c89e96267a5e33b8d80a457ed','s',true),
 ('expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','c97b9da6896b538f589f2f6411072451','v',true),
 ('expense_creation_private.list_driver_expenses(uuid,integer)','881c75ec2d613560747f7226b8779f14','s',true),
 ('expense_creation_private.list_driver_expense_sources(uuid,integer)','3becb43fd804839799ec86cb6add8612','s',true),
 ('expense_creation_private.require_session(uuid,uuid)','50f478a2ba2c396de9180883fc4ef3a8','s',false),
 ('expense_creation_private.session_allowed(uuid)','000c91f9d36f72dab0ec098d43b8dce4','s',true)
 ) expected(signature,body_md5,volatility,authenticated_execute) loop
  select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang where f.oid=to_regprocedure(s.signature);
  if not found or md5(replace(p.prosrc,E'\r\n',E'\n'))<>s.body_md5
   or p.proconfig is distinct from array['search_path=""']::text[] or p.provolatile::text<>s.volatility
   or p.proowner<>'postgres'::regrole or p.prokind<>'f'
   or (s.signature not like '%require_session%' and not p.prosecdef)
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from s.authenticated_execute
   or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.privilege_type='EXECUTE' and a.grantee not in(p.proowner,'authenticated'::regrole::oid)) then
   raise exception 'driver_own_expense_contract_changed: %',s.signature using errcode='55000';end if;
 end loop;
 for s in select * from(values('driver_expenses'),('driver_expense_creations')) t(name) loop
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=s.name
   and policyname='finance_no_driver_boundary' and permissive='RESTRICTIVE' and cmd='ALL'
   and qual='finance_private.not_driver(tenant_id)' and with_check=qual)
   or not exists(select 1 from pg_policies where schemaname='public' and tablename=s.name
   and policyname='finance_active_company_boundary' and permissive='RESTRICTIVE' and cmd='ALL'
   and qual='finance_private.can_access(tenant_id)' and with_check=qual) then
   raise exception 'driver_own_expense_policy_changed: %',s.name using errcode='55000';end if;
 end loop;
end;$preflight$;

create function expense_creation_private.owns_driver(_tenant uuid,_driver uuid default null) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and coalesce(private.is_request_tenant_member(_tenant),false)
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid()
  and m.active and m.role::text in('owner','admin','operator','driver'))
 and exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=auth.uid()
  and d.active and (_driver is null or d.id=_driver));
$fn$;
revoke all on function expense_creation_private.owns_driver(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.owns_driver(uuid,uuid) to authenticated;

create function expense_creation_private.require_operational_access(_tenant uuid,_source_type text default null) returns void
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if expense_creation_private.owns_driver(_tenant) then
  -- A mixed driver/admin identity remains confined to its own trip. In
  -- particular, idempotent settlement retries must not bypass this boundary.
  if _source_type is not null and _source_type<>'trip' then
   raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 else perform finance_private.require_access(_tenant);end if;
end;$fn$;
revoke all on function expense_creation_private.require_operational_access(uuid,text) from public,anon,authenticated,service_role;

-- Change only the audited outer entry guard; retain the implementation, OID,
-- grants, signatures/defaults, release lock and authoritative source lookup.
do $entries$
declare s record;p record;body text;needle text;
begin
 for s in select * from(values
 ('expense_creation_private.create_driver_expense_command(jsonb)',
  '(_payload->>''tenant_id'')::uuid','_payload->>''source_type'''),
 ('expense_creation_private.get_expense_creation_context(uuid,text,uuid)','_tenant_id','_source_type'),
 ('expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb)','_tenant_id','_source_type'),
 ('expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','_tenant_id','_source_type'),
 ('expense_creation_private.list_driver_expenses(uuid,integer)','_tenant_id','null'),
 ('expense_creation_private.list_driver_expense_sources(uuid,integer)','_tenant_id','null')
 ) t(signature,tenant_expression,source_expression) loop
  select * into p from pg_proc where oid=to_regprocedure(s.signature);
  needle:='PERFORM finance_private.require_access('||s.tenant_expression||');';
  if position(needle in p.prosrc)=0 or length(p.prosrc)-length(replace(p.prosrc,needle,''))<>length(needle) then
   raise exception 'driver_own_expense_guard_shape_changed: %',s.signature using errcode='55000';end if;
  body:=replace(p.prosrc,needle,'PERFORM expense_creation_private.require_operational_access('||s.tenant_expression||','||s.source_expression||');');
  execute replace(pg_get_functiondef(p.oid),p.prosrc,body);
 end loop;
 select * into p from pg_proc where oid='expense_creation_private.require_session(uuid,uuid)'::regprocedure;
 needle:=' perform finance_private.require_access(_tenant);';
 if position(needle in p.prosrc)=0 then raise exception 'driver_own_expense_session_shape_changed';end if;
 body:=replace(p.prosrc,needle,E' if expense_creation_private.owns_driver(_tenant) then return;end if;\n'||needle);
 execute replace(pg_get_functiondef(p.oid),p.prosrc,body);
end;$entries$;

create or replace function expense_creation_private.session_allowed(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select expense_creation_private.owns_driver(_tenant) or
 (auth.uid() is not null and coalesce(finance_private.can_access(_tenant),false) and coalesce(finance_private.not_driver(_tenant),false)
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator')));
$fn$;

-- Split the two ALL restrictions: existing write restrictions keep the exact
-- predicates; SELECT adds a row-specific own-driver path, including mixed roles.
do $policies$
declare t text;s record;own text;
begin
 foreach t in array array['driver_expenses','driver_expense_creations'] loop
  own:='driver_id is not null and expense_creation_private.owns_driver(tenant_id,driver_id)';
  if t='driver_expense_creations' then own:=own||' and actor_id=(select auth.uid())';end if;
  for s in select * from(values
   ('finance_no_driver_boundary','finance_private.not_driver(tenant_id)','anon,authenticated'),
   ('finance_active_company_boundary','finance_private.can_access(tenant_id)','authenticated')
  ) v(name,predicate,roles) loop
   execute format('drop policy %I on public.%I',s.name,t);
   if s.roles='anon,authenticated' then
    execute format('create policy %I on public.%I as restrictive for all to anon using(%s) with check(%s)',s.name||'_anon',t,s.predicate,s.predicate);
   end if;
   execute format('create policy %I on public.%I as restrictive for select to authenticated using((%s) or (%s))',s.name,t,s.predicate,own);
   execute format('create policy %I on public.%I as restrictive for insert to %s with check(%s)',s.name||'_insert',t,s.roles,s.predicate);
   execute format('create policy %I on public.%I as restrictive for update to %s using(%s) with check(%s)',s.name||'_update',t,s.roles,s.predicate,s.predicate);
   execute format('create policy %I on public.%I as restrictive for delete to %s using(%s)',s.name||'_delete',t,s.roles,s.predicate);
  end loop;
 end loop;
end;$policies$;

-- An uploader's directory is not evidence that the expense belongs to them.
-- Driver preview reads registered expenses; upload/recovery uses the existing
-- receipt-status RPC, so an unbound upload needs no Storage-read exception.
create function expense_creation_private.owns_receipt(_path text) returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare t uuid;
begin
 if split_part(_path,'/',1)!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  or split_part(_path,'/',2)<>'expense-receipts' then return false;end if;
 t:=split_part(_path,'/',1)::uuid;
 return expense_creation_private.owns_driver(t) and exists(
  select 1 from public.driver_expenses e where e.tenant_id=t and e.receipt_url=_path
   and e.driver_id is not null and expense_creation_private.owns_driver(t,e.driver_id));
end;$fn$;
revoke all on function expense_creation_private.owns_receipt(text) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.owns_receipt(text) to authenticated;
-- Anonymous callers have no USAGE on the private schema and must never
-- evaluate its helper. Their restriction is retained as a separate policy.
alter policy finance_legacy_receipt_read on storage.objects to anon;
create policy driver_own_legacy_receipt_read on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name)
  or finance_private.can_read_receipt(name) or expense_creation_private.owns_receipt(name));

notify pgrst,'reload schema';

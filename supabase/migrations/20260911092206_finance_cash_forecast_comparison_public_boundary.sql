set lock_timeout='3s';set statement_timeout='30s';
do $review$
declare spec record;p record;
begin
 for spec in select * from (values
('finance_private.cash_forecast_comparison(jsonb,jsonb)','a24bce30f26f157ae1e213c2adc13dd2',false,'i',false),
('finance_private.compare_cash_forecast_snapshot(uuid,uuid)','29b38b3c43ccf4df6daf95ad34429ad0',true,'s',false),
('finance_private.period_money_package(uuid,date,date,uuid[])','f389fc63e5bd3e0a130524adc83a08d2',true,'s',true),
('finance_private.read_cash_forecast_snapshot(uuid,uuid)','01ce07b9e21b3a2d9c0207b335245823',true,'s',false),
('finance_private.validate_forecast_json(jsonb,jsonb)','d7d58dc822008959464fa7fe1ac87415',false,'i',false)
 )v(signature,body_md5,security_definer,volatility,authenticated_allowed) loop
 select * into p from pg_proc where oid=to_regprocedure(spec.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.body_md5 or p.prosecdef is distinct from spec.security_definer or p.provolatile::text is distinct from spec.volatility or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.authenticated_allowed
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner and (not spec.authenticated_allowed or a.grantee<>'authenticated'::regrole or a.is_grantable or a.privilege_type<>'EXECUTE'))
 then raise exception 'finance_forecast_comparison_dependency_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='finance_private.cash_forecast_snapshots'::regclass and tgname='preserve_cash_forecast_snapshot' and tgfoid='finance_private.preserve_event()'::regprocedure and tgtype=27 and tgenabled='O' and tgqual is null and tgnargs=0)
 or not exists(select 1 from pg_class where oid='finance_private.cash_forecast_snapshots'::regclass and relrowsecurity)
 or has_table_privilege('authenticated','finance_private.cash_forecast_snapshots','select,insert,update,delete') or has_table_privilege('anon','finance_private.cash_forecast_snapshots','select,insert,update,delete') or has_table_privilege('service_role','finance_private.cash_forecast_snapshots','select,insert,update,delete')
 then raise exception 'finance_forecast_snapshot_guard_missing' using errcode='55000';end if;
end$review$;
create function finance_private.public_cash_forecast_comparison(_tenant_id uuid,_snapshot_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform finance_private.require_access(_tenant_id);
 result:=finance_private.compare_cash_forecast_snapshot(_tenant_id,_snapshot_id);
 if result->>'tenant_id' is distinct from _tenant_id::text or result->>'actor_id' is distinct from auth.uid()::text or result->>'snapshot_id' is distinct from _snapshot_id::text then raise exception 'finance_forecast_comparison_identity_invalid' using errcode='55000';end if;
 return result;
end$$;
create function public.get_finance_cash_forecast_comparison(_tenant_id uuid,_snapshot_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.public_cash_forecast_comparison(_tenant_id,_snapshot_id)$$;
revoke all on function finance_private.public_cash_forecast_comparison(uuid,uuid),public.get_finance_cash_forecast_comparison(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.public_cash_forecast_comparison(uuid,uuid),public.get_finance_cash_forecast_comparison(uuid,uuid) to authenticated;

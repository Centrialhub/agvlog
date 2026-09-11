-- Exact adapter compatibility before legacy RPC boundary235237.
-- Convert only the one-call public alias to PL/pgSQL; no access expansion.
-- Install235237 and internal-only authorize in the SAME transaction.
do $adapter$
declare p record;
begin
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.apply_driver_settlement_adjustment(jsonb)');
 if not found then raise exception 'finance_adjustment_adapter_missing';end if;
 if p.lanname<>'sql' or p.prosecdef or p.provolatile<>'v'
 or md5(replace(p.prosrc,E'\r\n',E'\n'))<>'bc05f8437a55e6aea99d15d827fc9744'
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or not has_function_privilege('authenticated',p.oid,'execute')
 then raise exception 'finance_adjustment_adapter_contract_changed';end if;
end;$adapter$;
create or replace function public.apply_driver_settlement_adjustment(_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $fn$
begin
 return settlement_adjustment_private.apply(_payload);
end;$fn$;

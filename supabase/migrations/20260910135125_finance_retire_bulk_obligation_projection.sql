-- Stop bulk projections from interpreting application payments as bank matches.
-- Keep financial_obligations: reviewed company expenses still use one explicit
-- obligation per source ID as an operational review guard.
do $retire$
declare signature text;routine record;definition text;expense_body text;
begin
 if to_regprocedure('public.record_finance_settlement_payment(jsonb)') is null
   or to_regprocedure('public.record_finance_movement(jsonb)') is null then
  raise exception 'finance_recorded_money_replacement_missing';end if;
 select prosrc into expense_body from pg_proc where oid=to_regprocedure('public._tg_sync_obligations_from_expense()');
 if expense_body is null or expense_body ~* 'sync_financial_obligations\s*\('
   or position('expense_existing_obligation_requires_reconciliation' in expense_body)=0
   or position('review_command_id' in expense_body)=0 then
  raise exception 'finance_reviewed_expense_projection_required';end if;
 -- An unexpected dependent is a migration error, never silently broken.
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in('pg_catalog','information_schema') and p.prosrc ~* 'sync_financial_obligations\s*\('
    and not(n.nspname='public' and p.pronargs=0 and p.proname in('_tg_sync_obligations_from_settlement','_tg_sync_obligations_from_settlement_payment','_tg_sync_obligations_from_payable'))) then
  raise exception 'finance_bulk_projection_dependency_review';end if;
 foreach signature in array array[
   'public._tg_sync_obligations_from_settlement()',
   'public._tg_sync_obligations_from_settlement_payment()',
   'public._tg_sync_obligations_from_payable()'
 ] loop
  select p.oid,p.prosrc,p.prorettype,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if not found or routine.lanname<>'plpgsql' or routine.prorettype<>'trigger'::regtype then
   raise exception 'finance_bulk_projection_trigger_contract_changed: %',signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  execute replace(definition,routine.prosrc,E'BEGIN\n -- Retired bulk projection: canonical finance owns money; source rows remain intact.\n RETURN NEW;\nEND;');
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
 end loop;
 signature:='public.sync_financial_obligations(uuid,date,date)';
 select p.oid,p.prosrc,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
 if not found or routine.lanname<>'plpgsql' then raise exception 'finance_bulk_projection_contract_changed';end if;
 definition:=pg_get_functiondef(routine.oid);
 execute replace(definition,routine.prosrc,E'BEGIN\n RAISE EXCEPTION ''finance_bulk_obligation_projection_retired'' USING ERRCODE=''55000'', HINT=''Consulte os títulos e movimentos financeiros canônicos. As obrigações legadas não confirmam extrato.'';\nEND;');
 execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
end;
$retire$;

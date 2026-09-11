-- Preserve legacy rows and routine identities. All new reconciliation uses
-- original-backed bank entries and immutable groups with an auditable reversal.
-- sync_financial_obligations is intentionally retained for existing triggers.
do $$declare signature text;routine record;definition text;begin
 foreach signature in array array[
  'public.reconcile_finance_bank_group(jsonb)',
  'public.reverse_finance_bank_reconciliation(jsonb)',
  'public.get_finance_reconciliation_context(uuid,uuid[],uuid[])'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'finance_reconciliation_replacement_missing: %',signature;end if;
 end loop;
 foreach signature in array array[
  'public.run_bank_reconciliation(uuid,uuid,date,date)',
  'public.accept_financial_match(uuid)',
  'public.reject_financial_match(uuid,text)',
  'public.create_manual_financial_match(uuid,uuid,uuid,numeric,text)',
  'public.reverse_financial_match(uuid,text)',
  'public._apply_match_amounts(uuid,uuid,numeric)',
  'public.close_reconciliation_session(uuid)'
 ] loop
  select p.oid,p.prosrc,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if not found or routine.lanname<>'plpgsql' then raise exception 'finance_legacy_writer_contract_changed: %',signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  execute replace(definition,routine.prosrc,E'BEGIN\n RAISE EXCEPTION ''finance_legacy_reconciliation_retired'' USING ERRCODE=''55000'', HINT=''Use a conciliação auditada na área de Extratos. Os status históricos não confirmam o fechamento bancário.'';\nEND;');
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
 end loop;
end$$;

revoke insert,update,delete,truncate,references,trigger on public.financial_matches from public,anon,authenticated,service_role;
create policy finance_legacy_match_no_insert on public.financial_matches as restrictive for insert to authenticated with check(false);
create policy finance_legacy_match_no_update on public.financial_matches as restrictive for update to authenticated using(false) with check(false);
create policy finance_legacy_match_no_delete on public.financial_matches as restrictive for delete to authenticated using(false);
create trigger finance_legacy_match_history_immutable before update or delete on public.financial_matches for each row execute function finance_private.preserve_event();

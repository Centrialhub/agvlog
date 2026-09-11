-- Retain existing rows and function identities, but close destructive/duplicate
-- legacy paths after the replacement UI and atomic commands are installed.
revoke insert,update,delete,truncate,references,trigger on public.payables_payments from public,anon,authenticated,service_role;
create policy finance_payable_no_direct_insert on public.payables_payments as restrictive for insert to authenticated with check(false);
create policy finance_payable_no_direct_update on public.payables_payments as restrictive for update to authenticated using(false) with check(false);
create policy finance_payable_no_direct_delete on public.payables_payments as restrictive for delete to authenticated using(false);
create function finance_private.require_recorded_payable_link() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bank_transaction_id is not null or not exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=new.tenant_id and l.payment_id=new.id and l.payable_id=new.payable_id) then
  raise exception 'finance_payment_requires_recorded_movement' using errcode='23514';
 end if;
 return new;
end$$;
revoke all on function finance_private.require_recorded_payable_link() from public,anon,authenticated,service_role;
create constraint trigger finance_payment_requires_recorded_movement after insert on public.payables_payments deferrable initially deferred for each row execute function finance_private.require_recorded_payable_link();
create trigger finance_payable_payment_history_immutable before update or delete on public.payables_payments for each row execute function finance_private.preserve_event();
do $$declare signature text;routine record;definition text;begin
 foreach signature in array array['public.record_finance_manual_expense(jsonb)','public.apply_finance_payable_movement(jsonb)','public.reverse_finance_payable_link(jsonb)'] loop
  if to_regprocedure(signature) is null then raise exception 'finance_replacement_writer_missing: %',signature;end if;
 end loop;
 foreach signature in array array[
  'public.create_manual_expense(jsonb)',
  'public.register_payable_payment(uuid,numeric,timestamp with time zone,uuid,text,text,text)',
  'public.reverse_payable_payment(uuid)'
 ] loop
  select p.oid,p.prosrc,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if not found or routine.lanname<>'plpgsql' then raise exception 'finance_legacy_writer_contract_changed: %',signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  execute replace(definition,routine.prosrc,E'BEGIN\n RAISE EXCEPTION ''finance_legacy_writer_retired'' USING ERRCODE=''55000'', HINT=''Use os comandos financeiros com pedido recuperável e vínculo à movimentação registrada.'';\nEND;');
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
 end loop;
end$$;

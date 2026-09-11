-- Existing records remain; future payments require the canonical cash association.
do $$begin
 if to_regprocedure('public.record_finance_settlement_payment(jsonb)') is null
 or to_regprocedure('public.get_finance_settlement_payment_candidates(uuid,uuid,bigint,integer)') is null then
  raise exception 'finance_settlement_replacement_missing';end if;
end$$;
alter table public.driver_settlement_payments enable row level security;
revoke insert,update,delete,truncate,references,trigger on public.driver_settlement_payments from public,anon,authenticated,service_role;
create policy finance_settlement_no_direct_insert on public.driver_settlement_payments as restrictive for insert to authenticated with check(false);
create policy finance_settlement_no_direct_update on public.driver_settlement_payments as restrictive for update to authenticated using(false) with check(false);
create policy finance_settlement_no_direct_delete on public.driver_settlement_payments as restrictive for delete to authenticated using(false);
create function finance_private.require_recorded_settlement_payment_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.finance_settlement_movement_links l where l.tenant_id=new.tenant_id and l.payment_id=new.id
  and l.settlement_id=new.settlement_id and l.amount_cents=new.amount*100) then
  raise exception 'finance_settlement_payment_requires_recorded_movement' using errcode='23514';end if;
 return new;
end$$;
revoke all on function finance_private.require_recorded_settlement_payment_link() from public,anon,authenticated,service_role;
create constraint trigger finance_settlement_payment_requires_recorded_movement after insert on public.driver_settlement_payments deferrable initially deferred
 for each row execute function finance_private.require_recorded_settlement_payment_link();
create trigger finance_settlement_payment_history_immutable before update or delete on public.driver_settlement_payments for each row execute function finance_private.preserve_event();
do $$declare signature text;routine record;definition text;begin
 foreach signature in array array[
  'public.register_driver_settlement_payment(uuid,numeric,text,text,text,text,text,boolean,text)',
  'public.register_driver_settlement_payment_v2(uuid,numeric,text,text,text,text,text,boolean,text,uuid,text)'
 ] loop
  select p.oid,p.prosrc,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if not found or routine.lanname<>'plpgsql' then raise exception 'finance_legacy_settlement_writer_contract_changed: %',signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  execute replace(definition,routine.prosrc,E'BEGIN\n RAISE EXCEPTION ''finance_legacy_settlement_writer_retired'' USING ERRCODE=''55000'', HINT=''Registre o pagamento pelo comando financeiro recuperável vinculado à saída existente.'';\nEND;');
  execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
 end loop;
end$$;

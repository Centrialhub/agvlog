-- Local rehearsal artifact for the exact expense-creation candidate.
-- Preserve every expense, audit, receipt and uncertain request. No legacy API is restored.
-- Exclusive release lock rejects active transactions; stop UI submissions and drain
-- in-flight gateway uploads as well. A previously uploaded orphan is retained, not deleted.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';set local statement_timeout='20s';
do $release$
declare c record;p record;target oid;
begin
 if not pg_try_advisory_xact_lock(hashtext('driver-expense-release'),1) then
  raise exception 'expense_creation_release_active_requests' using errcode='55000';end if;
 if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.driver_expense_creations')),false)
  or has_table_privilege('authenticated','public.driver_expense_creations','insert,update,delete') then
  raise exception 'Expense release refused: audit table changed';end if;
 for c in select * from(values
  ('public._build_manual_driver_settlement(uuid)','8797dda84f56510ebf4b7b99b095c106',false,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public._check_expense_creation_ack()','dbb6bbc9b374c46ede5c3c4c08829789',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public._expense_creation_source(uuid,uuid,text,uuid)','13a493b368da71ef02021fdf1365a11e',false,'s','["search_path=\"\""]'::jsonb,false,false),
  ('public._expense_receipt_descriptor(uuid,uuid,uuid,jsonb)','3afdd20fb9ebce7863b72dd4c43a8fa7',false,'i','["search_path=\"\""]'::jsonb,false,false),
  ('public._expense_receipt_status(uuid,uuid,uuid,text,uuid,jsonb)','2c350513ca9546c08e8ce2795d5db99b',false,'s','["search_path=\"\""]'::jsonb,false,false),
  ('public._expense_review_snapshot(uuid,uuid)','3dae734b95ddb3f40d3953f5613a4bf6',false,'s','["search_path=\"\""]'::jsonb,false,false),
  ('public._guard_expense_creation_contract()','96186c8c4136fbf40f90b22bad07b9df',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public._guard_expense_creation_release()','291807b6b324778c388654e629f43f8d',false,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public._preserve_driver_expense_command()','0e1be5733a3feef5111263e9cae91882',false,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public._tg_mark_outdated_expense()','4fe2453ada9862a50d9512ea5a62bb6f',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public.create_driver_expense_command(jsonb)','4dab9fd4989cd43c467424ad95eba0ae',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public.get_expense_creation_context(uuid,text,uuid)','d6035e659b850c3ff558f437ef1c4e82',true,'v','["search_path=\"\""]'::jsonb,true,false),
  ('public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','d5d7d0bb8c3a9fd2c7b961fae5c33491',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public.recalculate_manual_expense_settlement(uuid,uuid)','b8fedb8e21d723b2825758696c0e8b0f',true,'v','["search_path=\"\""]'::jsonb,false,false),
  ('public.review_driver_expense(jsonb)','93de71d9c1c990d2ffc3218d43cf37c7',true,'v','["search_path=\"\""]'::jsonb,true,false)
) expected(signature,hash,definer,volatility,config,authenticated_grant,service_grant) loop
  target:=to_regprocedure(c.signature);select * into p from pg_proc where oid=target;
  if target is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from c.hash
   or p.prosecdef is distinct from c.definer or p.provolatile::text is distinct from c.volatility
   or to_jsonb(p.proconfig) is distinct from c.config
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated_grant
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_grant then
   raise exception 'Expense release refused: function or grants changed %',c.signature;end if;
  if not pg_has_role(current_user,p.proowner,'USAGE') then
   raise exception 'Expense release requires the function owner' using errcode='42501';end if;
 end loop;
 for c in select * from(values
  ('check_expense_creation_ack','public.driver_expenses','a5ba51aaac1fe75469729336df0f7115'),
  ('expense_creations_append_only','public.driver_expense_creations','874d33f18c78b282fa5f83f44e3f8365'),
  ('guard_expense_creation_contract','public.driver_expenses','9e08d67fa8340f8f775ae94d472bba78')
) expected(name,relation,hash) loop
  if (select count(*) from pg_trigger where tgname=c.name and tgrelid=to_regclass(c.relation) and tgenabled='O' and md5(pg_get_triggerdef(oid))=c.hash)<>1 then
   raise exception 'Expense release refused: integrity trigger changed %',c.name;end if;
 end loop;
 for c in select * from(values
  ('expense_creation_command_fkey','239b54dce80c3efcde0792e6360d3f44'),
  ('expense_manual_settlement_scope_fkey','aa22eb2c0c8383c6701386d6ae311abe'),
  ('expense_single_origin','d56fdd21e17b15704a5d63adc2acf289')
) expected(name,hash) loop
  if (select count(*) from pg_constraint where conrelid='public.driver_expenses'::regclass and conname=c.name and convalidated and md5(pg_get_constraintdef(oid))=c.hash)<>1 then
   raise exception 'Expense release refused: constraint changed %',c.name;end if;
 end loop;
 for c in select unnest(array['public.driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)',
  'public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)']) signature loop
  target:=to_regprocedure(c.signature);if target is null or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') or has_function_privilege('service_role',target,'execute') then
   raise exception 'Expense release refused: legacy API enabled %',c.signature;end if;
 end loop;
 execute 'grant execute on function public.create_driver_expense_command(jsonb) to authenticated';
 execute 'grant execute on function public.recalculate_manual_expense_settlement(uuid,uuid) to authenticated';
 execute 'grant execute on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) to service_role';
end;$release$;
commit;

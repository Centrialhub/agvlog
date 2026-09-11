-- The new intake preserves the original and verifies it separately. The old
-- endpoint must not remain a way to introduce bank evidence without an original.
-- Keep its identity for dependencies and retain all historical import rows.
do $$declare signature text;routine record;definition text;begin
 foreach signature in array array['public.intake_finance_statement(jsonb)','public.list_finance_statements(uuid,jsonb)'] loop
  if to_regprocedure(signature) is null then raise exception 'finance_statement_replacement_missing: %',signature;end if;
 end loop;
 signature:='public.import_bank_statement(uuid,uuid,text,text,date,date,jsonb,jsonb)';
 select p.oid,p.prosrc,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
 if not found or routine.lanname<>'plpgsql' then raise exception 'finance_legacy_writer_contract_changed: %',signature;end if;
 definition:=pg_get_functiondef(routine.oid);
 execute replace(definition,routine.prosrc,E'BEGIN\n RAISE EXCEPTION ''finance_legacy_statement_import_retired'' USING ERRCODE=''55000'', HINT=''Importe o arquivo original pela área de Extratos para preservar e conferir a evidência.'';\nEND;');
 execute format('revoke all on function %s from public,anon,authenticated,service_role',signature);
end$$;

alter table public.finance_statement_imports drop constraint finance_statement_imports_input_rows_check;
alter table public.finance_statement_imports add constraint finance_statement_imports_input_rows_check check(input_rows between 0 and 10000);
do $$declare body text;original text;signature text;begin
 foreach signature in array array['finance_private.intake_statement(jsonb)','finance_private.statement_original_ready(uuid,text,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into body;
  original:='(csv|xlsx|xls)';
  if position(original in body)=0 then raise exception 'finance_ofx_path_contract_changed: %',signature;end if;
  body:=replace(body,original,'(csv|xlsx|xls|ofx)');
  if signature='finance_private.intake_statement(jsonb)' then
   original:='''mapped-csv-v1'',''mapped-workbook-v1''';
   if position(original in body)=0 then raise exception 'finance_ofx_parser_contract_changed';end if;
   body:=replace(body,original,original||',''native-ofx-v1''');
   original:='jsonb_array_length(_payload->''rows'') not between 1 and 10000';
   if position(original in body)=0 then raise exception 'finance_ofx_empty_statement_contract_changed';end if;
   body:=replace(body,original,'jsonb_array_length(_payload->''rows'') not between (case when _payload->>''parser_version''=''native-ofx-v1'' then 0 else 1 end) and 10000');
   original:='jsonb_object_agg(q.classification,q.n) into counts';
   if position(original in body)=0 then raise exception 'finance_ofx_counts_contract_changed';end if;
   body:=replace(body,original,'coalesce(jsonb_object_agg(q.classification,q.n),''{}'') into counts');
  end if;
  execute body;
 end loop;
end;$$;

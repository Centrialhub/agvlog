alter function finance_private.legacy_cut_manifest(uuid,uuid,date,date) rename to legacy_cut_manifest_core;

do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.legacy_cut_manifest_core(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='classification text;table_name text;';
 if position(needle in body)=0 then raise exception 'finance_legacy_cut_declaration_changed';end if;
 body:=replace(body,needle,'classification text;table_name text;predicate text;');
 needle:=$old$  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where tenant_id=$1',table_name) into rows_json using _tenant;$old$;
 if position(needle in body)=0 then raise exception 'finance_legacy_cut_evidence_scan_changed';end if;
 body:=replace(body,needle,$new$  predicate:=case table_name
   when 'receivables_payments' then 'and ((x.bank_account_id=$2) or x.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=x.bank_account_id)) and (x.received_at is null or not isfinite(x.received_at) or (x.received_at at time zone ''America/Sao_Paulo'')::date between $3 and $4)'
   when 'receivable_payment_reversals' then 'and (x.effective_at is null or not isfinite(x.effective_at) or (x.effective_at at time zone ''America/Sao_Paulo'')::date between $3 and $4) and (not exists(select 1 from public.bank_transactions b where b.tenant_id=$1 and b.id=x.bank_transaction_id) or exists(select 1 from public.bank_transactions b where b.tenant_id=$1 and b.id=x.bank_transaction_id and (b.bank_account_id=$2 or b.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=b.bank_account_id))))'
   when 'payables_payments' then 'and (x.bank_account_id=$2 or x.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=x.bank_account_id)) and (x.paid_at is null or not isfinite(x.paid_at) or (x.paid_at at time zone ''America/Sao_Paulo'')::date between $3 and $4)'
   when 'driver_settlement_payments' then 'and (x.paid_at is null or not isfinite(x.paid_at) or (x.paid_at at time zone ''America/Sao_Paulo'')::date between $3 and $4)'
   when 'closing_report_payments' then 'and (x.bank_account_id=$2 or x.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=x.bank_account_id)) and (x.payment_date is null or not isfinite(x.payment_date) or x.payment_date between $3 and $4)'
   when 'load_payments' then 'and (x.bank_account_id=$2 or x.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=x.bank_account_id)) and (x.payment_date is null or not isfinite(x.payment_date) or x.payment_date between $3 and $4)'
   when 'employee_advances' then 'and x.status=''paid'' and (x.advance_date is null or not isfinite(x.advance_date) or x.advance_date between $3 and $4 or exists(select 1 from public.finance_payable_movement_links l join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id where l.tenant_id=$1 and l.payable_id=x.payable_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4))'
   when 'payroll_entry_items' then 'and x.nature=''already_paid'' and (coalesce((x.occurred_at at time zone ''America/Sao_Paulo'')::date,x.competence_date) is null or coalesce((x.occurred_at at time zone ''America/Sao_Paulo'')::date,x.competence_date) between $3 and $4 or exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.bank_account_id=$2 and m.occurred_on between $3 and $4 and m.id=case when x.source_metadata->>''movement_id'' ~ ''^[0-9a-f-]{36}$'' then (x.source_metadata->>''movement_id'')::uuid end))'
   when 'bank_transactions' then 'and (x.bank_account_id=$2 or x.bank_account_id is null or not exists(select 1 from public.bank_accounts a where a.tenant_id=$1 and a.id=x.bank_account_id)) and (x.posted_at is null or not isfinite(x.posted_at) or (x.posted_at at time zone ''America/Sao_Paulo'')::date between $3 and $4)'
   when 'finance_movements' then 'and x.bank_account_id=$2 and x.occurred_on between $3 and $4'
   when 'finance_movement_voids' then 'and exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_receivable_movement_links' then 'and (exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4) or exists(select 1 from public.receivables_payments p where p.tenant_id=$1 and p.id=x.payment_id and (p.bank_account_id=$2 or p.bank_account_id is null) and (p.received_at at time zone ''America/Sao_Paulo'')::date between $3 and $4))'
   when 'finance_payable_movement_links' then 'and (exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4) or exists(select 1 from public.payables_payments p where p.tenant_id=$1 and p.id=x.payment_id and (p.bank_account_id=$2 or p.bank_account_id is null) and (p.paid_at at time zone ''America/Sao_Paulo'')::date between $3 and $4))'
   when 'finance_payable_link_reversals' then 'and exists(select 1 from public.finance_payable_movement_links l join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id where l.tenant_id=$1 and l.id=x.link_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_settlement_movement_links' then 'and exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_settlement_link_reversals' then 'and exists(select 1 from public.finance_settlement_movement_links l join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id where l.tenant_id=$1 and l.id=x.link_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_legacy_receipt_movement_links' then 'and exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_legacy_receipt_link_reversals' then 'and exists(select 1 from public.finance_legacy_receipt_movement_links l join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id where l.tenant_id=$1 and l.id=x.link_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_receipt_allocation_corrections' then 'and exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   when 'finance_expense_allocations' then 'and exists(select 1 from public.finance_movements m where m.tenant_id=$1 and m.id=x.movement_id and m.bank_account_id=$2 and m.occurred_on between $3 and $4)'
   else 'and false' end;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x where tenant_id=$1 %s',table_name,predicate) into rows_json using _tenant,_account,_from,_to;$new$);
 needle:=$old$ select coalesce(jsonb_agg(to_jsonb(x) order by source_table,source_id),'[]') into integrity from finance_private.legacy_integrity_rows(_tenant) x;$old$;
 if position(needle in body)=0 then raise exception 'finance_legacy_cut_integrity_scan_changed';end if;
 body:=replace(body,needle,$new$ select coalesce(jsonb_agg(to_jsonb(x) order by source_table,source_id),'[]') into integrity from finance_private.legacy_integrity_rows(_tenant) x where exists(select 1 from jsonb_each(evidence) e cross join lateral jsonb_array_elements(e.value) raw where e.key=x.source_table and raw->>'id'=x.source_id::text);$new$);
 needle:=$old$    evidence:=evidence||jsonb_build_object('paid_projection_chain:'||table_name||':'||(item->>'id'),jsonb_build_array(projection));$old$;
 if position(needle in body)=0 then raise exception 'finance_legacy_cut_projection_snapshot_changed';end if;
 body:=replace(body,needle,'    null;');
 execute body;
end$$;

create function finance_private.legacy_cut_manifest_page(_tenant uuid,_account uuid,_from date,_to date,_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare full_manifest jsonb;evidence_summary jsonb;sources jsonb;blockers jsonb;integrity jsonb;begin
 if _page is null or _page not between 1 and 100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 full_manifest:=finance_private.legacy_cut_manifest_core(_tenant,_account,_from,_to);
 select coalesce(jsonb_object_agg(key,jsonb_build_object('count',jsonb_array_length(value),'revision',md5(value::text)) order by key),'{}') into evidence_summary from jsonb_each(full_manifest->'evidence');
 select coalesce(jsonb_agg(value order by ordinality),'[]') into sources from jsonb_array_elements(full_manifest->'sources') with ordinality where ordinality>(_page-1)*30 and ordinality<=_page*30;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into blockers from jsonb_array_elements(full_manifest->'blockers') with ordinality where ordinality>(_page-1)*30 and ordinality<=_page*30;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into integrity from jsonb_array_elements(full_manifest->'integrity') with ordinality where ordinality<=30;
 return (full_manifest-'sources'-'blockers'-'integrity'-'evidence')||jsonb_build_object('page',_page,'page_size',30,'sources',sources,'source_count',jsonb_array_length(full_manifest->'sources'),'sources_has_more',jsonb_array_length(full_manifest->'sources')>_page*30,'blockers',blockers,'blocker_count',jsonb_array_length(full_manifest->'blockers'),'blockers_has_more',jsonb_array_length(full_manifest->'blockers')>_page*30,'integrity',integrity,'integrity_count',jsonb_array_length(full_manifest->'integrity'),'evidence',evidence_summary,'movement_voids',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(full_manifest->'evidence'->'finance_movement_voids') with ordinality where ordinality<=30),'[]'));
end$$;
revoke all on function finance_private.legacy_cut_manifest_page(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_cut_manifest_page(uuid,uuid,date,date,integer) to authenticated;

create function finance_private.legacy_cut_manifest(_tenant uuid,_account uuid,_from date,_to date) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.legacy_cut_manifest_page(_tenant,_account,_from,_to,1)$$;
revoke all on function finance_private.legacy_cut_manifest(uuid,uuid,date,date) from public,anon,authenticated,service_role;

create function public.get_finance_legacy_cut_manifest_page(_tenant_id uuid,_account_id uuid,_from date,_to date,_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.legacy_cut_manifest_page(_tenant_id,_account_id,_from,_to,_page)$$;
revoke all on function public.get_finance_legacy_cut_manifest_page(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_legacy_cut_manifest_page(uuid,uuid,date,date,integer) to authenticated;

do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.legacy_cut_review_status(uuid,uuid,date,date)'::regprocedure) into body;
 needle:='jsonb_array_length(manifest->''blockers'')=0';if position(needle in body)=0 then raise exception 'finance_legacy_cut_status_blockers_changed';end if;
 execute replace(body,needle,'(manifest->>''blocker_count'')::integer=0');
 select pg_get_functiondef('public.review_finance_legacy_cut(jsonb)'::regprocedure) into body;
 needle:='manifest:=finance_private.legacy_cut_manifest(t,account,starts,ends);';if position(needle in body)=0 then raise exception 'finance_legacy_cut_review_manifest_changed';end if;
 body:=replace(body,needle,'manifest:=finance_private.legacy_cut_manifest_core(t,account,starts,ends);');
 needle:='values(t,account,starts,ends,manifest->>''revision'',manifest,actor';if position(needle in body)=0 then raise exception 'finance_legacy_cut_snapshot_changed';end if;
 execute replace(body,needle,'values(t,account,starts,ends,manifest->>''revision'',finance_private.legacy_cut_manifest_page(t,account,starts,ends,1),actor');
end$$;

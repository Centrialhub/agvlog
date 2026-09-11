-- Follow exact historical source IDs. Voids invalidate proof, never delete payment history.
create function finance_private.source_movement_void_evidence(_tenant uuid,_table text,_id uuid,_depth integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]';source jsonb;r record;begin
 if _depth>8 or _id is null then return '[]'::jsonb;end if;
 if _table in('payroll_entry_items','employee_advances','payables','load_payments','closing_report_payments','receivable_payment_reversals') then
  execute format('select to_jsonb(s) from public.%I s where tenant_id=$1 and id=$2',_table) into source using _tenant,_id;
  if _table='payroll_entry_items' then
   if source->>'source_table' in('employee_advances','driver_settlement_payments','payables_payments') then result:=finance_private.source_movement_void_evidence(_tenant,source->>'source_table',(source->>'source_id')::uuid,_depth+1);end if;
  elsif _table in('employee_advances','payables') then
   for r in select p.id from public.payables_payments p where p.tenant_id=_tenant and p.payable_id=case when _table='payables' then _id else (source->>'payable_id')::uuid end loop result:=result||finance_private.source_movement_void_evidence(_tenant,'payables_payments',r.id,_depth+1);end loop;
  elsif _table='receivable_payment_reversals' then result:=finance_private.source_movement_void_evidence(_tenant,'bank_transactions',(source->>'bank_transaction_id')::uuid,_depth+1);
  else result:=finance_private.source_movement_void_evidence(_tenant,'receivables_payments',coalesce((source->>'receivable_payment_id')::uuid,(source->>'canonical_receivable_payment_id')::uuid),_depth+1);end if;
 else
  select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') into result from public.finance_movement_voids v where v.tenant_id=_tenant and v.movement_id in(
   select l.movement_id from public.finance_payable_movement_links l join public.payables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id where l.tenant_id=_tenant and ((_table='payables_payments' and p.id=_id) or (_table='bank_transactions' and p.bank_transaction_id=_id))
   union select l.movement_id from public.finance_settlement_movement_links l where l.tenant_id=_tenant and _table='driver_settlement_payments' and l.payment_id=_id
   union select l.movement_id from public.finance_receivable_movement_links l where l.tenant_id=_tenant and ((_table='receivables_payments' and l.payment_id=_id) or (_table='bank_transactions' and l.bank_transaction_id=_id))
   union select l.movement_id from public.finance_legacy_receipt_movement_links l join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id where l.tenant_id=_tenant and ((_table='receivables_payments' and p.id=_id) or (_table='bank_transactions' and p.bank_transaction_id=_id))
  );
 end if;
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') into result from (select distinct value x from jsonb_array_elements(result)) q;return result;
end$$;
revoke all on function finance_private.source_movement_void_evidence(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
do $$declare definition text;patched text;needle text;begin
 definition:=pg_get_functiondef('finance_private.legacy_integrity_rows(uuid)'::regprocedure);
 needle:='  if cardinality(issues)>0 then return next;end if;';
 if position(needle in definition)=0 then raise exception 'void_integrity_contract_changed';end if;
 patched:=replace(definition,needle,$patch$  context:=context||jsonb_build_object('movement_voids',finance_private.source_movement_void_evidence(_tenant,source_table,source_id));
  if jsonb_array_length(context->'movement_voids')>0 then issues:=array_append(issues,'source_movement_voided');end if;
  if cardinality(issues)>0 then return next;end if;$patch$);execute patched;
 definition:=pg_get_functiondef('finance_private.paid_projection_chain(uuid,text,uuid)'::regprocedure);
 needle:=' return jsonb_build_object(''version'',1,''valid'',issue is null';
 if position(needle in definition)=0 then raise exception 'void_paid_projection_contract_changed';end if;
 patched:=replace(definition,needle,$patch$ snap:=snap||jsonb_build_object('movement_voids',finance_private.source_movement_void_evidence(_tenant,_table,_id));
 if jsonb_array_length(snap->'movement_voids')>0 then issue:=coalesce(issue,'paid_projection_movement_voided');end if;
 return jsonb_build_object('version',1,'valid',issue is null$patch$);execute patched;
 definition:=pg_get_functiondef('finance_private.legacy_cut_settlement_evidence(uuid,uuid)'::regprocedure);
 needle:=' return jsonb_build_object(''valid'',valid,''account_id''';
 if position(needle in definition)=0 then raise exception 'void_settlement_proof_contract_changed';end if;
 -- Preserve known money IDs even when proof fails; callers must check valid.
 patched:=replace(definition,'case when valid then m.bank_account_id end','m.bank_account_id');
 patched:=replace(patched,'case when valid then jsonb_build_array(m.id) else ''[]''::jsonb end','jsonb_build_array(m.id)');
 patched:=replace(patched,needle,$patch$ valid:=valid and not exists(select 1 from public.finance_movement_voids where tenant_id=_tenant and movement_id=m.id);
 return jsonb_build_object('movement_voids',finance_private.source_movement_void_evidence(_tenant,'driver_settlement_payments',_payment),
 'issue',case when exists(select 1 from public.finance_movement_voids where tenant_id=_tenant and movement_id=m.id) then 'settlement_movement_voided' when not valid then 'settlement_chain_unresolved' end,
 'revision',md5(jsonb_build_object('payment',to_jsonb(p),'settlement',to_jsonb(s),'link',to_jsonb(l),'movement',to_jsonb(m),'used',used,'voids',finance_private.source_movement_void_evidence(_tenant,'driver_settlement_payments',_payment))::text),
 'valid',valid,'account_id'$patch$);execute patched;
 definition:=pg_get_functiondef('finance_private.payable_portfolio_evidence(uuid,uuid)'::regprocedure);
 needle:=' select coalesce(array_agg(distinct x order by x),''{}'') into issues';
 if position(needle in definition)=0 then raise exception 'void_portfolio_issue_contract_changed';end if;
 patched:=replace(definition,needle,$patch$ if jsonb_array_length(finance_private.source_movement_void_evidence(_tenant,'payables',_id))>0 then issues:=array_append(issues,'payment_movement_voided');end if;
 select coalesce(array_agg(distinct x order by x),'{}') into issues$patch$);
 needle:=' return jsonb_build_object(''valid'',valid,''issues''';if position(needle in patched)=0 then raise exception 'void_portfolio_snapshot_contract_changed';end if;
 patched:=replace(patched,needle,$patch$ snap:=snap||jsonb_build_object('movement_voids',finance_private.source_movement_void_evidence(_tenant,'payables',_id));
 return jsonb_build_object('valid',valid,'issues'$patch$);execute patched;
 definition:=pg_get_functiondef('finance_private.legacy_cut_manifest(uuid,uuid,date,date)'::regprocedure);
 needle:='''bank_transactions'',''finance_movements'',''finance_receivable_movement_links''';if position(needle in definition)=0 then raise exception 'void_cut_evidence_contract_changed';end if;
 patched:=replace(definition,needle,'''bank_transactions'',''finance_movements'',''finance_movement_voids'',''finance_receivable_movement_links''');
 needle:='   if valid then';if position(needle in patched)=0 then raise exception 'void_cut_mapping_contract_changed';end if;
 patched:=replace(patched,needle,$patch$   if exists(select 1 from public.finance_movement_voids v where v.tenant_id=_tenant and exists(select 1 from jsonb_array_elements_text(movement_ids) x where x=v.movement_id::text)) then
    valid:=false;blockers:=blockers||jsonb_build_array(jsonb_build_object('code','legacy_source_movement_voided','source_table',table_name,'source_id',item->>'id'));
   end if;
   if valid then$patch$);
 patched:=replace(patched,'''classifier_version'',''3''','''classifier_version'',''4''');execute patched;
end$$;

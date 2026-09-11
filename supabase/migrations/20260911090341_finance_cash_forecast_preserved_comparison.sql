-- Compare preserved expectations to a newly read frozen-money package. No forecast recollection.
set lock_timeout='3s';set statement_timeout='30s';
create function finance_private.cash_forecast_comparison(_projection jsonb,_actual jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $compare$
declare p jsonb:=_projection;a jsonb:=_actual;scope jsonb;account jsonb;catalog jsonb;closure jsonb;tr jsonb;v jsonb;field text;scenario text;current_scenario jsonb;compared jsonb:='{}';difference jsonb;valid boolean;all_known boolean;ids jsonb;all_movements jsonb:='[]';seen_transfers text[]:=array[]::text[];
 opening numeric;incoming numeric;outgoing numeric;closing numeric;expected_in numeric;expected_out numeric;expected_closing numeric;sum_open numeric:=0;sum_in numeric:=0;sum_out numeric:=0;sum_close numeric:=0;pair_total numeric:=0;
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' then raise exception 'finance_forecast_comparison_invalid' using errcode='22023';end if;
 perform finance_private.validate_forecast_json(jsonb_build_object('tenant_id',p->'tenant_id','account_ids',p->'account_ids','captured_at',p->'captured_at','cutoff',p->'cutoff','period_end',p->'period_end'),'{"tenant_id":"uuid","account_ids":{"$array":"uuid"},"captured_at":"timestamp","cutoff":"day","period_end":"day"}');
 perform finance_private.validate_forecast_json(jsonb_build_object('version',a->'version','tenant_id',a->'tenant_id','currency',a->'currency','timezone',a->'timezone','basis',a->'basis','status_basis',a->'status_basis','period',a->'period','revision',a->'revision','monetary_totals_valid',a->'monetary_totals_valid','transfer_classification_valid',a->'transfer_classification_valid'),'{"version":{"$literal":1},"tenant_id":"uuid","currency":{"$literal":"BRL"},"timezone":{"$literal":"America/Sao_Paulo"},"basis":{"$literal":"frozen_money"},"status_basis":{"$literal":"current_closure_state"},"period":{"from":"day","to":"day"},"revision":"revision","monetary_totals_valid":"boolean","transfer_classification_valid":"boolean"}');
 if jsonb_typeof(a->'captured_at') is distinct from 'string' or jsonb_typeof(a->'accounts') is distinct from 'array' or jsonb_typeof(a->'transfers') is distinct from 'array' or jsonb_typeof(a->'account_scope') is distinct from 'object' then raise exception 'finance_forecast_comparison_invalid' using errcode='22023';end if;
 scope:=a->'account_scope';
 perform finance_private.validate_forecast_json(jsonb_build_object('selected_ids',scope->'selected_ids','excluded_ids',scope->'excluded_ids','complete',scope->'complete'),'{"selected_ids":{"$array":"uuid"},"excluded_ids":{"$array":"uuid"},"complete":"boolean"}');
 if jsonb_typeof(scope->'available') is distinct from 'array' or jsonb_array_length(p->'account_ids')<>(select count(distinct value) from jsonb_array_elements(p->'account_ids'))
 or p->>'tenant_id' is distinct from a->>'tenant_id' or (p->>'cutoff')::date+1 is distinct from (a#>>'{period,from}')::date or p->>'period_end' is distinct from a#>>'{period,to}'
 or (p->'account_ids') @> (scope->'selected_ids') is distinct from true or (scope->'selected_ids') @> (p->'account_ids') is distinct from true or jsonb_array_length(p->'account_ids')<>jsonb_array_length(scope->'selected_ids') then raise exception 'finance_forecast_comparison_scope_mismatch' using errcode='22023';end if;
 if a#>>'{period,from}'>a#>>'{period,to}' then raise exception 'finance_forecast_comparison_invalid' using errcode='22023';end if;
 ids:=(scope->'selected_ids')||(scope->'excluded_ids');
 if jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements(ids)) or jsonb_array_length(ids)<>jsonb_array_length(scope->'available')
 or exists(select 1 from jsonb_array_elements(scope->'available') x where not ids?(x->>'id'))
 or jsonb_array_length(scope->'available')<>(select count(distinct value->>'id') from jsonb_array_elements(scope->'available'))
 or (scope->>'complete')::boolean is distinct from (jsonb_array_length(scope->'selected_ids')>0 and jsonb_array_length(scope->'excluded_ids')=0)
 or jsonb_array_length(a->'accounts')<>jsonb_array_length(scope->'selected_ids') or jsonb_array_length(a->'accounts')<>(select count(distinct value->>'account_id') from jsonb_array_elements(a->'accounts')) then raise exception 'finance_forecast_actual_scope_invalid' using errcode='22023';end if;
 for account in select value from jsonb_array_elements(a->'accounts') loop
  select value into catalog from jsonb_array_elements(scope->'available') where value->>'id'=account->>'account_id';
  if not(scope->'selected_ids')?(account->>'account_id') or catalog is null or account->'name' is distinct from catalog->'name' or account->'account_kind' is distinct from catalog->'account_kind' or jsonb_typeof(account->'name') is distinct from 'string' or account->>'account_kind' not in('bank','cash','unsupported') or jsonb_typeof(account->'coverage_complete') is distinct from 'boolean' or jsonb_typeof(account->'closures') is distinct from 'array' then raise exception 'finance_forecast_actual_account_invalid' using errcode='22023';end if;
  perform finance_private.validate_forecast_json(account->'movement_ids','{"$array":"uuid"}');
  if jsonb_array_length(account->'movement_ids')<>(select count(distinct value) from jsonb_array_elements(account->'movement_ids')) then raise exception 'finance_forecast_actual_duplicate_movement' using errcode='22023';end if;
  all_movements:=all_movements||(account->'movement_ids');
  foreach field in array array['opening_cents','in_cents','out_cents','closing_cents'] loop
   v:=account->'balances'->field;
   if (account->>'coverage_complete')::boolean then perform finance_private.validate_forecast_json(v,to_jsonb(case when field in('in_cents','out_cents') then 'nonnegative'::text else 'integer_string'::text end));elsif v is distinct from 'null'::jsonb then raise exception 'finance_forecast_actual_unknown_balance' using errcode='22023';end if;
  end loop;
  if (account->>'coverage_complete')::boolean then
   if account->>'account_kind'='unsupported' or (account#>>'{balances,opening_cents}')::numeric+(account#>>'{balances,in_cents}')::numeric-(account#>>'{balances,out_cents}')::numeric<>(account#>>'{balances,closing_cents}')::numeric
   or not exists(select 1 from jsonb_array_elements(account->'closures') x where x->'active'='true'::jsonb and x#>'{integrity,snapshot_matches_revision}'='true'::jsonb and x#>'{integrity,dependencies_match}'='true'::jsonb) then raise exception 'finance_forecast_actual_coverage_invalid' using errcode='22023';end if;
   sum_open:=sum_open+(account#>>'{balances,opening_cents}')::numeric;sum_in:=sum_in+(account#>>'{balances,in_cents}')::numeric;sum_out:=sum_out+(account#>>'{balances,out_cents}')::numeric;sum_close:=sum_close+(account#>>'{balances,closing_cents}')::numeric;
  end if;
  if jsonb_array_length(account->'closures')<>(select count(distinct value->>'id') from jsonb_array_elements(account->'closures')) then raise exception 'finance_forecast_actual_closure_invalid' using errcode='22023';end if;
  for closure in select value from jsonb_array_elements(account->'closures') loop
   perform finance_private.validate_forecast_json(jsonb_build_object('id',closure->'id','from',closure->'from','to',closure->'to','active',closure->'active','integrity',closure->'integrity'),'{"id":"uuid","from":"day","to":"day","active":"boolean","integrity":{"snapshot_matches_revision":"boolean","dependencies_match":"boolean"}}');
   if closure->>'from'>closure->>'to' or (closure->'active'='true'::jsonb) is distinct from (closure->'reopening'='null'::jsonb) then raise exception 'finance_forecast_actual_closure_invalid' using errcode='22023';end if;
  end loop;
 end loop;
 valid:=(a->>'monetary_totals_valid')::boolean;
 foreach field in array array['opening_cents','in_cents','out_cents','closing_cents'] loop
  v:=a->'totals'->field;if valid then perform finance_private.validate_forecast_json(v,to_jsonb(case when field in('in_cents','out_cents') then 'nonnegative'::text else 'integer_string'::text end));elsif v is distinct from 'null'::jsonb then raise exception 'finance_forecast_actual_unknown_totals' using errcode='22023';end if;
 end loop;
 if valid and (jsonb_array_length(scope->'selected_ids')=0 or exists(select 1 from jsonb_array_elements(a->'accounts') x where x->'coverage_complete' is distinct from 'true'::jsonb) or sum_open<>(a#>>'{totals,opening_cents}')::numeric or sum_in<>(a#>>'{totals,in_cents}')::numeric or sum_out<>(a#>>'{totals,out_cents}')::numeric or sum_close<>(a#>>'{totals,closing_cents}')::numeric or jsonb_array_length(all_movements)<>(select count(distinct value) from jsonb_array_elements(all_movements))) then raise exception 'finance_forecast_actual_totals_invalid' using errcode='22023';end if;
 for tr in select value from jsonb_array_elements(a->'transfers') loop
  if (tr->>'kind')||':'||(tr->>'id')=any(seen_transfers) then raise exception 'finance_forecast_actual_transfer_invalid' using errcode='22023';end if;seen_transfers:=array_append(seen_transfers,(tr->>'kind')||':'||(tr->>'id'));
  if tr->>'classification'='internal_pair' then
   if tr->>'kind' is distinct from 'pair' or tr->'incoming_id'='null'::jsonb or not(scope->'selected_ids')?(tr->>'source_account_id') or not(scope->'selected_ids')?(tr->>'destination_account_id') or not all_movements?(tr->>'outgoing_id') or not all_movements?(tr->>'incoming_id') or coalesce(tr->>'outgoing_on','') not between a#>>'{period,from}' and a#>>'{period,to}' or coalesce(tr->>'incoming_on','') not between a#>>'{period,from}' and a#>>'{period,to}' then raise exception 'finance_forecast_actual_transfer_invalid' using errcode='22023';end if;
   perform finance_private.validate_forecast_json(tr->'amount_cents','"nonnegative"');pair_total:=pair_total+(tr->>'amount_cents')::numeric;
  end if;
 end loop;
 foreach field in array array['internal_pair_cents','in_excluding_internal_pairs_cents','out_excluding_internal_pairs_cents'] loop
  v:=a->'transfer_totals'->field;if a->'transfer_classification_valid'='true'::jsonb then perform finance_private.validate_forecast_json(v,'"nonnegative"');elsif v is distinct from 'null'::jsonb then raise exception 'finance_forecast_actual_transfer_invalid' using errcode='22023';end if;
 end loop;
 if a->'transfer_classification_valid'='true'::jsonb and (not valid or pair_total<>(a#>>'{transfer_totals,internal_pair_cents}')::numeric or pair_total>sum_in or pair_total>sum_out or sum_in-pair_total<>(a#>>'{transfer_totals,in_excluding_internal_pairs_cents}')::numeric or sum_out-pair_total<>(a#>>'{transfer_totals,out_excluding_internal_pairs_cents}')::numeric or exists(select 1 from jsonb_array_elements(a->'transfers') x where x->>'classification'='needs_review' or x->'issues'<>'[]'::jsonb)) then raise exception 'finance_forecast_actual_transfer_invalid' using errcode='22023';end if;
 perform finance_private.validate_forecast_json(p#>'{base,amount_cents}','{"$nullable":"integer_string"}');
 foreach scenario in array array['confirmed','expanded'] loop
  current_scenario:=p->scenario;perform finance_private.validate_forecast_json(current_scenario,'{"complete":"boolean","closing_cents":{"$nullable":"integer_string"}}');
  if not valid or current_scenario->'complete'='false'::jsonb or current_scenario->'closing_cents'='null'::jsonb or p#>'{base,amount_cents}'='null'::jsonb then
   compared:=compared||jsonb_build_object(scenario,jsonb_build_object('available',false,'matches',false,'expected',null,'actual',null,'differences',null));continue;
  end if;
  perform finance_private.validate_forecast_json(p->'recorded_totals','{"in_cents":"nonnegative","out_cents":"nonnegative"}');perform finance_private.validate_forecast_json(p->'scheduled','{"confirmed_in_cents":"nonnegative","confirmed_out_cents":"nonnegative","unbilled_in_cents":"nonnegative"}');
  expected_in:=(p#>>'{recorded_totals,in_cents}')::numeric+(p#>>'{scheduled,confirmed_in_cents}')::numeric+case when scenario='expanded' then (p#>>'{scheduled,unbilled_in_cents}')::numeric else 0 end;
  expected_out:=(p#>>'{recorded_totals,out_cents}')::numeric+(p#>>'{scheduled,confirmed_out_cents}')::numeric;expected_closing:=(current_scenario->>'closing_cents')::numeric;
  if (p#>>'{base,amount_cents}')::numeric+expected_in-expected_out<>expected_closing then raise exception 'finance_forecast_preserved_equation_invalid' using errcode='22023';end if;
  opening:=(a#>>'{totals,opening_cents}')::numeric-(p#>>'{base,amount_cents}')::numeric;incoming:=(a#>>'{totals,in_cents}')::numeric-expected_in;outgoing:=(a#>>'{totals,out_cents}')::numeric-expected_out;closing:=(a#>>'{totals,closing_cents}')::numeric-expected_closing;
  if opening+incoming-outgoing<>closing then raise exception 'finance_forecast_variance_equation_invalid' using errcode='22023';end if;
  difference:=jsonb_build_object('opening_cents',opening::text,'in_cents',incoming::text,'out_cents',outgoing::text,'closing_cents',closing::text);
  compared:=compared||jsonb_build_object(scenario,jsonb_build_object('available',true,'matches',opening=0 and incoming=0 and outgoing=0 and closing=0,'expected',jsonb_build_object('opening_cents',p#>'{base,amount_cents}','in_cents',expected_in::text,'out_cents',expected_out::text,'closing_cents',expected_closing::text),'actual',a->'totals','differences',difference));
 end loop;
 return jsonb_build_object('tenant_id',p->'tenant_id','account_ids',p->'account_ids','period',a->'period','original_captured_at',p->'captured_at','realized_revision',a->'revision','realized_captured_at',a->'captured_at','base_confirmation',p#>'{base,confirmation}','whole_company_scope',scope->'complete','flow_basis','gross_cash','confirmed',compared->'confirmed','expanded',compared->'expanded','cause_attribution','not_determined');
end$compare$;
revoke all on function finance_private.cash_forecast_comparison(jsonb,jsonb) from public,anon,authenticated,service_role;

create function finance_private.compare_cash_forecast_snapshot(_tenant uuid,_snapshot uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $snapshot$
declare saved jsonb;c jsonb;p jsonb;actual jsonb;comparison jsonb;unavailable text;accounts uuid[];
begin
 perform finance_private.require_access(_tenant);saved:=finance_private.read_cash_forecast_snapshot(_tenant,_snapshot);c:=saved->'collection';p:=saved->'projection';
 if p is null or p='null'::jsonb then unavailable:='forecast_projection_unavailable';
 elsif jsonb_typeof(c#>'{account_scope,account_ids}') is distinct from 'array' then raise exception 'finance_forecast_snapshot_scope_invalid' using errcode='55000';
 elsif jsonb_array_length(c#>'{account_scope,account_ids}')=0 then unavailable:='forecast_accounts_missing';
 else
  select array_agg(value::uuid order by ordinality) into accounts from jsonb_array_elements_text(c#>'{account_scope,account_ids}') with ordinality;
  actual:=finance_private.period_money_package(_tenant,(c->>'cutoff')::date+1,(c->>'period_end')::date,accounts);
  comparison:=finance_private.cash_forecast_comparison(p,actual);
 end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'snapshot_id',_snapshot,'source_revision',saved->'source_revision','content_hash',saved->'content_hash','comparison',comparison,'unavailable_reason',unavailable);
end$snapshot$;
revoke all on function finance_private.compare_cash_forecast_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

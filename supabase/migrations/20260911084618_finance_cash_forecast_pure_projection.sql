set local lock_timeout='3s';
set local statement_timeout='30s';
-- Pure, private JSON validation/calculation. No table access and no authorization claim.
-- The eventual snapshot command must obtain its own authorized server collection.
create function finance_private.validate_forecast_json(v jsonb,spec jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare kind text;k text;x jsonb;stamp timestamptz;d date;begin
 if spec ? '$nullable' then if v='null'::jsonb then return;end if;perform finance_private.validate_forecast_json(v,spec->'$nullable');return;end if;
 if spec ? '$literal' then if v is distinct from spec->'$literal' then raise exception 'finance_forecast_invalid_dto:literal' using errcode='22023';end if;return;end if;
 if spec ? '$enum' then if not exists(select 1 from jsonb_array_elements(spec->'$enum') as enum_value(value) where enum_value.value=v) then raise exception 'finance_forecast_invalid_dto:enum' using errcode='22023';end if;return;end if;
 if spec ? '$array' then if jsonb_typeof(v) is distinct from 'array' then raise exception 'finance_forecast_invalid_dto:array' using errcode='22023';end if;for x in select value from jsonb_array_elements(v) loop perform finance_private.validate_forecast_json(x,spec->'$array');end loop;return;end if;
 if jsonb_typeof(spec)='object' then
  if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(spec) as spec_key(name) where not v?spec_key.name) or exists(select 1 from jsonb_object_keys(v) as value_key(name) where not spec?value_key.name) then raise exception 'finance_forecast_invalid_dto:object' using errcode='22023';end if;
  for k in select jsonb_object_keys(spec) loop perform finance_private.validate_forecast_json(v->k,spec->k);end loop;return;
 end if;
 kind:=spec#>>'{}';
 if kind='boolean' then if jsonb_typeof(v) is distinct from 'boolean' then raise exception 'finance_forecast_invalid_dto:boolean' using errcode='22023';end if;return;end if;
 if kind='count' then if jsonb_typeof(v) is distinct from 'number' or v::text!~'^[0-9]+$' then raise exception 'finance_forecast_invalid_dto:count' using errcode='22023';end if;return;end if;
 if jsonb_typeof(v) is distinct from 'string' then raise exception 'finance_forecast_invalid_dto:string' using errcode='22023';end if;k:=v#>>'{}';
 if kind='uuid' then if k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'finance_forecast_invalid_dto:uuid' using errcode='22023';end if;
 elsif kind='revision' then if k!~'^[a-f0-9]{32}$' then raise exception 'finance_forecast_invalid_dto:revision' using errcode='22023';end if;
 elsif kind='nonnegative' then if k!~'^[0-9]+$' then raise exception 'finance_forecast_invalid_dto:cents' using errcode='22023';end if;
 elsif kind='integer_string' then if k!~'^-?[0-9]+$' then raise exception 'finance_forecast_invalid_dto:cents' using errcode='22023';end if;
 elsif kind='nonempty' then if length(k)=0 then raise exception 'finance_forecast_invalid_dto:empty' using errcode='22023';end if;
 elsif kind='day' then
  if k!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'finance_forecast_invalid_dto:date' using errcode='22023';end if;d:=k::date;if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>k then raise exception 'finance_forecast_invalid_dto:date' using errcode='22023';end if;
 elsif kind='timestamp' then
  if k!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-5][0-9])$' then raise exception 'finance_forecast_invalid_dto:timestamp' using errcode='22023';end if;stamp:=k::timestamptz;if not isfinite(stamp) then raise exception 'finance_forecast_invalid_dto:timestamp' using errcode='22023';end if;
 else raise exception 'finance_forecast_invalid_validator' using errcode='22023';end if;
end$$;
revoke all on function finance_private.validate_forecast_json(jsonb,jsonb) from public,anon,authenticated,service_role;

create function finance_private.project_collected_cash_forecast(_collection jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb:=_collection;parts jsonb;row jsonb;issues jsonb;rows jsonb:='[]';projection jsonb;keys text[];item text;f text;confirmation text;captured_day date;
 base_amount numeric;sum_base numeric:=0;sum_credit numeric:=0;remaining numeric;incoming numeric:=0;outgoing numeric:=0;unbilled numeric:=0;recorded_in numeric:=0;recorded_out numeric:=0;unscheduled_confirmed numeric:=0;unscheduled_unbilled numeric:=0;timing text;unknown_base boolean:=false;unknown_credit boolean:=false;provisional boolean:=false;confirmations text[]:='{}';confirmed_complete boolean;expanded_complete boolean;begin
 perform finance_private.validate_forecast_json(v, '{"version":{"$literal":1},"tenant_id":"uuid","actor_id":"uuid","captured_at":"timestamp","revision":"revision","basis":{"$enum":["current_company_cash_forecast"]},"cutoff":"day","period_end":"day","account_scope":{"mode":{"$enum":["whole_company"]},"account_ids":{"$array":"uuid"}},"base":{"as_of":"day","amount_cents":{"$nullable":"integer_string"},"confirmation":{"$enum":["bank_confirmed","cash_count","mixed_confirmed","provisional","unverified"]},"components":{"$array":{"account_id":"uuid","account_kind":{"$enum":["bank","cash","unsupported"]},"source_table":{"$nullable":{"$enum":["finance_account_period_closures","finance_account_openings"]}},"source_id":{"$nullable":"uuid"},"source_revision":"revision","amount_cents":{"$nullable":"integer_string"},"confirmation":{"$enum":["bank_confirmed","cash_count","provisional","unverified"]}}}},"origins":{"$array":{"economic_key":"nonempty","source_table":{"$enum":["receivables","payables","fiscal_documents","delivery_attempts"]},"source_id":"uuid","source_revision":"revision","direction":{"$enum":["in","out"]},"scenario":{"$enum":["confirmed","unbilled"]},"nominal_cents":{"$nullable":"nonnegative"},"fulfilled_cents":{"$nullable":"nonnegative"},"reserved_credit_cents":{"$nullable":"nonnegative"},"expected_on":{"$nullable":"day"},"expected_date_source":{"$enum":["due_date","unknown"]},"valid":"boolean"}},"recorded_after_cutoff":{"$array":{"movement_id":"uuid","account_id":"uuid","source_revision":"revision","occurred_on":"day","direction":{"$enum":["in","out"]},"amount_cents":"nonnegative","confirmation":{"$enum":["recorded"]}}},"unassigned_credit_cents":{"$nullable":"nonnegative"},"credits":{"$array":{"credit_id":"uuid","payer_id":"uuid","source_payment_id":"uuid","source_revision":"revision","amount_cents":{"$nullable":"nonnegative"},"valid":"boolean"}},"source_issues":{"$array":{"scope":{"$enum":["confirmed","expanded","all"]},"code":"nonempty","source_ids":{"$array":"uuid"}}},"counts":{"accounts":"count","origins":"count","movements":"count","credits":"count"}}'::jsonb);
 parts:=v#>'{base,components}';issues:=v->'source_issues';
 if v#>>'{base,as_of}'<>v->>'cutoff' or jsonb_array_length(parts)<>jsonb_array_length(v#>'{account_scope,account_ids}')
 or (v#>>'{counts,accounts}')::numeric<>jsonb_array_length(v#>'{account_scope,account_ids}') or (v#>>'{counts,origins}')::numeric<>jsonb_array_length(v->'origins') or (v#>>'{counts,movements}')::numeric<>jsonb_array_length(v->'recorded_after_cutoff') or (v#>>'{counts,credits}')::numeric<>jsonb_array_length(v->'credits') then raise exception 'finance_forecast_inconsistent_counts_or_scope' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(v#>'{account_scope,account_ids}') x group by x having count(*)>1) then raise exception 'finance_forecast_duplicate_account' using errcode='22023';end if;
 keys:='{}';for row in select value from jsonb_array_elements(parts) loop
  item:=row->>'account_id';if item=any(keys) or not (v#>'{account_scope,account_ids}')?item then raise exception 'finance_forecast_component_scope' using errcode='22023';end if;keys:=array_append(keys,item);
  if (row->>'confirmation'='unverified') is distinct from (row->'amount_cents'='null'::jsonb) then raise exception 'finance_forecast_component_proof' using errcode='22023';end if;
  if row->>'confirmation'<>'unverified' and (row->'source_id'='null'::jsonb or row->'source_table'='null'::jsonb or row->>'account_kind'='unsupported') then raise exception 'finance_forecast_component_proof' using errcode='22023';end if;
  if row->'amount_cents'='null'::jsonb then unknown_base:=true;else sum_base:=sum_base+(row->>'amount_cents')::numeric;end if;
 end loop;
 unknown_base:=unknown_base or jsonb_array_length(parts)=0;
 if unknown_base then if v#>'{base,amount_cents}'<>'null'::jsonb or v#>>'{base,confirmation}'<>'unverified' then raise exception 'finance_forecast_base_unverified' using errcode='22023';end if;
 elsif v#>'{base,amount_cents}'='null'::jsonb or sum_base<>(v#>>'{base,amount_cents}')::numeric then raise exception 'finance_forecast_base_sum' using errcode='22023';end if;
 keys:='{}';for row in select value from jsonb_array_elements(v->'credits') loop
  item:=row->>'credit_id';if item=any(keys) then raise exception 'finance_forecast_duplicate_credit' using errcode='22023';end if;keys:=array_append(keys,item);
  if (row->>'valid'='true')=(row->'amount_cents'='null'::jsonb) then raise exception 'finance_forecast_credit_validity' using errcode='22023';end if;
  if row->>'valid'='false' then unknown_credit:=true;else sum_credit:=sum_credit+(row->>'amount_cents')::numeric;end if;
 end loop;
 if unknown_credit then if v->'unassigned_credit_cents'<>'null'::jsonb then raise exception 'finance_forecast_credit_unknown' using errcode='22023';end if;
 elsif v->'unassigned_credit_cents'='null'::jsonb or (v->>'unassigned_credit_cents')::numeric<>sum_credit then raise exception 'finance_forecast_credit_sum' using errcode='22023';end if;
 keys:='{}';for row in select value from jsonb_array_elements(v->'origins') loop
  item:=row->>'economic_key';if item=any(keys) then raise exception 'finance_forecast_duplicate_origin' using errcode='22023';end if;keys:=array_append(keys,item);
  if (row->'expected_on'='null'::jsonb) is distinct from (row->>'expected_date_source'='unknown') then raise exception 'finance_forecast_expected_date_evidence' using errcode='22023';end if;
  if row->>'valid'='true' then
   if row->'nominal_cents'='null'::jsonb or row->'fulfilled_cents'='null'::jsonb or row->'reserved_credit_cents'='null'::jsonb or (row->>'fulfilled_cents')::numeric+(row->>'reserved_credit_cents')::numeric>(row->>'nominal_cents')::numeric then raise exception 'finance_forecast_origin_amount' using errcode='22023';end if;
  else
   if row->'nominal_cents'<>'null'::jsonb or row->'fulfilled_cents'<>'null'::jsonb or row->'reserved_credit_cents'<>'null'::jsonb then raise exception 'finance_forecast_origin_unverified_values' using errcode='22023';end if;
   issues:=issues||jsonb_build_array(jsonb_build_object('scope',case when row->>'scenario'='unbilled' then 'expanded' else 'confirmed' end,'code','forecast_origin_unverified','source_ids',jsonb_build_array(row->'source_id')));
  end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v->'recorded_after_cutoff') x group by x->>'movement_id' having count(*)>1) then raise exception 'finance_forecast_duplicate_movement' using errcode='22023';end if;
 if jsonb_array_length(v#>'{account_scope,account_ids}')=0 then return jsonb_build_object('collection',v,'projection',null,'issues',issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_accounts_unavailable','source_ids','[]'::jsonb)));end if;
 -- Company basis validation mirrors the second TS validation stage.
 captured_day:=((v->>'captured_at')::timestamptz at time zone 'America/Sao_Paulo')::date;
 if (v->>'cutoff')::date >= (v->>'period_end')::date or (v->>'cutoff')::date>=captured_day or (v->>'period_end')::date<captured_day then raise exception 'finance_forecast_invalid_horizon' using errcode='22023';end if;
 for row in select value from jsonb_array_elements(parts) loop
  if row->'amount_cents'<>'null'::jsonb and row->>'amount_cents'!~'^-?(0|[1-9][0-9]{0,17})$' then raise exception 'finance_forecast_base_amount_range' using errcode='22023';end if;
  if row->>'confirmation'='bank_confirmed' and row->>'account_kind'<>'bank' or row->>'confirmation'='cash_count' and row->>'account_kind'<>'cash' then raise exception 'finance_forecast_confirmation_kind' using errcode='22023';end if;
  confirmations:=array_append(confirmations,row->>'confirmation');provisional:=provisional or row->>'confirmation'='provisional';
 end loop;
 confirmation:=case when unknown_base then 'unverified' when provisional then 'provisional' when (select count(distinct x) from unnest(confirmations)x)>1 then 'mixed_confirmed' else confirmations[1] end;
 if confirmation<>v#>>'{base,confirmation}' or (not unknown_base and sum_base::text<>v#>>'{base,amount_cents}') or (v#>'{base,amount_cents}'<>'null'::jsonb and v#>>'{base,amount_cents}'!~'^-?(0|[1-9][0-9]{0,17})$') then raise exception 'finance_forecast_base_confirmation' using errcode='22023';end if;
 keys:='{}';for row in select value from jsonb_array_elements(v->'origins') where value->>'valid'='true' loop
  item:=(row->>'source_table')||':'||(row->>'source_id');if item=any(keys) then raise exception 'finance_forecast_duplicate_source' using errcode='22023';end if;keys:=array_append(keys,item);
  if length(row->>'economic_key')>250 or (row->>'scenario'='unbilled' and row->>'direction'<>'in') then raise exception 'finance_forecast_origin_scope' using errcode='22023';end if;
  foreach f in array array['nominal_cents','fulfilled_cents','reserved_credit_cents'] loop if row->>f!~'^(0|[1-9][0-9]{0,13})$' then raise exception 'finance_forecast_origin_range' using errcode='22023';end if;end loop;
  remaining:=(row->>'nominal_cents')::numeric-(row->>'fulfilled_cents')::numeric-(row->>'reserved_credit_cents')::numeric;
  timing:=case when remaining=0 then 'already_covered' when row->'expected_on'='null'::jsonb or (row->>'expected_on')::date<captured_day then 'needs_new_date' when (row->>'expected_on')::date>(v->>'period_end')::date then 'after_period' else 'in_period' end;
  if timing='in_period' then if row->>'scenario'='unbilled' then unbilled:=unbilled+remaining;elsif row->>'direction'='in' then incoming:=incoming+remaining;else outgoing:=outgoing+remaining;end if;end if;
  if timing='needs_new_date' then if row->>'scenario'='unbilled' then unscheduled_unbilled:=unscheduled_unbilled+remaining;else unscheduled_confirmed:=unscheduled_confirmed+remaining;end if;end if;
  rows:=rows||jsonb_build_array((row-'valid')||jsonb_build_object('remaining_cents',remaining::text,'timing',timing));
 end loop;
 for row in select value from jsonb_array_elements(v->'recorded_after_cutoff') loop
  if not (v#>'{account_scope,account_ids}')?(row->>'account_id') or (row->>'occurred_on')::date<=(v->>'cutoff')::date or (row->>'occurred_on')::date>captured_day or row->>'amount_cents'!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_forecast_movement_scope' using errcode='22023';end if;
  if row->>'direction'='in' then recorded_in:=recorded_in+(row->>'amount_cents')::numeric;else recorded_out:=recorded_out+(row->>'amount_cents')::numeric;end if;
 end loop;
 if v->'unassigned_credit_cents'='null'::jsonb then issues:=issues||jsonb_build_array(jsonb_build_object('code','customer_credit_balance_unverified','source_ids','[]'::jsonb));
 else if v->>'unassigned_credit_cents'!~'^(0|[1-9][0-9]{0,13})$' then raise exception 'finance_forecast_credit_range' using errcode='22023';end if;if (v->>'unassigned_credit_cents')::numeric>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','unassigned_customer_credit','source_ids','[]'::jsonb));end if;end if;
 if unknown_base then issues:=issues||jsonb_build_array(jsonb_build_object('code','base_balance_unverified','source_ids',(select coalesce(jsonb_agg(x->'source_id'),'[]') from jsonb_array_elements(parts)x where x->'source_id'<>'null'::jsonb)));end if;
 confirmed_complete:=not exists(select 1 from jsonb_array_elements(issues)x where x->>'scope' is distinct from 'expanded') and unscheduled_confirmed=0;
 expanded_complete:=confirmed_complete and jsonb_array_length(issues)=0 and unscheduled_unbilled=0;base_amount:=(v#>>'{base,amount_cents}')::numeric;
 projection:=jsonb_build_object('version',2,'tenant_id',v->'tenant_id','account_ids',v#>'{account_scope,account_ids}','captured_at',v->'captured_at','cutoff',v->'cutoff','period_end',v->'period_end','base',v->'base','recorded_after_cutoff',v->'recorded_after_cutoff','recorded_totals',jsonb_build_object('in_cents',recorded_in::text,'out_cents',recorded_out::text),'rows',rows,'issues',issues,'unassigned_credit_cents',v->'unassigned_credit_cents','scheduled',jsonb_build_object('confirmed_in_cents',incoming::text,'confirmed_out_cents',outgoing::text,'unbilled_in_cents',unbilled::text),'unscheduled',jsonb_build_object('confirmed_cents',unscheduled_confirmed::text,'unbilled_cents',unscheduled_unbilled::text),'confirmed',jsonb_build_object('complete',confirmed_complete,'closing_cents',case when confirmed_complete and base_amount is not null then (base_amount+recorded_in-recorded_out+incoming-outgoing)::text end),'expanded',jsonb_build_object('complete',expanded_complete,'closing_cents',case when expanded_complete and base_amount is not null then (base_amount+recorded_in-recorded_out+incoming+unbilled-outgoing)::text end));
 return jsonb_build_object('collection',v,'projection',projection,'issues',issues);
end$$;
revoke all on function finance_private.project_collected_cash_forecast(jsonb) from public,anon,authenticated,service_role;

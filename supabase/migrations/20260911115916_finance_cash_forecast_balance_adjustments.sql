-- Local candidate. Must be tested with final balance-adjustment core before promotion.
set lock_timeout='3s';set statement_timeout='30s';
do $core_fingerprints$declare s record;p record;begin
 for s in select * from(values
('finance_private.receivable_adjustment_evidence(uuid,uuid)','4eafcf6d0a88a1c343115df0bf086f8c',false,'s',false),
('public._receivable_financial_snapshot(uuid,uuid)','904d7c409cb01ce8b720f257baea21af',false,'s',false)
 )v(signature,hash,is_definer,volatility,auth_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text is distinct from s.volatility or p.proconfig is distinct from array['search_path=""']::text[]
 or has_function_privilege('authenticated',p.oid,'execute') is distinct from s.auth_execute or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner and(not s.auth_execute or a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable)) then raise exception 'finance_adjustment_reviewed_core_changed:%',s.signature using errcode='55000';end if;
 end loop;
end$core_fingerprints$;
do $pins$declare s record;p record;begin
 for s in select * from(values
('finance_private.cash_forecast_agenda_preview(uuid,date,date,text)','ee53aa23fb2af973e3a56efee9bd2cbc',true,'s'),
('finance_private.cash_forecast_collect(uuid,date,date)','a80a695c4df1cfd79d9860bcc9012948',true,'s'),
('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)','0ab74d00bf2b0e2e475de5730acf568f',true,'s'),
('finance_private.project_collected_cash_forecast(jsonb)','115992c8873fb0b3a901308189cf4860',false,'i')
 )v(signature,hash,is_definer,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(s.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from s.hash or p.prosecdef is distinct from s.is_definer or p.provolatile::text<>s.volatility or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_forecast_adjustment_predecessor_changed:%',s.signature using errcode='55000';end if;
 end loop;
 if to_regprocedure('finance_private.receivable_adjustment_evidence(uuid,uuid)') is null then raise exception 'finance_forecast_adjustment_core_missing' using errcode='55000';end if;
end$pins$;
create function finance_private.forecast_adjustment_amount(r jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare k text;begin
 if not(r ?| array['discount_cents','loss_cents','adjustment_cents']) then return 0;end if;
 if not(r ?& array['discount_cents','loss_cents','adjustment_cents']) then raise exception 'finance_forecast_adjustment_incomplete' using errcode='22023';end if;
 foreach k in array array['discount_cents','loss_cents','adjustment_cents'] loop
  if r->'valid'='false'::jsonb then
   if r->k is distinct from 'null'::jsonb then raise exception 'finance_forecast_adjustment_unverified' using errcode='22023';end if;
  elsif jsonb_typeof(r->k) is distinct from 'string' or coalesce(r->>k,'')!~'^(0|[1-9][0-9]{0,13})$' then raise exception 'finance_forecast_adjustment_invalid' using errcode='22023';end if;
 end loop;
 if r->'valid'='false'::jsonb then return null;end if;
 if (r->>'discount_cents')::numeric+(r->>'loss_cents')::numeric<>(r->>'adjustment_cents')::numeric then raise exception 'finance_forecast_adjustment_sum' using errcode='22023';end if;
 return (r->>'adjustment_cents')::numeric;
end$$;
revoke all on function finance_private.forecast_adjustment_amount(jsonb) from public,anon,authenticated,service_role;
create function finance_private.forecast_adjustment_validation_input(v jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb;rows jsonb:='[]';begin
 for r in select value from jsonb_array_elements(v->'origins') loop
  perform finance_private.forecast_adjustment_amount(r);
  rows:=rows||jsonb_build_array(r-'discount_cents'-'loss_cents'-'adjustment_cents');
 end loop;
 return v||jsonb_build_object('origins',rows);
end$$;
revoke all on function finance_private.forecast_adjustment_validation_input(jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION finance_private.cash_forecast_agenda_preview(_tenant uuid, _cutoff date, _period_end date, _economic_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;r jsonb;
begin
 perform finance_private.require_access(_tenant);c:=finance_private.cash_forecast_collect(_tenant,_cutoff,_period_end);
 select value into r from jsonb_array_elements(c->'origins') where value->>'economic_key'=_economic_key;
 if r is null then raise exception 'finance_forecast_agenda_source_missing' using errcode='22023';end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'cutoff',_cutoff,'period_end',_period_end,'revision',c->'revision','origin',r,'eligible',r->'valid'='true'::jsonb and (r->>'nominal_cents')::numeric>(r->>'fulfilled_cents')::numeric+(r->>'reserved_credit_cents')::numeric+finance_private.forecast_adjustment_amount(r),'can_execute',false);
end$function$
;
CREATE OR REPLACE FUNCTION finance_private.cash_forecast_collect(_tenant uuid, _cutoff date, _period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;r jsonb;rows jsonb:='[]';history jsonb;last_event finance_private.cash_forecast_agenda_events%rowtype;agenda jsonb;issues jsonb;
begin
 perform finance_private.require_access(_tenant);c:=finance_private.cash_forecast_collect_before_agenda(_tenant,_cutoff,_period_end);issues:=c->'source_issues';
 for r in select value from jsonb_array_elements(c->'origins') loop
  select * into last_event from finance_private.cash_forecast_agenda_events where tenant_id=_tenant and economic_key=r->>'economic_key' order by ordinal desc limit 1;
  if found then
   select jsonb_agg(jsonb_build_object('id',e.id,'ordinal',e.ordinal,'previous_id',e.previous_id,'action',e.action,'expected_on',e.expected_on,'source_revision',e.source_revision,'original_expected_on',e.source_snapshot->'expected_on','original_expected_date_source',e.source_snapshot->'expected_date_source','actor_id',e.actor_id,'actor_name',e.actor_name,'reason',e.reason,'created_at',e.created_at) order by e.ordinal) into history from finance_private.cash_forecast_agenda_events e where e.tenant_id=_tenant and e.economic_key=r->>'economic_key';
   if last_event.source_table is distinct from r->>'source_table' or last_event.source_id::text is distinct from r->>'source_id' then raise exception 'finance_forecast_agenda_identity_invalid' using errcode='55000';end if;
   agenda:=jsonb_build_object('event_id',last_event.id,'revision',md5(history::text),'stale',last_event.action='set' and last_event.source_revision is distinct from r->>'source_revision','history',history);
   r:=r||jsonb_build_object('original_expected_on',r->'expected_on','original_expected_date_source',r->'expected_date_source','agenda',agenda);
   if last_event.action='set' then
    if agenda->'stale'='true'::jsonb then r:=r||jsonb_build_object('expected_on',null,'expected_date_source','unknown');if r->'valid' is distinct from 'true'::jsonb or coalesce((r->>'nominal_cents')::numeric-(r->>'fulfilled_cents')::numeric-(r->>'reserved_credit_cents')::numeric-finance_private.forecast_adjustment_amount(r),1)>0 then issues:=issues||jsonb_build_array(jsonb_build_object('scope',case when r->>'scenario'='unbilled' then 'expanded' else 'confirmed' end,'code','forecast_agenda_source_changed','source_ids',jsonb_build_array(last_event.source_id))); end if;
    else r:=r||jsonb_build_object('expected_on',last_event.expected_on,'expected_date_source','reviewed_date');end if;
   end if;
   r:=r||jsonb_build_object('source_revision',md5(jsonb_build_object('source',r->'source_revision','agenda',agenda)::text));
  end if;rows:=rows||jsonb_build_array(r);
 end loop;
 c:=c||jsonb_build_object('origins',rows,'source_issues',issues);
 return c||jsonb_build_object('revision',md5((c-'captured_at')::text));
end$function$
;
CREATE OR REPLACE FUNCTION finance_private.cash_forecast_collect_before_agenda(_tenant uuid, _cutoff date, _period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare captured timestamptz:=statement_timestamp();today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
 a record;r record;p record;f record;c record;m record;closure public.finance_account_period_closures%rowtype;
 ev jsonb;opening jsonb;components jsonb:='[]';origins jsonb:='[]';moves jsonb:='[]';credits jsonb:='[]';issues jsonb:='[]';accounts jsonb:='[]';
 value numeric;total_base numeric:=0;credit_total numeric:=0;nominal numeric;fulfilled numeric;valid boolean;base_valid boolean:=true;credit_valid boolean:=true;confirmation text;kind text;source_table text;source_id uuid;source_revision text;source jsonb;result jsonb;
 fingerprints jsonb:='[]';job record;count_accounts integer:=0;count_bank integer:=0;count_cash integer:=0;count_provisional integer:=0;matching integer;origin_issue text;
 begin
 perform finance_private.require_access(_tenant);
 if _cutoff is null or _period_end is null or not isfinite(_cutoff) or not isfinite(_period_end) or _cutoff>=today or _period_end<today or _period_end<=_cutoff or _period_end-_cutoff>3660 then raise exception 'finance_invalid_forecast_period' using errcode='22023';end if;
 for a in select * from public.bank_accounts where tenant_id=_tenant order by id loop
  count_accounts:=count_accounts+1;accounts:=accounts||jsonb_build_array(a.id);kind:=case when a.account_type='cash' then 'cash' when a.account_type in('checking','savings') then 'bank' else 'unsupported' end;
  value:=null;source_id:=null;source_table:=null;source:='{}';confirmation:='unverified';
  select count(*) into matching from public.finance_account_period_closures x where x.tenant_id=_tenant and x.account_id=a.id and x.period_end=_cutoff and not exists(select 1 from public.finance_account_period_reopenings y where y.tenant_id=_tenant and y.closure_id=x.id);
  if matching=1 and kind<>'unsupported' then
   select * into closure from public.finance_account_period_closures x where x.tenant_id=_tenant and x.account_id=a.id and x.period_end=_cutoff and not exists(select 1 from public.finance_account_period_reopenings y where y.tenant_id=_tenant and y.closure_id=x.id);
   ev:=finance_private.period_money_account(_tenant,a.id,closure.period_start,closure.period_end);source:=ev;source_table:='finance_account_period_closures';source_id:=closure.id;
   if ev->'coverage_complete'='true'::jsonb and coalesce(ev#>>'{balances,closing_cents}','')~'^-?[0-9]+$' then value:=(ev#>>'{balances,closing_cents}')::numeric;confirmation:=case when kind='cash' then 'cash_count' else 'bank_confirmed' end;end if;
  elsif matching=0 and kind<>'unsupported' then
   ev:=finance_private.account_opening(_tenant,a.id,_cutoff+1,_cutoff+1);opening:=ev->'opening';source:=ev;source_table:='finance_account_openings';source_id:=nullif(opening->>'id','')::uuid;
   if opening->>'evidence_status'='valid' and coalesce(ev#>>'{book,opening_cents}','')~'^-?[0-9]+$' then
    value:=(ev#>>'{book,opening_cents}')::numeric;confirmation:=case when opening->>'effective_from'=(_cutoff+1)::text then case when kind='cash' then 'cash_count' else 'bank_confirmed' end else 'provisional' end;
   end if;
  end if;
  if value is null then base_valid:=false;issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code',case when matching>1 then 'forecast_base_ambiguous' when kind='unsupported' then 'forecast_account_type_unsupported' else 'forecast_base_unverified' end,'source_ids',jsonb_build_array(a.id)));else total_base:=total_base+value;end if;
  if confirmation='provisional' then count_provisional:=count_provisional+1;elsif confirmation='bank_confirmed' then count_bank:=count_bank+1;elsif confirmation='cash_count' then count_cash:=count_cash+1;end if;
  source_revision:=md5(jsonb_build_object('account',to_jsonb(a),'base',source)::text);
  components:=components||jsonb_build_array(jsonb_build_object('account_id',a.id,'account_kind',kind,'source_table',source_table,'source_id',source_id,'source_revision',source_revision,'amount_cents',case when value is not null then trunc(value)::text end,'confirmation',confirmation));
 end loop;
 if count_accounts=0 then base_valid:=false;issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_accounts_missing','source_ids','[]'::jsonb));end if;
 for r in select * from public.receivables where tenant_id=_tenant and status is distinct from 'cancelled' order by id loop
  nominal:=null;fulfilled:=null;ev:=null;
  valid:=coalesce(r.status in('pending','invoiced','partial','received') and r.created_at is not null and isfinite(r.created_at) and r.amount::text not in('NaN','Infinity','-Infinity') and coalesce(r.received_amount,0)::text not in('NaN','Infinity','-Infinity') and r.amount>=0 and r.amount*100=trunc(r.amount*100) and r.amount*100<=99999999999999 and coalesce(r.received_amount,0)>=0 and coalesce(r.received_amount,0)<=r.amount and coalesce(r.received_amount,0)*100=trunc(coalesce(r.received_amount,0)*100) and (r.status<>'received' or r.amount=coalesce(r.received_amount,0)) and (r.due_date is null or isfinite(r.due_date)),false)
   ;
  if valid then ev:=public._receivable_financial_snapshot(_tenant,r.id);valid:=coalesce(ev->'requires_reconciliation'='false'::jsonb and nullif(ev->>'fiscal_block_reason','') is null and nullif(ev->>'source_issue','') is null,false);else ev:=jsonb_build_object('invalid_title',true);end if;
  valid:=coalesce(valid,false);if valid then nominal:=trunc(r.amount*100);fulfilled:=trunc(coalesce(r.received_amount,0)*100);else issues:=issues||jsonb_build_array(jsonb_build_object('scope','confirmed','code','forecast_receivable_unverified','source_ids',jsonb_build_array(r.id)));end if;
  origins:=origins||jsonb_build_array(jsonb_build_object('economic_key','receivable:'||r.id,'source_table','receivables','source_id',r.id,'source_revision',md5(jsonb_build_object('title',to_jsonb(r),'snapshot',ev)::text),'direction','in','scenario','confirmed','nominal_cents',nominal::text,'fulfilled_cents',case when valid then ev->>'cash_received_cents' end,'reserved_credit_cents',case when valid then ev->>'credit_applied_cents' end,'discount_cents',case when valid then ev->>'discount_cents' end,'loss_cents',case when valid then ev->>'loss_cents' end,'adjustment_cents',case when valid then ev->>'adjustment_cents' end,'expected_on',case when isfinite(r.due_date) then r.due_date end,'expected_date_source',case when r.due_date is not null and isfinite(r.due_date) then 'due_date' else 'unknown' end,'valid',valid));
 end loop;
 for p in select * from public.payables where tenant_id=_tenant and status is distinct from 'cancelled' order by id loop
  ev:=finance_private.payable_effective_cost_evidence(_tenant,p.id,finance_private.payable_portfolio_evidence(_tenant,p.id));valid:=coalesce(ev->'valid'='true'::jsonb,false);
  if not valid then issues:=issues||jsonb_build_array(jsonb_build_object('scope','confirmed','code','forecast_payable_unverified','source_ids',jsonb_build_array(p.id)));end if;
  origins:=origins||jsonb_build_array(jsonb_build_object('economic_key','payable:'||p.id,'source_table','payables','source_id',p.id,'source_revision',md5(jsonb_build_object('title',to_jsonb(p),'evidence',ev)::text),'direction','out','scenario','confirmed','nominal_cents',case when valid then ev->>'nominal_cents' end,'fulfilled_cents',case when valid then ev->>'paid_cents' end,'reserved_credit_cents',case when valid then '0' end,'expected_on',case when isfinite(p.due_date) then p.due_date end,'expected_date_source',case when p.due_date is not null and isfinite(p.due_date) then 'due_date' else 'unknown' end,'valid',valid));
 end loop;
 for job in select j.observation_id,j.status,j.issue,j.result,o.snapshot_hash,o.snapshot from public.finance_fiscal_projection_jobs j join public.finance_fiscal_observations o on o.tenant_id=j.tenant_id and o.id=j.observation_id where j.tenant_id=_tenant and j.status in('pending','review') order by j.observation_id loop
  fingerprints:=fingerprints||jsonb_build_array(md5(to_jsonb(job)::text));
  issues:=issues||jsonb_build_array(jsonb_build_object('scope','confirmed','code','forecast_fiscal_projection_pending','source_ids',jsonb_build_array(job.observation_id)));
 end loop;
 for f in select * from finance_private.unbilled_freight_rows(_tenant) order by document_id,attempt_id nulls first loop
  fingerprints:=fingerprints||jsonb_build_array(md5(to_jsonb(f)::text));
  origin_issue:=null;
  if f.state='review' then origin_issue:='forecast_unbilled_requires_review';
  elsif f.state in('reserved','uncertain') then origin_issue:='forecast_unbilled_pending_fiscal';
  elsif f.state='available' and exists(select 1 from public.receivables x where x.tenant_id=_tenant and x.status is distinct from 'cancelled' and x.fiscal_document_id=f.document_id and not exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=x.id)) then origin_issue:='freight_title_lineage_ambiguous';end if;
  if origin_issue is not null then issues:=issues||jsonb_build_array(jsonb_build_object('scope','expanded','code',origin_issue,'source_ids',jsonb_build_array(f.document_id)||case when f.attempt_id is null then '[]'::jsonb else jsonb_build_array(f.attempt_id) end));end if;
  if f.state='available' and origin_issue is null then
   origins:=origins||jsonb_build_array(jsonb_build_object('economic_key','freight:'||f.document_id||':'||coalesce(f.attempt_id::text,'original'),'source_table',case when f.attempt_id is null then 'fiscal_documents' else 'delivery_attempts' end,'source_id',coalesce(f.attempt_id,f.document_id),'source_revision',md5(to_jsonb(f)::text),'direction','in','scenario','unbilled','nominal_cents',trunc(f.freight_cents)::text,'fulfilled_cents','0','reserved_credit_cents','0','expected_on',null,'expected_date_source','unknown','valid',true));
  end if;
 end loop;
 for m in select * from finance_private.active_movements where tenant_id=_tenant and occurred_on>_cutoff and occurred_on<=today order by occurred_on,id loop
  if not exists(select 1 from public.bank_accounts account_row where account_row.tenant_id=_tenant and account_row.id=m.bank_account_id) or m.direction not in('in','out') or m.amount_cents<=0 or not isfinite(m.occurred_on) then issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_movement_unverified','source_ids',jsonb_build_array(m.id)));continue;end if;
  ev:=finance_private.forecast_movement_evidence(_tenant,m.id);if ev->'verified' is distinct from 'true'::jsonb then issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_movement_origin_unverified','source_ids',jsonb_build_array(m.id)));end if;
  moves:=moves||jsonb_build_array(jsonb_build_object('movement_id',m.id,'account_id',m.bank_account_id,'source_revision',ev->>'revision','occurred_on',m.occurred_on,'direction',m.direction,'amount_cents',m.amount_cents::text,'confirmation','recorded'));
 end loop;
 if exists(select 1 from finance_private.active_movements where tenant_id=_tenant and (occurred_on is null or not isfinite(occurred_on))) then issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_movement_date_unknown','source_ids',(select jsonb_agg(id order by id) from finance_private.active_movements where tenant_id=_tenant and (occurred_on is null or not isfinite(occurred_on)))));end if;
 if exists(select 1 from finance_private.active_movements where tenant_id=_tenant and occurred_on>today and isfinite(occurred_on)) then issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code','forecast_future_recorded_money','source_ids',(select jsonb_agg(id order by id) from finance_private.active_movements where tenant_id=_tenant and occurred_on>today and isfinite(occurred_on))));end if;
 for c in select * from public.finance_customer_credits where tenant_id=_tenant order by id loop
  ev:=finance_private.forecast_customer_credit_evidence(_tenant,c.id);valid:=coalesce(ev->'valid'='true'::jsonb,false);
  if valid then credit_total:=credit_total+(ev->>'amount_cents')::numeric;else credit_valid:=false;end if;
  credits:=credits||jsonb_build_array(ev);
  if not valid or (ev->>'amount_cents')::numeric>0 then issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code',case when valid then 'unassigned_customer_credit' else 'forecast_customer_credit_unverified' end,'source_ids',jsonb_build_array(c.id))); end if;
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'basis','current_company_cash_forecast','cutoff',_cutoff,'period_end',_period_end,'account_scope',jsonb_build_object('mode','whole_company','account_ids',accounts),'base',jsonb_build_object('as_of',_cutoff,'amount_cents',case when base_valid then trunc(total_base)::text end,'confirmation',case when not base_valid then 'unverified' when count_provisional>0 then 'provisional' when count_cash>0 and count_bank>0 then 'mixed_confirmed' when count_cash>0 then 'cash_count' else 'bank_confirmed' end,'components',components),'origins',origins,'recorded_after_cutoff',moves,'unassigned_credit_cents',case when credit_valid then trunc(credit_total)::text end,'credits',credits,'source_issues',issues,'counts',jsonb_build_object('accounts',count_accounts,'origins',jsonb_array_length(origins),'movements',jsonb_array_length(moves),'credits',jsonb_array_length(credits)));
 return result||jsonb_build_object('revision',md5(jsonb_build_object('result',result,'source_fingerprints',fingerprints)::text),'captured_at',captured);
end$function$
;
CREATE OR REPLACE FUNCTION finance_private.project_collected_cash_forecast(_collection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare v jsonb:=_collection;parts jsonb;row jsonb;issues jsonb;rows jsonb:='[]';projection jsonb;keys text[];item text;f text;confirmation text;captured_day date;
 base_amount numeric;sum_base numeric:=0;sum_credit numeric:=0;remaining numeric;incoming numeric:=0;outgoing numeric:=0;unbilled numeric:=0;recorded_in numeric:=0;recorded_out numeric:=0;unscheduled_confirmed numeric:=0;unscheduled_unbilled numeric:=0;timing text;unknown_base boolean:=false;unknown_credit boolean:=false;provisional boolean:=false;confirmations text[]:='{}';confirmed_complete boolean;expanded_complete boolean;begin
 perform finance_private.validate_forecast_json(finance_private.forecast_adjustment_validation_input(finance_private.forecast_agenda_projection_input(v)), '{"version":{"$literal":1},"tenant_id":"uuid","actor_id":"uuid","captured_at":"timestamp","revision":"revision","basis":{"$enum":["current_company_cash_forecast"]},"cutoff":"day","period_end":"day","account_scope":{"mode":{"$enum":["whole_company"]},"account_ids":{"$array":"uuid"}},"base":{"as_of":"day","amount_cents":{"$nullable":"integer_string"},"confirmation":{"$enum":["bank_confirmed","cash_count","mixed_confirmed","provisional","unverified"]},"components":{"$array":{"account_id":"uuid","account_kind":{"$enum":["bank","cash","unsupported"]},"source_table":{"$nullable":{"$enum":["finance_account_period_closures","finance_account_openings"]}},"source_id":{"$nullable":"uuid"},"source_revision":"revision","amount_cents":{"$nullable":"integer_string"},"confirmation":{"$enum":["bank_confirmed","cash_count","provisional","unverified"]}}}},"origins":{"$array":{"economic_key":"nonempty","source_table":{"$enum":["receivables","payables","fiscal_documents","delivery_attempts"]},"source_id":"uuid","source_revision":"revision","direction":{"$enum":["in","out"]},"scenario":{"$enum":["confirmed","unbilled"]},"nominal_cents":{"$nullable":"nonnegative"},"fulfilled_cents":{"$nullable":"nonnegative"},"reserved_credit_cents":{"$nullable":"nonnegative"},"expected_on":{"$nullable":"day"},"expected_date_source":{"$enum":["due_date","reviewed_date","unknown"]},"valid":"boolean"}},"recorded_after_cutoff":{"$array":{"movement_id":"uuid","account_id":"uuid","source_revision":"revision","occurred_on":"day","direction":{"$enum":["in","out"]},"amount_cents":"nonnegative","confirmation":{"$enum":["recorded"]}}},"unassigned_credit_cents":{"$nullable":"nonnegative"},"credits":{"$array":{"credit_id":"uuid","payer_id":"uuid","source_payment_id":"uuid","source_revision":"revision","amount_cents":{"$nullable":"nonnegative"},"valid":"boolean"}},"source_issues":{"$array":{"scope":{"$enum":["confirmed","expanded","all"]},"code":"nonempty","source_ids":{"$array":"uuid"}}},"counts":{"accounts":"count","origins":"count","movements":"count","credits":"count"}}'::jsonb);
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
   if row->'nominal_cents'='null'::jsonb or row->'fulfilled_cents'='null'::jsonb or row->'reserved_credit_cents'='null'::jsonb or (row->>'fulfilled_cents')::numeric+(row->>'reserved_credit_cents')::numeric+finance_private.forecast_adjustment_amount(row)>(row->>'nominal_cents')::numeric then raise exception 'finance_forecast_origin_amount' using errcode='22023';end if;
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
  remaining:=(row->>'nominal_cents')::numeric-(row->>'fulfilled_cents')::numeric-(row->>'reserved_credit_cents')::numeric-finance_private.forecast_adjustment_amount(row);
  timing:=case when remaining=0 then 'already_covered' when row->'expected_on'='null'::jsonb or (row->>'expected_on')::date<captured_day then 'needs_new_date' when (row->>'expected_on')::date>(v->>'period_end')::date then 'after_period' else 'in_period' end;
  if timing='in_period' then if row->>'scenario'='unbilled' then unbilled:=unbilled+remaining;elsif row->>'direction'='in' then incoming:=incoming+remaining;else outgoing:=outgoing+remaining;end if;end if;
  if timing='needs_new_date' then if row->>'scenario'='unbilled' then unscheduled_unbilled:=unscheduled_unbilled+remaining;else unscheduled_confirmed:=unscheduled_confirmed+remaining;end if;end if;
  rows:=rows||jsonb_build_array((row-'valid'-'original_expected_on'-'original_expected_date_source'-'agenda')||jsonb_build_object('remaining_cents',remaining::text,'timing',timing));
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
end$function$
;

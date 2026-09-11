-- Private server collection only. No title, money, forecast journal, or fiscal emission is written.
set lock_timeout='3s';
set statement_timeout='30s';
create function finance_private.forecast_movement_evidence(_tenant uuid,_movement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $proof$
declare m public.finance_movements%rowtype;manual jsonb;families jsonb:='[]';candidate record;proof_count integer:=0;
begin
 perform finance_private.require_access(_tenant);
 select * into m from finance_private.active_movements where tenant_id=_tenant and id=_movement;
 if not found then return jsonb_build_object('verified',false,'revision',md5('inactive:'||_movement::text));end if;
 manual:=finance_private.movement_recording_origin(_tenant,_movement);
 if manual->'verified'='true'::jsonb then return jsonb_build_object('verified',true,'revision',manual->>'revision');end if;
 -- A damaged manual origin is not rescued by a later allocation to that money.
 if manual#>'{snapshot,recording_commands}'<>'[]'::jsonb or manual#>'{snapshot,recording_events}'<>'[]'::jsonb then return jsonb_build_object('verified',false,'revision',manual->>'revision');end if;
 for candidate in
  select to_jsonb(cmd) command,to_jsonb(pair) relation,to_jsonb(outgoing) debit,to_jsonb(incoming) credit,
   (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.finance_events e where e.tenant_id=_tenant and e.entity_type='internal_transfer' and e.entity_id=pair.id and e.action='internal_transfer_recorded') events,
   coalesce(m.nature='transfer' and outgoing.direction='out' and incoming.direction='in' and outgoing.nature='transfer' and incoming.nature='transfer' and outgoing.amount_cents=incoming.amount_cents and outgoing.bank_account_id<>incoming.bank_account_id and outgoing.occurred_on<=incoming.occurred_on
    and cmd.actor_id=pair.created_by and cmd.actor_id=outgoing.created_by and cmd.actor_id=incoming.created_by
    and cmd.payload @> jsonb_build_object('version',1,'tenant_id',_tenant,'request_id',cmd.request_id,'source_account_id',outgoing.bank_account_id,'destination_account_id',incoming.bank_account_id,'debited_on',outgoing.occurred_on,'credited_on',incoming.occurred_on,'both_recorded',true)
    and case when cmd.payload->>'amount_cents'~'^[0-9]{1,14}$' then (cmd.payload->>'amount_cents')::numeric=outgoing.amount_cents else false end
    and cmd.result @> jsonb_build_object('tenant_id',_tenant,'request_id',cmd.request_id,'transfer_id',pair.id,'outgoing_id',outgoing.id,'incoming_id',incoming.id,'confirmed',true),false) valid
  from public.finance_internal_transfers pair join public.finance_commands cmd on cmd.tenant_id=pair.tenant_id and cmd.action='record_internal_transfer' and cmd.result->>'transfer_id'=pair.id::text
  join finance_private.active_movements outgoing on outgoing.tenant_id=pair.tenant_id and outgoing.id=pair.outgoing_id join finance_private.active_movements incoming on incoming.tenant_id=pair.tenant_id and incoming.id=pair.incoming_id
  where pair.tenant_id=_tenant and _movement in(pair.outgoing_id,pair.incoming_id)
 loop
  families:=families||jsonb_build_array(to_jsonb(candidate));
  if candidate.valid and jsonb_array_length(candidate.events)=1 and candidate.events->0->>'actor_id'=candidate.command->>'actor_id' and candidate.events->0->>'reason'=btrim(candidate.command#>>'{payload,reason}') and (candidate.events->0->'after_data') @> (candidate.command->'result') and (candidate.events->0->'after_data') @> jsonb_build_object('amount_cents',(candidate.debit->>'amount_cents')::bigint,'source_account_id',candidate.debit->>'bank_account_id','destination_account_id',candidate.credit->>'bank_account_id','debited_on',candidate.debit->>'occurred_on','credited_on',candidate.credit->>'occurred_on') then proof_count:=proof_count+1;end if;
 end loop;
 for candidate in
  select to_jsonb(cmd) command,to_jsonb(departure) relation,to_jsonb(outgoing) debit,to_jsonb(pair) pair,
   (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.finance_events e where e.tenant_id=_tenant and e.entity_type='transfer_departure' and e.entity_id=departure.id and e.action=case when cmd.payload->>'stage'='depart' then 'transfer_departed' else 'transfer_arrived' end and e.after_data->>'movement_id'=_movement::text) events,
   coalesce(m.nature='transfer' and cmd.actor_id=m.created_by and cmd.payload->>'occurred_on'=m.occurred_on::text and cmd.payload @> jsonb_build_object('version',1,'tenant_id',_tenant,'request_id',cmd.request_id,'occurred',true)
    and cmd.result @> jsonb_build_object('tenant_id',_tenant,'request_id',cmd.request_id,'departure_id',departure.id,'movement_id',m.id,'confirmed',true)
    and ((cmd.payload->>'stage'='depart' and cmd.result->>'stage'='depart' and m.id=departure.outgoing_id and m.direction='out' and departure.created_by=cmd.actor_id and cmd.payload->>'source_account_id'=m.bank_account_id::text and cmd.payload->>'destination_account_id'=departure.destination_account_id::text and m.bank_account_id<>departure.destination_account_id and case when cmd.payload->>'amount_cents'~'^[0-9]{1,14}$' then (cmd.payload->>'amount_cents')::numeric=m.amount_cents else false end)
     or (cmd.payload->>'stage'='arrive' and cmd.result->>'stage'='arrive' and cmd.payload->>'departure_id'=departure.id::text and cmd.result->>'transfer_id'=pair.id::text and pair.incoming_id=m.id and pair.outgoing_id=departure.outgoing_id and m.direction='in' and m.bank_account_id=departure.destination_account_id and outgoing.direction='out' and outgoing.nature='transfer' and outgoing.bank_account_id<>m.bank_account_id and outgoing.amount_cents=m.amount_cents and outgoing.occurred_on<=m.occurred_on)),false) valid
  from public.finance_commands cmd join public.finance_transfer_departures departure on departure.tenant_id=cmd.tenant_id and cmd.result->>'departure_id'=departure.id::text
  join finance_private.active_movements outgoing on outgoing.tenant_id=departure.tenant_id and outgoing.id=departure.outgoing_id left join public.finance_internal_transfers pair on pair.tenant_id=departure.tenant_id and pair.outgoing_id=departure.outgoing_id and pair.incoming_id=_movement
  where cmd.tenant_id=_tenant and cmd.action='record_transfer_stage' and cmd.result->>'movement_id'=_movement::text
 loop
  families:=families||jsonb_build_array(to_jsonb(candidate));
  if candidate.valid and jsonb_array_length(candidate.events)=1 and candidate.events->0->>'actor_id'=candidate.command->>'actor_id' and candidate.events->0->>'reason'=btrim(candidate.command#>>'{payload,reason}') and (candidate.events->0->'after_data') @> (candidate.command->'result') and candidate.events->0->'after_data' @> jsonb_build_object('amount_cents',m.amount_cents,'occurred_on',m.occurred_on) then proof_count:=proof_count+1;end if;
 end loop;
 for candidate in
  select to_jsonb(link) relation,to_jsonb(cmd) command,to_jsonb(payment) payment,to_jsonb(tx) bank,to_jsonb(refund) refund,
   (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.finance_events e where e.tenant_id=_tenant and e.entity_type='movement' and e.entity_id=_movement and e.action='receivable_movement_recorded' and e.after_data->>'command_id'=cmd.id::text) events,
   coalesce(cmd.actor_id=m.created_by and cmd.action=link.action and cmd.response @> jsonb_build_object('tenant_id',_tenant,'actor_id',cmd.actor_id,'receivable_id',cmd.receivable_id,'payment_id',payment.id,'bank_transaction_id',tx.id,'confirmed',true)
    and tx.bank_account_id=m.bank_account_id and tx.amount*100=m.amount_cents and (tx.posted_at at time zone 'America/Sao_Paulo')::date=m.occurred_on and payment.receivable_id=cmd.receivable_id
    and ((cmd.action='receive' and not(cmd.response ? 'movement_id') and payment.financial_command_id=cmd.id and payment.bank_transaction_id=tx.id and payment.bank_account_id=tx.bank_account_id and payment.amount=tx.amount and payment.received_at=tx.posted_at and m.direction='in' and m.nature='receipt' and tx.transaction_type='credit')
      or(cmd.action='reverse' and refund.financial_command_id=cmd.id and refund.bank_transaction_id=tx.id and refund.amount=tx.amount and refund.effective_at=tx.posted_at and m.direction='out' and m.nature='refund' and tx.transaction_type='debit')),false) valid
  from public.finance_receivable_movement_links link join public.receivable_financial_commands cmd on cmd.tenant_id=link.tenant_id and cmd.id=link.command_id join public.receivables_payments payment on payment.tenant_id=link.tenant_id and payment.id=link.payment_id join public.bank_transactions tx on tx.tenant_id=link.tenant_id and tx.id=link.bank_transaction_id
  left join public.receivable_payment_reversals refund on refund.tenant_id=link.tenant_id and refund.financial_command_id=link.command_id and refund.payment_id=link.payment_id
  where link.tenant_id=_tenant and link.movement_id=_movement
 loop
  families:=families||jsonb_build_array(to_jsonb(candidate));
  if candidate.valid and jsonb_array_length(candidate.events)=1 and candidate.events->0->>'actor_id'=candidate.command->>'actor_id' and candidate.events->0->'after_data' @> jsonb_build_object('movement_id',m.id,'command_id',candidate.command->>'id','payment_id',candidate.payment->>'id','legacy_bank_transaction_id',candidate.bank->>'id','source_action',candidate.command->>'action') then proof_count:=proof_count+1;end if;
 end loop;
 return jsonb_build_object('verified',proof_count=1,'revision',md5(jsonb_build_object('movement',to_jsonb(m),'manual',manual,'families',families)::text));
end$proof$;
revoke all on function finance_private.forecast_movement_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.forecast_customer_credit_evidence(_tenant uuid,_credit uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $credit$
declare c public.finance_customer_credits%rowtype;source jsonb;valid boolean;
begin
 perform finance_private.require_access(_tenant);
 select * into c from public.finance_customer_credits where tenant_id=_tenant and id=_credit;
 if not found then raise exception 'finance_credit_not_found' using errcode='22023';end if;
  select jsonb_build_object('credit',to_jsonb(c),'payment',to_jsonb(payment_row),'bank',to_jsonb(bank_row),'reversals',(select coalesce(jsonb_agg(to_jsonb(rv) order by id),'[]') from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=c.payment_id),'corrections',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.finance_receipt_allocation_corrections x where x.tenant_id=_tenant and x.payment_id=c.payment_id)) into source from public.receivables_payments payment_row left join public.bank_transactions bank_row on bank_row.tenant_id=payment_row.tenant_id and bank_row.id=c.bank_transaction_id where payment_row.tenant_id=_tenant and payment_row.id=c.payment_id;
  valid:=source is not null and source#>>'{payment,receivable_id}'=c.receivable_id::text and source#>>'{payment,bank_transaction_id}'=c.bank_transaction_id::text and source#>>'{bank,transaction_type}'='credit' and source#>>'{payment,bank_account_id}'=source#>>'{bank,bank_account_id}' and coalesce((source#>>'{payment,amount}')::numeric*100=c.amount_cents,false) and coalesce((source#>>'{bank,amount}')::numeric*100=c.amount_cents,false) and source->'reversals'='[]'::jsonb and source->'corrections'='[]'::jsonb and c.receipt_snapshot->>'id'=c.payment_id::text and c.receipt_snapshot->>'tenant_id'=_tenant::text and c.receipt_snapshot->>'receivable_id'=c.receivable_id::text and c.receipt_snapshot->>'bank_transaction_id'=c.bank_transaction_id::text
   and not exists(select 1 from public.receivables_payments other where other.tenant_id=_tenant and other.bank_transaction_id=c.bank_transaction_id and other.id<>c.payment_id)
   and exists(select 1 from public.finance_fiscal_receivable_origins o join public.receivables credited_title on credited_title.tenant_id=o.tenant_id and credited_title.id=o.receivable_id join public.finance_fiscal_observations observation on observation.tenant_id=o.tenant_id and observation.emission_id=o.emission_id and observation.id=c.observation_id where o.tenant_id=_tenant and o.id=c.origin_id and o.receivable_id=c.receivable_id and o.basis->>'payer_id'=c.payer_id::text and o.state='cancelled' and credited_title.status='cancelled');
  valid:=coalesce(valid,false);
  source:=jsonb_build_object('credit',to_jsonb(c),'proof',source,'origin',(select to_jsonb(o) from public.finance_fiscal_receivable_origins o where o.tenant_id=_tenant and o.id=c.origin_id),'observation',(select to_jsonb(o) from public.finance_fiscal_observations o where o.tenant_id=_tenant and o.id=c.observation_id));
 return jsonb_build_object('credit_id',c.id,'payer_id',c.payer_id,'source_payment_id',c.payment_id,'source_revision',md5(coalesce(source,'null'::jsonb)::text),'amount_cents',case when valid then c.amount_cents::text end,'valid',valid);
end$credit$;
revoke all on function finance_private.forecast_customer_credit_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.cash_forecast_collect(_tenant uuid,_cutoff date,_period_end date) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
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
  if valid then ev:=public._receivable_financial_snapshot(_tenant,r.id);valid:=coalesce(ev->'requires_reconciliation'='false'::jsonb and nullif(ev->>'fiscal_block_reason','') is null,false);else ev:=jsonb_build_object('invalid_title',true);end if;
  valid:=coalesce(valid,false);if valid then nominal:=trunc(r.amount*100);fulfilled:=trunc(coalesce(r.received_amount,0)*100);else issues:=issues||jsonb_build_array(jsonb_build_object('scope','confirmed','code','forecast_receivable_unverified','source_ids',jsonb_build_array(r.id)));end if;
  origins:=origins||jsonb_build_array(jsonb_build_object('economic_key','receivable:'||r.id,'source_table','receivables','source_id',r.id,'source_revision',md5(jsonb_build_object('title',to_jsonb(r),'snapshot',ev)::text),'direction','in','scenario','confirmed','nominal_cents',nominal::text,'fulfilled_cents',fulfilled::text,'reserved_credit_cents',case when valid then '0' end,'expected_on',case when isfinite(r.due_date) then r.due_date end,'expected_date_source',case when r.due_date is not null and isfinite(r.due_date) then 'due_date' else 'unknown' end,'valid',valid));
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
  if valid then credit_total:=credit_total+c.amount_cents;else credit_valid:=false;end if;
  credits:=credits||jsonb_build_array(ev);
  issues:=issues||jsonb_build_array(jsonb_build_object('scope','all','code',case when valid then 'unassigned_customer_credit' else 'forecast_customer_credit_unverified' end,'source_ids',jsonb_build_array(c.id)));
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'basis','current_company_cash_forecast','cutoff',_cutoff,'period_end',_period_end,'account_scope',jsonb_build_object('mode','whole_company','account_ids',accounts),'base',jsonb_build_object('as_of',_cutoff,'amount_cents',case when base_valid then trunc(total_base)::text end,'confirmation',case when not base_valid then 'unverified' when count_provisional>0 then 'provisional' when count_cash>0 and count_bank>0 then 'mixed_confirmed' when count_cash>0 then 'cash_count' else 'bank_confirmed' end,'components',components),'origins',origins,'recorded_after_cutoff',moves,'unassigned_credit_cents',case when credit_valid then trunc(credit_total)::text end,'credits',credits,'source_issues',issues,'counts',jsonb_build_object('accounts',count_accounts,'origins',jsonb_array_length(origins),'movements',jsonb_array_length(moves),'credits',jsonb_array_length(credits)));
 return result||jsonb_build_object('revision',md5(jsonb_build_object('result',result,'source_fingerprints',fingerprints)::text),'captured_at',captured);
end$fn$;
revoke all on function finance_private.cash_forecast_collect(uuid,date,date) from public,anon,authenticated,service_role;

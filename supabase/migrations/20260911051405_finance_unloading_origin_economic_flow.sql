do $preflight$ declare item record;p record;begin for item in select * from (values ('finance_private.unloading_flow_event(uuid,jsonb,jsonb,jsonb)','6e4987df165d809bcc23fa562d0e2983'),('finance_private.period_unloading_flow(uuid,date,date,uuid[],uuid,integer,text)','5082df7b32208c79f9ee783ac4158db3'))v(signature,hash) loop select * into p from pg_proc where oid=to_regprocedure(item.signature);if p.oid is null or md5(p.prosrc)<>item.hash or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') then raise exception 'unloading_flow_origin_predecessor_changed' using errcode='55000';end if;end loop;end $preflight$;
-- Verify the origin version captured at receipt time, not the current supplier.
create function finance_private.unloading_flow_receipt_origin(t uuid,charge uuid,marker jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;origin jsonb;version jsonb;state jsonb;revision text;valid boolean;
begin
 base:=finance_private.unloading_origin_base(t,charge);
 state:=jsonb_build_object('supplier_id',base#>'{original,supplier_id}','supplier_name',base#>'{original,supplier_name}','amount_cents',base#>'{original,amount_cents}','status','active');
 revision:=md5(jsonb_build_object('charge',base#>'{_evidence,charge}','commands',base#>'{_evidence,commands}','events',base#>'{_evidence,events}')::text);
 valid:=base->>'origin_verified'='true';
 if marker is not null and marker<>'null'::jsonb then
  if marker->>'amendment_id' is not null then
   origin:=finance_private.unloading_effective_origin(t,charge);
   select x into version from jsonb_array_elements(origin->'history')x where x->>'id'=marker->>'amendment_id';
   valid:=valid and origin->>'verified'='true' and version is not null;
   state:=version->'after';revision:=version->>'revision_after';
  end if;
  valid:=valid and marker->'version'='1'::jsonb and marker->>'charge_id'=charge::text and marker->>'verified'='true' and marker->>'revision'=revision and marker->'effective'=state and state->>'status'='active';
 end if;
 return jsonb_build_object('verified',coalesce(valid,false),'effective',state,'revision',revision,'marker',marker);
end$$;
revoke all on function finance_private.unloading_flow_receipt_origin(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function finance_private.unloading_adjustment_events(t uuid,from_date date,to_date date) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.finance_unloading_charges%rowtype;origin jsonb;v jsonb;leg jsonb;original_event jsonb;valid boolean;
begin
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 for c in select x.* from public.finance_unloading_charges x where x.tenant_id=t and exists(select 1 from finance_private.unloading_origin_amendments a where a.tenant_id=t and a.charge_id=x.id and a.effective_on between from_date and to_date) loop
  origin:=finance_private.unloading_effective_origin(t,c.id);original_event:=finance_private.unloading_flow_event(t,to_jsonb(c),null,null);valid:=origin->>'verified'='true';
  for v in select x from jsonb_array_elements(origin->'history')x where (x->>'effective_on')::date between from_date and to_date loop
   for leg in select x from jsonb_array_elements(v->'economic_effects')x loop
    return next (original_event-'_proof')||jsonb_build_object('event_id',v->'id','kind','adjustment','supplier_id',leg->'supplier_id','supplier_name',leg->'supplier_name',
     'economic_on',v->'effective_on','recorded_at',v->'created_at','amount_cents',case when valid then leg->'amount_cents' end,'valid',valid,'issues',case when valid then '[]'::jsonb else '["unloading_amendment_chain_invalid"]'::jsonb end,
     'amendment_id',v->'id','adjustment_leg',leg->'leg','amendment_actor_id',v->'actor_id','amendment_actor_name',v->'actor_name','amendment_reason',v->'reason',
     '_proof_hash',md5(jsonb_build_object('version',v,'origin_revision',origin->'revision')::text),'_movement_amount',null);
   end loop;
  end loop;
 end loop;
end$$;
revoke all on function finance_private.unloading_adjustment_events(uuid,date,date) from public,anon,authenticated,service_role;
create function finance_private.unloading_flow_net_total(rows jsonb,supplier uuid default null) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('count',count(*),'valid',coalesce(bool_and((x->>'valid')::boolean),true),'amount_cents',case when coalesce(bool_and((x->>'valid')::boolean),true) then coalesce(sum((x->>'amount_cents')::numeric),0)::text end)
 from jsonb_array_elements(rows)x where x->>'kind' in('charge','adjustment') and (supplier is null or x->>'supplier_id'=supplier::text)
$$;
revoke all on function finance_private.unloading_flow_net_total(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function finance_private.unloading_flow_event(_tenant uuid,c jsonb,p jsonb,r jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt_origin jsonb;claim_supplier text:=c->>'supplier_id';claim_name text:=c#>>'{source_snapshot,supplier_name}';claim_cents text:=c->>'amount_cents';kind text:=case when r is not null then 'refund' when p is not null then 'receipt' else 'charge' end;
 issues text[]:='{}';cmd public.finance_commands%rowtype;fc public.receivable_financial_commands%rowtype;
 link public.finance_receivable_movement_links%rowtype;m public.finance_movements%rowtype;tx public.bank_transactions%rowtype;refund_command public.receivable_financial_commands%rowtype;
 day date;due date;cents numeric;raw_amount text;event_id uuid;command_uuid uuid;account uuid;sidecars jsonb:='[]';docs jsonb;proof jsonb;used numeric;claims_valid boolean;n bigint;
begin
 select count(*) into n from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c->>'id';
 select * into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c->>'id' order by x.request_id limit 1;
 if n<>1 or cmd.result->>'receivable_id' is distinct from c->>'receivable_id' or cmd.result->>'supplier_id' is distinct from c->>'supplier_id'
  or cmd.payload->>'amount_cents' is distinct from c->>'amount_cents' or c->'source_snapshot'->>'supplier_id' is distinct from c->>'supplier_id' then issues:=array_append(issues,'unloading_origin_mismatch');end if;
 due:=finance_private.package_day(cmd.payload->>'due_date');
 if cmd.payload->>'due_date' is not null and due is null then issues:=array_append(issues,'original_due_date_invalid');end if;
 select coalesce(jsonb_agg(distinct x->'document_id' order by x->'document_id'),'[]') into docs
 from jsonb_array_elements(case when jsonb_typeof(c->'source_snapshot'->'documents')='array' then c->'source_snapshot'->'documents' else '[]' end)x where finance_private.package_uuid(x->>'document_id') is not null;
 if kind='charge' then
  event_id:=(c->>'id')::uuid;day:=finance_private.package_day(c->>'occurred_on');cents:=finance_private.package_cents(c->>'amount_cents');
 else
  event_id:=coalesce((r->>'id')::uuid,(p->>'id')::uuid);command_uuid:=coalesce((r->>'financial_command_id')::uuid,(p->>'financial_command_id')::uuid);
  begin day:=((case when kind='refund' then r->>'effective_at' else p->>'received_at' end)::timestamptz at time zone 'America/Sao_Paulo')::date;if not isfinite(day) then day:=null;end if;
  exception when invalid_datetime_format or datetime_field_overflow then day:=null;end;
  raw_amount:=coalesce(r->>'amount',p->>'amount');
  if raw_amount ~ '^[0-9]+(\.[0-9]+)?$' and length(raw_amount)<=100 then
   if raw_amount::numeric*100=trunc(raw_amount::numeric*100) then cents:=trunc(raw_amount::numeric*100);end if;
  end if;
  select * into fc from public.receivable_financial_commands x where x.tenant_id=_tenant and x.id=(p->>'financial_command_id')::uuid;
  receipt_origin:=finance_private.unloading_flow_receipt_origin(_tenant,(c->>'id')::uuid,fc.before_snapshot->'unloading_origin');
  if receipt_origin->>'verified' is distinct from 'true' then issues:=array_append(issues,'receipt_origin_version_unverified');
  else claim_supplier:=receipt_origin#>>'{effective,supplier_id}';claim_name:=receipt_origin#>>'{effective,supplier_name}';claim_cents:=receipt_origin#>>'{effective,amount_cents}';end if;
  if fc.id is null or fc.action<>'receive' or fc.receivable_id::text<>c->>'receivable_id'
   or fc.response->>'payment_id' is distinct from p->>'id'
   or fc.before_snapshot->'evidence'->'receivable'->>'client_id' is distinct from claim_supplier
   or not coalesce(fc.before_snapshot->'evidence'->'receivable'->>'amount' ~ '^[0-9]+(\.[0-9]+)?$',false)
   or length(fc.before_snapshot->'evidence'->'receivable'->>'amount')>100 then
   issues:=array_append(issues,'receipt_supplier_proof_missing');
  end if;
  if fc.before_snapshot->'evidence'->'receivable'->>'amount' ~ '^[0-9]+(\.[0-9]+)?$' and length(fc.before_snapshot->'evidence'->'receivable'->>'amount')<=100 then
   if (fc.before_snapshot->'evidence'->'receivable'->>'amount')::numeric*100 is distinct from claim_cents::numeric then issues:=array_append(issues,'receipt_original_amount_mismatch');end if;
  end if;
  if kind='refund' then
   select * into refund_command from public.receivable_financial_commands x where x.tenant_id=_tenant and x.id=command_uuid;
   if refund_command.id is null or refund_command.action<>'reverse' or refund_command.receivable_id::text<>c->>'receivable_id'
    or refund_command.response->>'payment_id' is distinct from p->>'id' or refund_command.response->>'reversal_id' is distinct from r->>'id'
    or refund_command.response->>'refund_kind' is distinct from 'money_returned'
    or r->>'receivable_id' is distinct from c->>'receivable_id' then issues:=array_append(issues,'refund_command_mismatch');end if;
  end if;
  select count(*) into n from public.finance_receivable_movement_links x where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid and x.action=case when kind='refund' then 'reverse' else 'receive' end and x.command_id=command_uuid;
  select * into link from public.finance_receivable_movement_links x where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid and x.action=case when kind='refund' then 'reverse' else 'receive' end and x.command_id=command_uuid order by x.command_id limit 1;
  if n<>1 then issues:=array_append(issues,'canonical_movement_link_missing');end if;
  select * into tx from public.bank_transactions x where x.tenant_id=_tenant and x.id=coalesce((r->>'bank_transaction_id')::uuid,(p->>'bank_transaction_id')::uuid);
  account:=case when kind='refund' then tx.bank_account_id else (p->>'bank_account_id')::uuid end;
  select * into m from public.finance_movements x where x.tenant_id=_tenant and x.id=link.movement_id;
  if m.id is null or link.bank_transaction_id is distinct from tx.id or m.bank_account_id is distinct from account or m.occurred_on is distinct from day
   or m.direction is distinct from (case when kind='refund' then 'out' else 'in' end) or m.nature is null or (kind='refund' and m.nature<>'refund') or (kind='receipt' and m.nature not in('receipt','customer_advance','other')) or m.amount_cents<cents
   or tx.amount*100 is distinct from cents or tx.transaction_type is distinct from (case when kind='refund' then 'debit' else 'credit' end)
   or (tx.posted_at at time zone 'America/Sao_Paulo')::date is distinct from day then issues:=array_append(issues,'receipt_movement_mismatch');end if;
  if not exists(select 1 from public.bank_accounts a where a.tenant_id=_tenant and a.id=account) then issues:=array_append(issues,'receipt_account_unknown');end if;
  if exists(select 1 from public.finance_movement_voids v where v.tenant_id=_tenant and v.movement_id=m.id) then issues:=array_append(issues,'source_movement_voided');end if;
  select coalesce(jsonb_agg(x.data order by x.data->>'kind',x.data->>'id'),'[]') into sidecars from(
   select jsonb_build_object('kind','allocation_correction','id',x.id,'recorded_at',x.created_at,'actor_id',x.actor_id) data from public.finance_receipt_allocation_corrections x where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid
   union all select jsonb_build_object('kind','customer_credit','id',x.id,'recorded_at',x.created_at,'actor_id',x.created_by) from public.finance_customer_credits x where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid
   union all select jsonb_build_object('kind','legacy_association','id',x.id,'recorded_at',x.created_at,'actor_id',x.created_by) from public.finance_legacy_receipt_movement_links x where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid
   union all select jsonb_build_object('kind','association_reversal','id',v.id,'recorded_at',v.created_at,'actor_id',v.created_by) from public.finance_legacy_receipt_link_reversals v join public.finance_legacy_receipt_movement_links x on x.tenant_id=v.tenant_id and x.id=v.link_id where x.tenant_id=_tenant and x.payment_id=(p->>'id')::uuid
  )x;
  if jsonb_array_length(sidecars)>0 then issues:=array_append(issues,'receipt_allocation_requires_review');end if;
  -- Full capacity includes freight and other suppliers. Refunds do not free
  -- incoming money; allocation corrections do. Preserve all claims in proof.
  select coalesce(sum(x.amount),0),coalesce(bool_and(x.amount is not null and x.amount>0 and x.amount::text not in('NaN','Infinity','-Infinity') and x.amount=trunc(x.amount)),true) and count(*)=count(distinct x.payment_id),jsonb_build_object('claims_hash',md5(coalesce(string_agg(md5(x.proof::text),'' order by x.payment_id,x.proof::text),'')))
  into used,claims_valid,proof from(
   select l.payment_id,pp.amount*100 amount,jsonb_build_object('link',to_jsonb(l),'payment',to_jsonb(pp),'credit',(select to_jsonb(cr) from public.finance_customer_credits cr where cr.tenant_id=l.tenant_id and cr.payment_id=l.payment_id)) proof from public.finance_receivable_movement_links l left join public.receivables_payments pp on pp.tenant_id=l.tenant_id and pp.id=l.payment_id
    where l.tenant_id=_tenant and l.movement_id=m.id and l.action=case when kind='refund' then 'reverse' else 'receive' end
    and not exists(select 1 from public.finance_receipt_allocation_corrections z where z.tenant_id=l.tenant_id and z.payment_id=l.payment_id)
   union all select l.payment_id,l.amount_cents,jsonb_build_object('legacy',to_jsonb(l)) from public.finance_legacy_receipt_movement_links l where kind='receipt' and l.tenant_id=_tenant and l.movement_id=m.id and not exists(select 1 from public.finance_legacy_receipt_link_reversals z where z.tenant_id=l.tenant_id and z.link_id=l.id)
  )x;
  if not claims_valid or used>m.amount_cents then issues:=array_append(issues,'movement_capacity_conflict');end if;
 end if;
 if day is null then issues:=array_append(issues,'economic_date_unknown');end if;
 if cents is null or cents<=0 then issues:=array_append(issues,'amount_invalid');cents:=null;end if;
 return jsonb_build_object('event_id',event_id,'kind',kind,'charge_id',c->'id','receivable_id',c->'receivable_id','supplier_id',claim_supplier,'supplier_name',claim_name,'delivery_stop_id',c->'delivery_stop_id',
  'economic_on',day,'recorded_at',coalesce(r->>'created_at',p->>'created_at',c->>'created_at'),'amount_cents',cents::text,'valid',cardinality(issues)=0,'issues',to_jsonb(issues),
  'original_due_date',due,'original_command_id',cmd.request_id,'receipt_path',c->>'receipt_path','document_ids',docs,'payment_id',p->'id','reversal_id',r->'id','command_id',command_uuid,
  'movement_id',m.id,'bank_account_id',account,'money_covered',false,'closure_ids','[]'::jsonb,'sidecars',sidecars,
  'amendment_id',null,'adjustment_leg',null,'amendment_actor_id',null,'amendment_actor_name',null,'amendment_reason',null,
  '_proof',jsonb_build_object('receipt_origin',receipt_origin,'charge',c,'payment',p,'refund',r,'origin_command',to_jsonb(cmd),'receipt_command',to_jsonb(fc),'refund_command',to_jsonb(refund_command),'link',to_jsonb(link),'movement',to_jsonb(m),'transaction',to_jsonb(tx),'global_claims',proof));
end$$;

create or replace function finance_private.period_unloading_flow(_tenant uuid,_from date,_to date,_accounts uuid[],_supplier uuid,_page integer,_expected_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare money jsonb;events jsonb:='[]';event_list jsonb[]:='{}';event jsonb;source record;account_proofs jsonb:='{}';account uuid;ap jsonb;mid uuid;refs jsonb;groups jsonb;options jsonb;links jsonb;revision text;page_rows jsonb;total bigint;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 then raise exception 'finance_invalid_history_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_history_revision_required' using errcode='22023';end if;
 money:=finance_private.period_money_package(_tenant,_from,_to,_accounts);
 foreach account in array _accounts loop account_proofs:=account_proofs||jsonb_build_object(account::text,finance_private.period_money_account(_tenant,account,_from,_to));end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by id),'[]') into options from(
  select id,min(name) name from (select c.supplier_id id,c.source_snapshot->>'supplier_name' name from public.finance_unloading_charges c where c.tenant_id=_tenant
  union all select (s->>'supplier_id')::uuid,s->>'supplier_name' from finance_private.unloading_origin_amendments a cross join lateral (values(a.before_state),(a.after_state)) states(s) where a.tenant_id=_tenant)all_sources group by id
 )s;
 if _supplier is not null and not exists(select 1 from jsonb_array_elements(options)x where x->>'id'=_supplier::text) then raise exception 'finance_unloading_supplier_not_found' using errcode='22023';end if;
 for source in
  select to_jsonb(c) c,null::jsonb p,null::jsonb r from public.finance_unloading_charges c where c.tenant_id=_tenant
   and (c.occurred_on is null or not isfinite(c.occurred_on) or c.occurred_on between _from and _to)
  union all select to_jsonb(c),to_jsonb(p),null::jsonb from public.finance_unloading_charges c join public.receivables_payments p on p.tenant_id=c.tenant_id and p.receivable_id=c.receivable_id where c.tenant_id=_tenant
   and (p.received_at is null or not isfinite(p.received_at) or (p.received_at>=(_from::timestamp at time zone 'America/Sao_Paulo') and p.received_at<((_to+1)::timestamp at time zone 'America/Sao_Paulo')))
  union all select to_jsonb(c),to_jsonb(p),to_jsonb(r) from public.finance_unloading_charges c join public.receivables_payments p on p.tenant_id=c.tenant_id and p.receivable_id=c.receivable_id join public.receivable_payment_reversals r on r.tenant_id=p.tenant_id and r.payment_id=p.id where c.tenant_id=_tenant
   and (r.effective_at is null or not isfinite(r.effective_at) or (r.effective_at>=(_from::timestamp at time zone 'America/Sao_Paulo') and r.effective_at<((_to+1)::timestamp at time zone 'America/Sao_Paulo')))
 loop
  event:=finance_private.unloading_flow_event(_tenant,source.c,source.p,source.r);
  if _supplier is not null and event->>'supplier_id'<>_supplier::text then continue;end if;
  if event->>'economic_on' is not null and (event->>'economic_on')::date not between _from and _to then continue;end if;
  if event->>'kind'<>'charge' and event->>'bank_account_id' is not null and not (event->>'bank_account_id')::uuid=any(_accounts)
   and not (event->'issues' ? 'receipt_account_unknown') then continue;end if;
  mid:=(event->>'movement_id')::uuid;refs:='[]';ap:=account_proofs->(event->>'bank_account_id');
  if mid is not null and coalesce((ap->>'coverage_complete')::boolean,false) then
   select coalesce(jsonb_agg(c.id order by c.id),'[]') into refs from public.finance_account_period_closures c
   where c.tenant_id=_tenant and c.account_id=(event->>'bank_account_id')::uuid and c.period_start>=_from and c.period_end<=_to
    and not exists(select 1 from public.finance_account_period_reopenings ro where ro.tenant_id=c.tenant_id and ro.closure_id=c.id)
    and exists(select 1 from jsonb_array_elements(c.snapshot#>'{facts,movements}')x where x->>'id'=mid::text
     and x->>'tenant_id'=_tenant::text and x->>'bank_account_id'=event->>'bank_account_id' and x->>'occurred_on'=event->>'economic_on'
     and x->>'direction'=event#>>'{_proof,movement,direction}' and x->>'nature'=event#>>'{_proof,movement,nature}'
     and finance_private.package_cents(x->>'amount_cents')=finance_private.package_cents(event#>>'{_proof,movement,amount_cents}'));
  end if;
  event:=(event-'_proof')||jsonb_build_object('money_covered',jsonb_array_length(refs)>0,'closure_ids',refs,
   '_proof_hash',md5((event->'_proof')::text),'_movement_amount',event#>>'{_proof,movement,amount_cents}');
  event_list:=array_append(event_list,event);
 end loop;
 for event in select x from finance_private.unloading_adjustment_events(_tenant,_from,_to)x loop
  if _supplier is null or event->>'supplier_id'=_supplier::text then event_list:=array_append(event_list,event);end if;
 end loop;
 events:=to_jsonb(event_list);
 select md5(jsonb_build_object('tenant_id',_tenant,'from',_from,'to',_to,'accounts',money->'account_scope','supplier',_supplier,'options',options,'money_revision',money->'revision',
  'events_hash',md5(coalesce(string_agg(md5(x::text),'' order by x->>'kind',x->>'event_id',x->>'adjustment_leg'),'')))::text),count(*) into revision,total from jsonb_array_elements(events)x;
 if _expected_revision is not null and _expected_revision is distinct from revision then raise exception 'finance_history_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('supplier_id',id,'supplier_name',name,'origin_totals',finance_private.unloading_flow_total(events,'charge',id),
  'receipt_totals',finance_private.unloading_flow_total(events,'receipt',id),'refund_totals',finance_private.unloading_flow_total(events,'refund',id),'adjustment_totals',finance_private.unloading_flow_total(events,'adjustment',id),'net_origin_totals',finance_private.unloading_flow_net_total(events,id)) order by id),'[]') into groups
 from(select (x->>'supplier_id')::uuid id,min(x->>'supplier_name') name from jsonb_array_elements(events)x group by x->>'supplier_id')g;
 select coalesce(jsonb_agg(x-'_proof_hash'-'_movement_amount' order by x->>'economic_on' desc nulls first,x->>'kind',x->>'event_id',x->>'adjustment_leg'),'[]') into page_rows
 from(select x from jsonb_array_elements(events)x order by x->>'economic_on' desc nulls first,x->>'kind',x->>'event_id',x->>'adjustment_leg' limit 50 offset ((_page::bigint-1)*50))s;
 select coalesce(jsonb_agg(jsonb_build_object('movement_id',id,'bank_account_id',account_id,'amount_cents',amount,
  'allocated_event_cents',case when valid then allocated::text end,'money_covered',covered,'closure_ids',closures,'event_ids',ids,'issues',case when valid then '[]'::jsonb else '["allocation_classification_incomplete"]'::jsonb end) order by id),'[]') into links from(
  select x->>'movement_id' id,min(x->>'bank_account_id') account_id,min(x->>'_movement_amount') amount,bool_and((x->>'valid')::boolean) valid,sum((x->>'amount_cents')::numeric) allocated,
   bool_and((x->>'money_covered')::boolean) covered,(jsonb_agg(x->'closure_ids')->0) closures,jsonb_agg(x->'event_id' order by x->>'event_id') ids
  from jsonb_array_elements(events)x where x->>'movement_id' is not null and (x->>'bank_account_id')::uuid=any(_accounts) group by x->>'movement_id'
 )g;
 return jsonb_build_object('version',2,'tenant_id',_tenant,'period',jsonb_build_object('from',_from,'to',_to),'currency','BRL','timezone','America/Sao_Paulo',
  'basis','economic_event_dates','evidence_basis','currently_available_immutable_records','not_a_position',true,'captured_at',statement_timestamp(),'revision',revision,'money_package_revision',money->'revision',
  'supplier_id',_supplier,'supplier_options',options,'account_scope',(money->'account_scope')-'available','page',_page,'page_size',50,'total',total,
  'unknown_date_count',(select count(*) from jsonb_array_elements(events)x where x->>'economic_on' is null),'origin_totals',finance_private.unloading_flow_total(events,'charge'),
  'receipt_totals',finance_private.unloading_flow_total(events,'receipt'),'refund_totals',finance_private.unloading_flow_total(events,'refund'),'adjustment_totals',finance_private.unloading_flow_total(events,'adjustment'),'net_origin_totals',finance_private.unloading_flow_net_total(events),'supplier_groups',groups,'rows',page_rows,'money_links',links,
  'issues',case when exists(select 1 from jsonb_array_elements(events)x where not (x->>'valid')::boolean) then '["economic_event_review_required"]'::jsonb else '[]'::jsonb end,
  'limitations',jsonb_build_array('not_a_receivable_position','origin_scope_is_company_not_selected_accounts','receipt_and_refund_scope_is_selected_accounts','immutable_evidence_available_now_not_past_knowledge','original_due_date_not_current_terms','money_and_allocations_are_not_added','legacy_associations_require_review'));
end$$;


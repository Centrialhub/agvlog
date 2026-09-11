create function finance_private.unloading_repair_cents(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare raw text:=v#>>'{}';n numeric;begin
 if raw is null or length(raw)>100 or raw!~'^[0-9]+([.][0-9]+)?$' then return null;end if;
 n:=raw::numeric*100;if trunc(n)<>n then return null;end if;return trunc(n)::text;
end $$;
revoke all on function finance_private.unloading_repair_cents(jsonb) from public,anon,authenticated,service_role;
create table public.finance_unloading_projection_repairs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,charge_id uuid not null references public.finance_unloading_charges(id),
 receivable_id uuid not null,request_id uuid not null,revision text not null,source_snapshot jsonb not null,
 before_data jsonb not null,after_data jsonb not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id)
);
alter table public.finance_unloading_projection_repairs enable row level security;
revoke all on public.finance_unloading_projection_repairs from public,anon,authenticated,service_role;
create policy unloading_repair_read on public.finance_unloading_projection_repairs for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_unloading_repair before update or delete on public.finance_unloading_projection_repairs for each row execute function finance_private.preserve_event();
create table finance_private.unloading_repair_tickets(
 transaction_id bigint not null,tenant_id uuid not null,charge_id uuid not null,receivable_id uuid not null,request_id uuid not null,
 actor_id uuid not null,revision text not null,before_data jsonb not null,after_data jsonb not null,
 primary key(transaction_id,tenant_id,receivable_id)
);
revoke all on finance_private.unloading_repair_tickets from public,anon,authenticated,service_role;

create function finance_private.can_repair_unloading(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select finance_private.can_access(_tenant) and exists(select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active and role::text in('owner','admin'))
$$;
revoke all on function finance_private.can_repair_unloading(uuid) from public,anon,authenticated,service_role;

create function finance_private.unloading_projection_repair_context(_tenant uuid,_charge uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.finance_unloading_charges%rowtype;r public.receivables%rowtype;cmd public.finance_commands%rowtype;
 commands jsonb;events jsonb;history jsonb;deps jsonb:='[]';blockers jsonb:='[]';evidence jsonb;result jsonb;proof boolean;rows jsonb;row_data jsonb;tab text;blocked boolean;reason text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and id=_charge;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;
 select * into r from public.receivables where tenant_id=_tenant and id=c.receivable_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') into commands from public.finance_commands x where tenant_id=_tenant and action='record_unloading' and x.result->>'charge_id'=c.id::text;
 select x.* into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c.id::text order by x.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into events from public.finance_events x where tenant_id=_tenant and entity_type='unloading' and entity_id=c.id and action='recorded';
 proof:=jsonb_array_length(commands)=1 and jsonb_array_length(events)=1
  and cmd.payload->>'tenant_id'=c.tenant_id::text and cmd.result->>'tenant_id'=c.tenant_id::text
  and cmd.actor_id=c.created_by and cmd.result->>'receivable_id'=c.receivable_id::text and cmd.result->>'supplier_id'=c.supplier_id::text
  and cmd.payload->>'amount_cents'=c.amount_cents::text and cmd.payload->>'occurred_on'=c.occurred_on::text
  and cmd.payload->>'receipt_path'=c.receipt_path and cmd.payload->>'stop_id'=c.recorded_stop_id::text
  and cmd.payload->>'expected_revision'=c.source_snapshot->>'revision'
  and c.source_snapshot->>'supplier_id'=c.supplier_id::text and c.source_snapshot->>'delivery_stop_id'=c.delivery_stop_id::text
  and events#>'{0,after_data,context}'=c.source_snapshot
  and events#>>'{0,actor_id}'=c.created_by::text and events#>>'{0,after_data,receivable_id}'=c.receivable_id::text
  and events#>>'{0,after_data,amount_cents}'=c.amount_cents::text
  and exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id);
 if proof is distinct from true then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_unverified','source_table','finance_unloading_charges','source_ids',jsonb_build_array(c.id)));end if;
 if r.id is null or r.status is distinct from 'pending' or coalesce(r.received_amount,0)<>0 or r.client_invoice_id is not null or r.closing_report_id is not null or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_state_requires_resolution','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));
 end if;
 if r.client_id is not distinct from c.supplier_id and r.amount*100 is not distinct from c.amount_cents::numeric then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_already_matches','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));end if;
 evidence:=jsonb_build_object('charge',to_jsonb(c),'receivable',to_jsonb(r),'commands',commands,'events',events);
 foreach tab in array array['receivables_payments','receivable_financial_commands','finance_customer_credits','finance_receivable_movement_links','finance_legacy_receipt_movement_links','finance_fiscal_receivable_origins','finance_expense_items','financial_obligations','payables','driver_settlement_items','payroll_entry_items','finance_account_period_dependencies','client_invoices','closing_reports'] loop
  if to_regclass('public.'||tab) is null then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_dependency_reader_missing','source_table',tab,'source_ids','[]'::jsonb));continue;
  end if;
  execute format($q$select coalesce(jsonb_agg(j order by j::text),'[]') from (select to_jsonb(x) j from public.%I x where tenant_id=$1) d
   where j->>'receivable_id'=$2 or j->>'unloading_id'=$3 or (j->>'source_table'='receivables' and j->>'source_id'=$2)
    or (j->>'source_kind'='receivables' and j->>'source_id'=$2)
    or j#>>'{metadata,receivable_id}'=$2
    or ($4 in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and exists(select 1 from public.finance_expense_items e where e.tenant_id=$1 and e.unloading_id=$3::uuid and (
     ($4='payables' and j->>'id'=e.payable_id::text) or (j->>'source_table'='finance_expense_items' and j->>'source_id'=e.id::text) or (j->>'source_table'='payables' and j->>'source_id'=e.payable_id::text))))$q$,tab) into rows using _tenant,c.receivable_id::text,c.id::text,tab;
  evidence:=evidence||jsonb_build_object(tab,rows);
  for row_data in select value from jsonb_array_elements(rows) loop
   blocked:=tab<>'finance_expense_items';
   if tab in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and row_data->>'receivable_id' is distinct from c.receivable_id::text and row_data#>>'{metadata,receivable_id}' is distinct from c.receivable_id::text and not(coalesce(row_data->>'source_table','')='receivables' and row_data->>'source_id'=c.receivable_id::text) then blocked:=false;end if;
   reason:=case when blocked then 'unloading_financial_history_requires_resolution' else 'unchanged_canonical_cost' end;
   if tab='finance_account_period_dependencies' and exists(select 1 from public.finance_account_period_reopenings where tenant_id=_tenant and closure_id=(row_data->>'closure_id')::uuid) then blocked:=false;reason:='reopened_period_history';end if;
   if tab='finance_expense_items' and row_data->>'amount_cents' is distinct from c.amount_cents::text then blocked:=true;reason:='unloading_cost_origin_mismatch';end if;
   deps:=deps||jsonb_build_array(jsonb_build_object('source_table',tab,'source_id',coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'),'blocking',blocked,'reason',reason));
   if blocked then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',reason,'source_table',tab,'source_ids',jsonb_build_array(coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'))));end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,
 'before',jsonb_build_object('client_id',x.before_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.before_data->'amount')),
 'after',jsonb_build_object('client_id',x.after_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.after_data->'amount'))) order by created_at,id),'[]') into history from public.finance_unloading_projection_repairs x where tenant_id=_tenant and charge_id=_charge;
 evidence:=evidence||jsonb_build_object('history',history);
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'charge_id',_charge,'receivable_id',c.receivable_id,'origin_verified',coalesce(proof,false),
  'original',jsonb_build_object('supplier_id',c.supplier_id,'supplier_name',c.source_snapshot->>'supplier_name','amount_cents',c.amount_cents::text,'delivery_stop_id',c.delivery_stop_id),
  'current',jsonb_build_object('receivable_id',c.receivable_id,'client_id',r.client_id,'amount_cents',finance_private.unloading_repair_cents(to_jsonb(r)->'amount'),'status',r.status),
  'target',jsonb_build_object('client_id',c.supplier_id,'amount_cents',c.amount_cents::text),'dependencies',deps,'blockers',blockers,
  'eligible',jsonb_array_length(blockers)=0,'can_repair',finance_private.can_repair_unloading(_tenant),'can_execute',false,'history',history,
  'effects',jsonb_build_object('cash_changed',false,'charge_changed',false,'cost_changed',false),'_evidence',evidence);
 return result||jsonb_build_object('revision',md5(result::text));
end $$;
revoke all on function finance_private.unloading_projection_repair_context(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.consume_unloading_repair_ticket(_before jsonb,_after jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare ticket finance_private.unloading_repair_tickets%rowtype;context jsonb;begin
 if not finance_private.can_repair_unloading((_before->>'tenant_id')::uuid) then return false;end if;
 select * into ticket from finance_private.unloading_repair_tickets where transaction_id=txid_current() and tenant_id=(_before->>'tenant_id')::uuid and receivable_id=(_before->>'id')::uuid and actor_id=auth.uid() and before_data=_before and after_data=_after;
 if not found then return false;end if;
 context:=finance_private.unloading_projection_repair_context(ticket.tenant_id,ticket.charge_id);
 if context->>'revision' is distinct from ticket.revision or context->>'eligible' is distinct from 'true' then return false;end if;
 delete from finance_private.unloading_repair_tickets where transaction_id=ticket.transaction_id and tenant_id=ticket.tenant_id and receivable_id=ticket.receivable_id;
 return true;
end $$;
revoke all on function finance_private.consume_unloading_repair_ticket(jsonb,jsonb) from public,anon,authenticated,service_role;
do $patch$
declare body text;needle text:=$needle$or to_jsonb(new)->'cte_document_id' is distinct from to_jsonb(old)->'cte_document_id' then
   raise exception 'finance_unloading_source_immutable' using errcode='55000';$needle$;
begin
 body:=pg_get_functiondef('finance_private.guard_unloading_receivable_source()'::regprocedure);
 if position(needle in body)=0 then raise exception 'unloading_source_guard_contract_changed';end if;
 execute replace(body,needle,$new$or to_jsonb(new)->'cte_document_id' is distinct from to_jsonb(old)->'cte_document_id' then
   if not finance_private.consume_unloading_repair_ticket(to_jsonb(old),to_jsonb(new)) then
    raise exception 'finance_unloading_source_immutable' using errcode='55000';end if;$new$);
end $patch$;
create function finance_private.repair_unloading_projection(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;req uuid;charge uuid;actor uuid:=auth.uid();context jsonb;before_row jsonb;after_row jsonb;c public.finance_unloading_charges%rowtype;existing public.finance_commands%rowtype;repair uuid;result jsonb;actor_name text;begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->>'version' is distinct from '1' or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','charge_id','revision','reason')) or length(btrim(coalesce(_payload->>'reason',''))) not between 10 and 2000 then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;charge:=(_payload->>'charge_id')::uuid;
 if t is null or req is null or charge is null or nullif(_payload->>'revision','') is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;
 if found then if existing.actor_id is distinct from actor or existing.action<>'repair_unloading_projection' or existing.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 select * into c from public.finance_unloading_charges where tenant_id=t and id=charge for update;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;
 perform public._lock_receivable_financial_graph(t,c.receivable_id);
 perform 1 from public.clients where tenant_id=t and id=c.supplier_id for share nowait;
 select to_jsonb(r) into before_row from public.receivables r where tenant_id=t and id=c.receivable_id for update;
 context:=finance_private.unloading_projection_repair_context(t,charge);
 if context->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_unloading_repair_changed' using errcode='40001';end if;
 if context->>'eligible' is distinct from 'true' then raise exception 'finance_unloading_repair_blocked' using errcode='55000';end if;
 after_row:=to_jsonb(jsonb_populate_record(null::public.receivables,before_row||jsonb_build_object('client_id',c.supplier_id,'amount',c.amount_cents::numeric/100,'updated_by',actor,'updated_at',clock_timestamp())));
 if to_regprocedure('finance_private.assert_closed_source_mutable(uuid,text,jsonb,integer)') is null then raise exception 'finance_unloading_repair_guard_missing' using errcode='55000';end if;
 perform finance_private.assert_closed_source_mutable(t,'receivables',before_row,0);
 perform finance_private.assert_closed_source_mutable(t,'receivables',after_row,0);
 insert into finance_private.unloading_repair_tickets values(txid_current(),t,charge,c.receivable_id,req,actor,context->>'revision',before_row,after_row);
 update public.receivables set client_id=c.supplier_id,amount=c.amount_cents::numeric/100,updated_by=actor,updated_at=(after_row->>'updated_at')::timestamptz where tenant_id=t and id=c.receivable_id;
 if exists(select 1 from finance_private.unloading_repair_tickets where transaction_id=txid_current() and tenant_id=t and receivable_id=c.receivable_id) then raise exception 'finance_unloading_repair_ticket_not_consumed' using errcode='55000';end if;
 select to_jsonb(r) into after_row from public.receivables r where tenant_id=t and id=c.receivable_id;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 actor_name:=coalesce(actor_name,actor::text);
 insert into public.finance_unloading_projection_repairs(tenant_id,charge_id,receivable_id,request_id,revision,source_snapshot,before_data,after_data,actor_id,actor_name,reason)
 values(t,charge,c.receivable_id,req,context->>'revision',context,before_row,after_row,actor,actor_name,btrim(_payload->>'reason')) returning id into repair;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'unloading',charge,'unloading_projection_repaired',actor,actor_name,btrim(_payload->>'reason'),before_row,after_row||jsonb_build_object('repair_id',repair));
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'receivable_id',c.receivable_id,'repair_id',repair,'confirmed',true,'cash_changed',false,'charge_changed',false,'cost_changed',false);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'repair_unloading_projection',_payload,result);
 return result;
end $$;
revoke all on function finance_private.repair_unloading_projection(jsonb) from public,anon,authenticated,service_role;
-- Audit filtering must retain this intervention permanently.
do $audit$
declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 body:=pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure);
 if position(needle in body)=0 then raise exception 'unloading_repair_audit_contract_changed';end if;
 execute replace(body,needle,'''unloading_projection_repaired'','||needle);
end $audit$;

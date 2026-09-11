-- Resolve remaining cost/obligation after a separately audited cancellation of the same collection right.
do $$declare p record;begin select * into p from pg_proc where oid='finance_private.coordinated_unloading_cancellation_context(uuid,uuid,date)'::regprocedure;
 if md5(p.prosrc) is distinct from '4974e749c5126654fcbaa84280091d38' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner) then raise exception 'unloading_cancelled_claim_predecessor_changed:coordinated_unloading_cancellation_context' using errcode='55000';end if;end$$;
do $$declare p record;begin select * into p from pg_proc where oid='finance_private.cancel_unloading_coordinated(jsonb)'::regprocedure;
 if md5(p.prosrc) is distinct from '1dfcdaece83361b70ab95e7e91d2ddc8' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner) then raise exception 'unloading_cancelled_claim_predecessor_changed:cancel_unloading_coordinated' using errcode='55000';end if;end$$;
create function finance_private.unloading_cancelled_claim_link(t uuid,charge uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin jsonb;last_event jsonb;r public.receivables%rowtype;valid boolean;
begin
 perform finance_private.require_access(t);origin:=finance_private.unloading_effective_origin(t,charge);
 last_event:=origin->'history'->-1;
 select * into r from public.receivables where tenant_id=t and id=(origin->>'receivable_id')::uuid;
 valid:=origin->>'verified'='true' and origin#>>'{effective,status}'='cancelled' and last_event->>'operation'='cancel_origin'
 and last_event->'after'=origin->'effective' and r.id is not null and r.status='cancelled'
 and r.client_id::text=last_event#>>'{after,supplier_id}' and finance_private.unloading_repair_cents(to_jsonb(r)->'amount')=last_event#>>'{before,amount_cents}'
 and coalesce(r.received_amount,0)=0 and r.client_invoice_id is null and r.closing_report_id is null and to_jsonb(r)->>'fiscal_document_id' is null and to_jsonb(r)->>'cte_document_id' is null;
 return jsonb_build_object('verified',coalesce(valid,false),'amendment_id',last_event->'id','receivable_id',origin->'receivable_id','revision',origin->'revision','issue',case when coalesce(valid,false) then null else 'unloading_prior_cancellation_unverified' end);
end$$;
revoke all on function finance_private.unloading_cancelled_claim_link(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function finance_private.coordinated_unloading_cancellation_context(t uuid,charge uuid,effective_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin jsonb;right_context jsonb;cost_context jsonb;e public.finance_expense_items%rowtype;blockers jsonb:='[]';materializations jsonb;history jsonb;result jsonb;count_cost integer;prior_claim jsonb;
begin
 perform finance_private.require_access(t);
 origin:=finance_private.unloading_effective_origin(t,charge);
 right_context:=finance_private.unloading_origin_correction_context(t,charge,jsonb_build_object('operation','cancel_origin','effective_on',effective_day,'collection_right_only',true));
 blockers:=right_context->'blockers';
 if origin#>>'{effective,status}'='cancelled' then
  prior_claim:=finance_private.unloading_cancelled_claim_link(t,charge);
  if prior_claim->>'verified'='true' then
   -- Only the state/nominal checks made obsolete by the proven cancellation are removed.
   -- Financial history, fiscal links, date and closed-period blockers remain untouched.
   select coalesce(jsonb_agg(x),'[]') into blockers from jsonb_array_elements(blockers)x where x->>'code' not in('unloading_origin_not_active','unloading_projection_requires_repair','unloading_projection_state_requires_resolution');
  else blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_prior_cancellation_unverified','source_table','receivables','source_ids',jsonb_build_array(origin->'receivable_id')));end if;
 end if;
 select count(*) into count_cost from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 select * into e from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 if count_cost<>1 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_unique_cost_required','source_table','finance_expense_items','source_ids','[]'::jsonb));
 else
  cost_context:=finance_private.unloading_cost_cancellation_context(t,e.id);
  if cost_context->>'eligible' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',cost_context->>'issue','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into materializations from public.driver_settlement_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id) or (x.source_table='payables' and x.source_id=e.payable_id));
 if jsonb_array_length(materializations)>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_cost_materialized','source_table','driver_settlement_items','source_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(materializations)x)));end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',x.after_data->'request_id','actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'expense_cancellation_id',x.after_data->'expense_cancellation_id','origin_amendment_id',x.after_data->'origin_amendment_id') order by x.created_at,x.id),'[]') into history from public.finance_events x where x.tenant_id=t and x.entity_id=charge and x.action='unloading_cancelled_coordinated';
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'expense_id',e.id,'payable_id',e.payable_id,'effective_on',effective_day,'origin',origin,
 'cost',case when e.id is not null then jsonb_build_object('amount_cents',e.amount_cents::text,'payable_cents',cost_context#>'{effects,obligation_cancelled_cents}','beneficiary_id',cost_context#>'{snapshot,payable,supplier_id}','beneficiary_name',cost_context#>'{snapshot,payable,supplier_name}','payee_type',cost_context#>'{snapshot,origin_items,0,item,payee_type}') end,
 'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_cancel',finance_private.can_repair_unloading(t),'can_execute',false,'history',history,
 'effects',jsonb_build_object('computation','prospective_coordinated_cancellation','cash_changed',false,'cost_removed_cents',e.amount_cents::text,'obligation_cancelled_cents',cost_context#>'{effects,obligation_cancelled_cents}','collection_cancelled_cents',origin#>'{effective,amount_cents}'),
 '_evidence',jsonb_build_object('prior_claim',prior_claim,'right',right_context,'cost',cost_context,'materializations',materializations));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
create or replace function finance_private.cancel_unloading_coordinated(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;req uuid;actor uuid:=auth.uid();context jsonb;existing public.finance_commands%rowtype;right_result jsonb;cost_result jsonb;child_payload jsonb;result jsonb;actor_name text;day date;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;req:=(payload->>'request_id')::uuid;day:=(payload->>'effective_on')::date;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or req is null or charge is null or day is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','request_id','charge_id','effective_on','revision','reason','prior_origin_amendment_id'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;
 if found then if existing.actor_id<>actor or existing.action<>'cancel_unloading_coordinated' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;
 perform 1 from public.dispatch_trips where tenant_id=t and id in(select b.trip_id from public.finance_expense_items e join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id where e.tenant_id=t and e.unloading_id=charge) order by id for update nowait;
 perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;
 perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and unloading_id=charge order by id for update nowait;
 perform 1 from public.payables p where p.tenant_id=t and exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.unloading_id=charge and (e.payable_id=p.id or p.source_table='finance_expense_items' and p.source_id=e.id)) order by p.id for update nowait;
 context:=finance_private.coordinated_unloading_cancellation_context(t,charge,day);
 if context->>'revision' is distinct from payload->>'revision' then raise exception 'unloading_cancellation_changed' using errcode='40001';end if;
 if context->>'eligible' is distinct from 'true' then raise exception 'unloading_cancellation_blocked' using errcode='55000';end if;
 if context#>>'{origin,effective,status}'='cancelled' then
  if context#>>'{_evidence,prior_claim,verified}' is distinct from 'true' or payload->>'prior_origin_amendment_id' is distinct from context#>>'{_evidence,prior_claim,amendment_id}' then raise exception 'unloading_prior_cancellation_changed' using errcode='40001';end if;
  -- The prior amendment is an explicit dependency, not a second cancellation.
  right_result:=jsonb_build_object('receivable_id',context#>'{_evidence,prior_claim,receivable_id}','amendment_id',context#>'{_evidence,prior_claim,amendment_id}');
 else
  if payload ? 'prior_origin_amendment_id' then raise exception 'unloading_prior_cancellation_not_applicable' using errcode='22023';end if;
 right_result:=finance_private.correct_unloading_origin(jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':origin')::uuid,'charge_id',charge,'revision',context#>'{_evidence,right,revision}','proposal',context#>'{_evidence,right,proposal}','reason',payload->>'reason'));
 end if;
 child_payload:=jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':cost')::uuid,'expense_id',context->'expense_id','revision',context#>'{_evidence,cost,revision}','reason',payload->>'reason');
 insert into finance_private.unloading_cost_cancellation_tickets values(txid_current(),t,actor,(child_payload->>'request_id')::uuid,charge,(context->>'expense_id')::uuid,child_payload);
 cost_result:=finance_private.cancel_unloading_cost(child_payload);
 if exists(select 1 from finance_private.unloading_cost_cancellation_tickets where transaction_id=txid_current() and tenant_id=t and request_id=(child_payload->>'request_id')::uuid) then raise exception 'unloading_cost_ticket_unconsumed';end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'receivable_id',right_result->'receivable_id','expense_id',context->'expense_id','payable_id',context->'payable_id','expense_cancellation_id',cost_result->'cancellation_id','origin_amendment_id',right_result->'amendment_id','confirmed',true,'cash_changed',false,'cost_removed_cents',context#>'{effects,cost_removed_cents}','obligation_cancelled_cents',context#>'{effects,obligation_cancelled_cents}','collection_cancelled_cents',context#>'{effects,collection_cancelled_cents}');
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'unloading',charge,'unloading_cancelled_coordinated',actor,actor_name,btrim(payload->>'reason'),context,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'cancel_unloading_coordinated',payload,result);
 return result;
exception when lock_not_available then raise exception 'unloading_cancellation_busy' using errcode='40001';
end$$;

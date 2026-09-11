-- Compatibility: corrections target delegated192908 ledger; preserve existing credit exclusion and historical snapshot.
create table public.finance_receipt_allocation_corrections(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,payment_id uuid not null,receivable_id uuid not null,movement_id uuid not null,
 request_id uuid not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,payment_id),unique(tenant_id,request_id),
 foreign key(tenant_id,payment_id) references public.receivables_payments(tenant_id,id),
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id),
 foreign key(tenant_id,movement_id) references public.finance_movements(tenant_id,id)
);
alter table public.finance_receipt_allocation_corrections enable row level security;
revoke all on public.finance_receipt_allocation_corrections from public,anon,authenticated,service_role;
grant select on public.finance_receipt_allocation_corrections to authenticated,service_role;
create policy finance_receipt_corrections_read on public.finance_receipt_allocation_corrections for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_receipt_corrections_immutable before update or delete on public.finance_receipt_allocation_corrections for each row execute function finance_private.preserve_event();

do $$declare signature text;body text;needle text;exclusion text;begin
 exclusion:=' and not exists(select 1 from public.finance_receipt_allocation_corrections correction where correction.tenant_id=p.tenant_id and correction.payment_id=p.id)';
 needle:='and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id)';
 foreach signature in array array['public._recalc_receivable_received()','public._guard_receivable_ledger()','public.apply_receivable_financial_command(jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into body;
  if position(needle in body)=0 then raise exception 'finance_correction_balance_contract_changed: %',signature;end if;
  body:=replace(body,needle,needle||exclusion);
  if signature='public.apply_receivable_financial_command(jsonb)' then
   body:=replace(body,' if exists(select 1 from public.receivable_payment_reversals where tenant_id=v_tenant and payment_id=v_payment_id)',
    ' if exists(select 1 from public.finance_receipt_allocation_corrections where tenant_id=v_tenant and payment_id=v_payment_id) then raise exception ''finance_receipt_allocation_already_corrected'' using errcode=''23514'';end if;
 if exists(select 1 from public.receivable_payment_reversals where tenant_id=v_tenant and payment_id=v_payment_id)');
  end if;
  execute body;
 end loop;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public._receivable_ledger_evidence(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='dc491a846bca5fd6392bf9386cdf5b0b' and not prosecdef and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) then raise exception 'finance_correction_delegated__receivable_ledger_evidence_changed';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public._receivable_financial_snapshot(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='857a4635e4b7dc465b4c52b165227931' and not prosecdef and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) then raise exception 'finance_correction_delegated__receivable_financial_snapshot_changed';end if;
 select pg_get_functiondef('public._receivable_ledger_evidence(uuid,uuid)'::regprocedure) into body;
 needle:='filter(where rv.id is null';if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_correction_delegated_sum_changed';end if;
 execute replace(body,needle,needle||exclusion);
 select pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure) into body;
 needle:='''reversed_at'',rv.created_at,''reversal_reason'',rv.reason';if position(needle in body)=0 then raise exception 'finance_correction_history_contract_changed';end if;
 body:=replace(body,needle,needle||',''allocation_correction'',(select jsonb_build_object(''id'',correction.id,''actor_name'',correction.actor_name,''actor_id'',correction.actor_id,''reason'',correction.reason,''created_at'',correction.created_at) from public.finance_receipt_allocation_corrections correction where correction.tenant_id=p.tenant_id and correction.payment_id=p.id)');
 execute body;
 foreach signature in array array['finance_private.project_receivable_command()','finance_private.receipt_movement_options(uuid,uuid,date,text,integer)'] loop
  select pg_get_functiondef(signature::regprocedure) into body;
  needle:='l.action=''receive''';if position(needle in body)=0 then raise exception 'finance_correction_capacity_contract_changed';end if;
  execute replace(body,needle,needle||exclusion);
 end loop;
 foreach signature in array array['finance_private.release_cancelled_receipts(uuid,uuid,uuid)','finance_private.process_fiscal_observation(uuid,uuid)'] loop
  if to_regprocedure(signature) is null then continue;end if;
  select pg_get_functiondef(signature::regprocedure) into body;
  needle:='and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id)';
  if position(needle in body)=0 then raise exception 'finance_correction_fiscal_contract_changed';end if;
  execute replace(body,needle,needle||exclusion);
 end loop;
end;$$;
create trigger finance_recalc_after_receipt_correction after insert on public.finance_receipt_allocation_corrections for each row execute function public._recalc_receivable_received();

create function finance_private.correct_receipt_allocation(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();request uuid;payment public.receivables_payments%rowtype;prior public.finance_commands%rowtype;
 movement uuid;before_data jsonb;after_data jsonb;correction uuid;actor_name text;reason text;result jsonb;credited boolean:=false;
begin
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;reason:=btrim(_payload->>'reason');
 if not finance_private.can_access(t) or not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _payload->>'version' is distinct from '1' or request is null or length(coalesce(reason,'')) not between 10 and 2000
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','payment_id','expected_revision','reason')) then raise exception 'finance_invalid_correction' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'receipt_allocation_corrected' or prior.payload<>_payload then raise exception 'finance_request_mismatch' using errcode='22023';end if;return prior.result;
 end if;
 select * into payment from public.receivables_payments where tenant_id=t and id=(_payload->>'payment_id')::uuid;
 if not found then raise exception 'finance_payment_not_found' using errcode='22023';end if;
 perform public._lock_receivable_financial_graph(t,payment.receivable_id);
 before_data:=public._receivable_financial_snapshot(t,payment.receivable_id);
 if before_data->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_correction_context_changed' using errcode='40001';end if;
 if not coalesce((before_data->>'can_reverse')::boolean,false) then raise exception 'finance_correction_state_unavailable' using errcode='23514';end if;
 if to_regclass('public.finance_customer_credits') is not null then
  execute 'select exists(select 1 from public.finance_customer_credits where tenant_id=$1 and payment_id=$2)' into credited using t,payment.id;
 end if;
 if credited or exists(select 1 from public.receivable_payment_reversals where tenant_id=t and payment_id=payment.id)
  or exists(select 1 from public.finance_receipt_allocation_corrections where tenant_id=t and payment_id=payment.id) then raise exception 'finance_correction_payment_unavailable' using errcode='23514';end if;
 select movement_id into movement from public.finance_receivable_movement_links where tenant_id=t and payment_id=payment.id and action='receive';
 if not found then raise exception 'finance_correction_requires_movement_integration' using errcode='23514';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_receipt_allocation_corrections(tenant_id,payment_id,receivable_id,movement_id,request_id,actor_id,actor_name,reason)
 values(t,payment.id,payment.receivable_id,movement,request,actor,coalesce(actor_name,actor::text),reason) returning id into correction;
 perform public._sync_receivable_financial_projection(t,payment.receivable_id);
 after_data:=public._receivable_financial_snapshot(t,payment.receivable_id);
 if coalesce((after_data->>'requires_reconciliation')::boolean,true) then raise exception 'finance_correction_projection_failed' using errcode='23514';end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payment_id',payment.id,'correction_id',correction,'movement_id',movement,'confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'receipt_allocation',correction,'receipt_allocation_corrected',actor,coalesce(actor_name,actor::text),reason,before_data,after_data||result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'receipt_allocation_corrected',_payload,result);
 return result;
end;$$;
revoke all on function finance_private.correct_receipt_allocation(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.correct_receipt_allocation(jsonb) to authenticated;
create function public.correct_finance_receipt_allocation(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.correct_receipt_allocation(_payload)$$;
revoke all on function public.correct_finance_receipt_allocation(jsonb) from public,anon,service_role;
grant execute on function public.correct_finance_receipt_allocation(jsonb) to authenticated;
do $$declare body text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 if to_regprocedure('finance_private.audit_events(uuid,jsonb)') is not null then
  select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
  if position(needle in body)=0 then raise exception 'finance_correction_audit_contract_changed';end if;
  execute replace(body,needle,'''receipt_allocation_corrected'','||needle);
 end if;
end;$$;

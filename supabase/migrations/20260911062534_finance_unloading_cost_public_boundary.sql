-- Promotion only after the reviewed cost journal, effective readers and payment evidence are installed.
do $preflight$
declare spec record;p record;
begin
 for spec in select * from (values
 ('finance_private.recorded_costs(uuid,jsonb)','effective_cost_amount'),
 ('finance_private.recorded_cost_summary(uuid,date,date,text,text)','effective_cost_amount'),
 ('finance_private.list_expenses(uuid,jsonb)','cost_origin'),
 ('finance_private.canonical_trip_costs(uuid,uuid)','expense_cost_version'),
 ('finance_private.settlement_expense_context(uuid,uuid,integer)','cost_origin'),
 ('finance_private.payable_portfolio(uuid,jsonb,integer,text)','payable_effective_cost_evidence'),
 ('finance_private.unloading_cost_cancellation_context(uuid,uuid)','expense_cost_effective'),
 ('finance_private.coordinated_unloading_cancellation_context(uuid,uuid,date)','cost_context#>>')) v(signature,marker) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or position(spec.marker in p.prosrc)=0 or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] then raise exception 'finance_cost_public_dependency_unavailable: %',spec.signature using errcode='55000';end if;
 end loop;
 if to_regclass('finance_private.expense_cost_amendments') is null or not exists(select 1 from pg_trigger where tgrelid='public.finance_events'::regclass and tgname='finance_payment_cost_version' and tgenabled='O' and tgfoid=to_regprocedure('finance_private.capture_payment_cost_version()')) then raise exception 'finance_cost_public_evidence_unavailable' using errcode='55000';end if;
 for spec in select * from (values ('finance_private.correct_unloading_cost(jsonb)'),('finance_private.unloading_cost_correction_context(uuid,uuid,text)')) v(signature) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_cost_raw_access_unavailable: %',spec.signature using errcode='55000';end if;
 end loop;
end $preflight$;
create function finance_private.dispatch_unloading_cost_correction(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.correct_unloading_cost(_payload);
end$$;
create function public.correct_finance_unloading_cost(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_unloading_cost_correction(_payload)$$;
create function finance_private.unloading_cost_correction_preview(_tenant_id uuid,_charge_id uuid,_amount_cents text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;can_invoke boolean;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.unloading_cost_correction_context(_tenant_id,_charge_id,_amount_cents);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text or value->>'charge_id' is distinct from _charge_id::text or value#>>'{target,amount_cents}' is distinct from _amount_cents then raise exception 'finance_cost_context_identity_invalid' using errcode='55000';end if;
 -- Invocation capacity, not a substitute for reviewed body hashes and integrated tests.
 can_invoke:=has_function_privilege('authenticated','public.correct_finance_unloading_cost(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_unloading_cost_correction(jsonb)','execute') and not has_function_privilege('authenticated','finance_private.correct_unloading_cost(jsonb)','execute') and not has_function_privilege('anon','finance_private.correct_unloading_cost(jsonb)','execute') and not has_function_privilege('service_role','finance_private.correct_unloading_cost(jsonb)','execute');
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_correct'='true' and can_invoke);
end$$;
create function public.get_finance_unloading_cost_correction_context(_tenant_id uuid,_charge_id uuid,_amount_cents text) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.unloading_cost_correction_preview(_tenant_id,_charge_id,_amount_cents)$$;
revoke all on function finance_private.dispatch_unloading_cost_correction(jsonb),public.correct_finance_unloading_cost(jsonb),finance_private.unloading_cost_correction_preview(uuid,uuid,text),public.get_finance_unloading_cost_correction_context(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_unloading_cost_correction(jsonb),public.correct_finance_unloading_cost(jsonb),finance_private.unloading_cost_correction_preview(uuid,uuid,text),public.get_finance_unloading_cost_correction_context(uuid,uuid,text) to authenticated;

-- Separate promotion boundary; install only after the effective-origin readers and guards are reviewed.
do $preflight$
begin
 if to_regprocedure('finance_private.correct_unloading_origin(jsonb)') is null
 or to_regprocedure('finance_private.unloading_flow_receipt_origin(uuid,uuid,jsonb)') is null
 or position('unloading_origin' in (select prosrc from pg_proc where oid='finance_private.list_expenses(uuid,jsonb)'::regprocedure))=0
 or has_function_privilege('authenticated','finance_private.correct_unloading_origin(jsonb)','EXECUTE')
 or has_function_privilege('service_role','finance_private.correct_unloading_origin(jsonb)','EXECUTE')
 or has_function_privilege('anon','finance_private.correct_unloading_origin(jsonb)','EXECUTE')
 then raise exception 'unloading_origin_public_dependencies_unavailable' using errcode='55000';end if;
end $preflight$;
create function finance_private.dispatch_unloading_origin_correction(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.require_access((_payload->>'tenant_id')::uuid);
 return finance_private.correct_unloading_origin(_payload);
end$$;
revoke all on function finance_private.dispatch_unloading_origin_correction(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_unloading_origin_correction(jsonb) to authenticated;
create function public.correct_finance_unloading_origin(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_unloading_origin_correction(_payload)$$;
revoke all on function public.correct_finance_unloading_origin(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_finance_unloading_origin(jsonb) to authenticated;
create function finance_private.unloading_origin_correction_preview(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb;can_invoke boolean;
begin
 perform finance_private.require_access(_tenant_id);
 value:=finance_private.unloading_origin_correction_context(_tenant_id,_charge_id,_proposal);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text or value->>'charge_id' is distinct from _charge_id::text then raise exception 'unloading_origin_context_identity_invalid' using errcode='55000';end if;
 -- Invocation capacity only: these ACL checks do not certify every implementation body.
 can_invoke:=has_function_privilege('authenticated','public.correct_finance_unloading_origin(jsonb)','EXECUTE')
 and has_function_privilege('authenticated','finance_private.dispatch_unloading_origin_correction(jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','finance_private.correct_unloading_origin(jsonb)','EXECUTE')
 and not has_function_privilege('service_role','finance_private.correct_unloading_origin(jsonb)','EXECUTE')
 and not has_function_privilege('anon','finance_private.correct_unloading_origin(jsonb)','EXECUTE');
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_correct'='true' and can_invoke);
end$$;
revoke all on function finance_private.unloading_origin_correction_preview(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.unloading_origin_correction_preview(uuid,uuid,jsonb) to authenticated;
create function public.get_finance_unloading_origin_correction_context(_tenant_id uuid,_charge_id uuid,_proposal jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.unloading_origin_correction_preview(_tenant_id,_charge_id,_proposal)$$;
revoke all on function public.get_finance_unloading_origin_correction_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_unloading_origin_correction_context(uuid,uuid,jsonb) to authenticated;

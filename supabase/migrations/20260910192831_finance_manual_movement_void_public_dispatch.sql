-- Local release candidate. Apply only after the independent native gate passes.
-- Keep the original private writer and its frozen ACL/baseline unchanged.
create function finance_private.manual_movement_void_runtime_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(has_function_privilege('authenticated',to_regprocedure('public.void_finance_manual_movement(jsonb)'),'EXECUTE'),false)
 and coalesce(has_function_privilege('authenticated',to_regprocedure('finance_private.dispatch_manual_movement_void(jsonb)'),'EXECUTE'),false)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('finance_private.void_manual_movement(jsonb)'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('anon',to_regprocedure('public.void_finance_manual_movement(jsonb)'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('anon',to_regprocedure('finance_private.dispatch_manual_movement_void(jsonb)'),'EXECUTE'),true)
 and exists(select 1 from finance_private.movement_void_command_baseline where snapshot=finance_private.movement_void_command_runtime_state())
 and coalesce((finance_private.movement_correction_readiness()->>'ready')::boolean,false)
 and exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.finance_movement_voids'::regclass and tgname='finance_manual_movement_void_command' and tgfoid='finance_private.guard_manual_movement_void()'::regprocedure and tgenabled in('O','A') and tgtype=7 and tgqual is null and tgnargs=0 and not tgdeferrable and not tginitdeferred)
 and not exists(select 1 from unnest(array['payables','financial_obligations','payroll_entry_items','driver_settlement_items','finance_internal_transfers','finance_transfer_departures']) x where not exists(select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass('public.'||x) and tgname='finance_active_movement_source' and tgfoid='finance_private.guard_voided_movement_source()'::regprocedure and tgenabled in('O','A') and tgtype=23 and tgqual is null and tgnargs=0 and not tgdeferrable and not tginitdeferred))
$$;
revoke all on function finance_private.manual_movement_void_runtime_ready() from public,anon,authenticated,service_role;

create function finance_private.dispatch_manual_movement_void(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 tenant:=finance_private.movement_origin_uuid(_payload->>'tenant_id');
 if tenant is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 -- The original writer performs reauthorization after the lock, replay,
 -- authoritative context/revision validation, and final ticket/INSERT guard.
 return finance_private.void_manual_movement(_payload);
end$$;
revoke all on function finance_private.dispatch_manual_movement_void(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_manual_movement_void(jsonb) to authenticated;

create function public.void_finance_manual_movement(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.dispatch_manual_movement_void(_payload)$$;
revoke all on function public.void_finance_manual_movement(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.void_finance_manual_movement(jsonb) to authenticated;

do $$declare body text;needle text;begin
 body:=pg_get_functiondef('finance_private.movement_correction_preview(uuid,uuid)'::regprocedure);
 needle:='return result||jsonb_build_object(''can_execute'',false);';
 if position(needle in body)=0 then raise exception 'finance_movement_preview_promotion_contract_changed';end if;
 execute replace(body,needle,'return result||jsonb_build_object(''can_execute'',coalesce((result->>''eligible'')::boolean,false) and finance_private.manual_movement_void_runtime_ready());');
end$$;

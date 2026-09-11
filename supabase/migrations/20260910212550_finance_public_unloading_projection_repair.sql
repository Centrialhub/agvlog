-- Public promotion is separate from the reviewed private repair implementation.
create function finance_private.dispatch_unloading_projection_repair(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not finance_private.can_repair_unloading((_payload->>'tenant_id')::uuid) then
  raise exception 'finance_access_denied' using errcode='42501';
 end if;
 return finance_private.repair_unloading_projection(_payload);
end $$;
revoke all on function finance_private.dispatch_unloading_projection_repair(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_unloading_projection_repair(jsonb) to authenticated;

create function public.repair_finance_unloading_projection(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select finance_private.dispatch_unloading_projection_repair(_payload);
$$;
revoke all on function public.repair_finance_unloading_projection(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.repair_finance_unloading_projection(jsonb) to authenticated;

create function finance_private.unloading_repair_dispatch_ready() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare dispatch oid:=to_regprocedure('finance_private.dispatch_unloading_projection_repair(jsonb)');
 endpoint oid:=to_regprocedure('public.repair_finance_unloading_projection(jsonb)');
 writer oid:=to_regprocedure('finance_private.repair_unloading_projection(jsonb)');
 context oid:=to_regprocedure('finance_private.unloading_projection_repair_context(uuid,uuid)');
begin
 if dispatch is null or endpoint is null or writer is null or context is null then return false;end if;
 return has_schema_privilege('authenticated','finance_private','USAGE')
  and has_function_privilege('authenticated',dispatch,'EXECUTE')
  and has_function_privilege('authenticated',endpoint,'EXECUTE')
  and not has_function_privilege('anon',dispatch,'EXECUTE')
  and not has_function_privilege('anon',endpoint,'EXECUTE')
  and not has_function_privilege('service_role',dispatch,'EXECUTE')
  and not has_function_privilege('service_role',endpoint,'EXECUTE')
  and not has_function_privilege('authenticated',writer,'EXECUTE')
  and not has_function_privilege('authenticated',context,'EXECUTE')
  and not has_function_privilege('anon',writer,'EXECUTE')
  and not has_function_privilege('anon',context,'EXECUTE')
  and not has_function_privilege('service_role',writer,'EXECUTE')
  and not has_function_privilege('service_role',context,'EXECUTE')
  and exists(select 1 from pg_catalog.pg_proc where oid=dispatch and prosecdef and proconfig @> array['search_path=""'])
  and exists(select 1 from pg_catalog.pg_proc where oid=endpoint and not prosecdef and proconfig @> array['search_path=""']);
end $$;
revoke all on function finance_private.unloading_repair_dispatch_ready() from public,anon,authenticated,service_role;

create or replace function finance_private.unloading_projection_repair_preview(_tenant uuid,_charge uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 context:=finance_private.unloading_projection_repair_context(_tenant,_charge);
 return (context-'_evidence')||jsonb_build_object('can_execute',
  coalesce((context->>'eligible')::boolean,false) and coalesce((context->>'can_repair')::boolean,false)
  and finance_private.unloading_repair_dispatch_ready());
end $$;
-- CREATE OR REPLACE preserves the original preview OID and its existing ACL.

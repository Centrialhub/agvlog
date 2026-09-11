-- Review is available before the write command. Eligibility alone must never
-- be interpreted by a client as permission to execute an unavailable command.
create function finance_private.movement_correction_preview(_tenant uuid,_movement uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not exists(select 1 from public.finance_movements where tenant_id=_tenant and id=_movement) then raise exception 'finance_movement_not_found' using errcode='22023';end if;
 result:=finance_private.movement_correction_context(_tenant,_movement);
 if result->>'tenant_id' is distinct from _tenant::text or result->>'movement_id' is distinct from _movement::text
  or result->>'version' is distinct from '1' then raise exception 'finance_movement_preview_context_invalid' using errcode='22023';end if;
 return result||jsonb_build_object('can_execute',false);
end$$;
revoke all on function finance_private.movement_correction_preview(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.movement_correction_preview(uuid,uuid) to authenticated;
create function public.preview_finance_movement_correction(_tenant_id uuid,_movement_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.movement_correction_preview(_tenant_id,_movement_id)
$$;
revoke all on function public.preview_finance_movement_correction(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_finance_movement_correction(uuid,uuid) to authenticated;

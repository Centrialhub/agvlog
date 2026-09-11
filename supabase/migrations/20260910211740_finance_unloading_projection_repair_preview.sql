-- Expose the review DTO only; raw evidence and the mutation remain private.
create function finance_private.unloading_projection_repair_preview(_tenant uuid,_charge uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not finance_private.can_access(_tenant) then
  raise exception 'finance_access_denied' using errcode='42501';
 end if;
 return (finance_private.unloading_projection_repair_context(_tenant,_charge)-'_evidence')
  ||jsonb_build_object('can_execute',false);
end $$;
revoke all on function finance_private.unloading_projection_repair_preview(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.unloading_projection_repair_preview(uuid,uuid) to authenticated;

create function public.get_finance_unloading_projection_repair_context(_tenant_id uuid,_charge_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.unloading_projection_repair_preview(_tenant_id,_charge_id);
$$;
revoke all on function public.get_finance_unloading_projection_repair_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_unloading_projection_repair_context(uuid,uuid) to authenticated;

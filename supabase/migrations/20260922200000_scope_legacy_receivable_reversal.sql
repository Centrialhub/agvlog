create function finance_private.reverse_legacy_receivable_association_scoped(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  t uuid;
  payment uuid;
  link uuid;
begin
  if jsonb_typeof(_payload) is distinct from 'object'
     or _payload->'version' is distinct from '1'::jsonb
     or exists(select 1 from jsonb_object_keys(_payload) key where key not in ('version','tenant_id','request_id','payment_id','link_id','reason')) then
    raise exception 'finance_invalid_payload' using errcode='22023';
  end if;
  t := (_payload->>'tenant_id')::uuid;
  payment := (_payload->>'payment_id')::uuid;
  link := (_payload->>'link_id')::uuid;
  if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501'; end if;
  if not exists(
    select 1 from public.finance_legacy_receipt_movement_links existing
    where existing.tenant_id=t and existing.id=link and existing.payment_id=payment
  ) then
    raise exception 'finance_legacy_receipt_link_mismatch' using errcode='23514';
  end if;
  return finance_private.manage_legacy_receivable_association(_payload-'payment_id',true);
end;
$function$;

revoke all on function finance_private.reverse_legacy_receivable_association_scoped(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.reverse_legacy_receivable_association_scoped(jsonb) to authenticated;

create or replace function public.reverse_finance_legacy_receivable_association(_payload jsonb)
returns jsonb
language sql
security invoker
set search_path=''
as $$select finance_private.reverse_legacy_receivable_association_scoped(_payload)$$;

revoke all on function public.reverse_finance_legacy_receivable_association(jsonb) from public,anon,service_role;
grant execute on function public.reverse_finance_legacy_receivable_association(jsonb) to authenticated;

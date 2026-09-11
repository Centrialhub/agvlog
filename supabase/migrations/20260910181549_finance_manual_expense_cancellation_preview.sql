create function finance_private.manual_expense_cancellation_preview(_tenant uuid,_payable uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not exists(select 1 from public.payables where tenant_id=_tenant and id=_payable) then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 result:=finance_private.manual_expense_cancellation_context(_tenant,_payable);
 if result->>'tenant_id' is distinct from _tenant::text or result->>'payable_id' is distinct from _payable::text then raise exception 'finance_expense_preview_context_invalid' using errcode='22023';end if;
 return result||jsonb_build_object('can_execute',true);
end$$;
revoke all on function finance_private.manual_expense_cancellation_preview(uuid,uuid) from public,anon,service_role;
grant execute on function finance_private.manual_expense_cancellation_preview(uuid,uuid) to authenticated;
create function public.preview_finance_manual_expense_cancellation(_tenant_id uuid,_payable_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.manual_expense_cancellation_preview(_tenant_id,_payable_id)$$;
revoke all on function public.preview_finance_manual_expense_cancellation(uuid,uuid) from public,anon,service_role;
grant execute on function public.preview_finance_manual_expense_cancellation(uuid,uuid) to authenticated;

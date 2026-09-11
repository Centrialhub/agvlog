-- Historical receipt relationships; does not infer reconciliation or alter cash.
create function finance_private.movement_receipt_trace(_tenant uuid,_movement uuid,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.finance_movements where tenant_id=_tenant and id=_movement) then raise exception 'finance_movement_not_found' using errcode='P0002';end if;
 with links as (
  select l.command_id,l.payment_id,l.action,l.created_at,c.receivable_id,
   coalesce(nullif(c.before_snapshot->>'reference',''),c.receivable_id::text) reference,
   (p.amount*100)::bigint amount_cents,
   case when correction.id is not null then jsonb_build_object('id',correction.id,'actor_id',correction.actor_id,'actor_name',correction.actor_name,'reason',correction.reason,'created_at',correction.created_at) end correction,
   case when credit.id is not null then jsonb_build_object('id',credit.id,'amount_cents',credit.amount_cents,'created_at',credit.created_at) end credit,
   rv.id reversal_id
  from public.finance_receivable_movement_links l
  join public.receivable_financial_commands c on c.tenant_id=l.tenant_id and c.id=l.command_id
  join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
  left join public.finance_receipt_allocation_corrections correction on correction.tenant_id=l.tenant_id and correction.payment_id=l.payment_id
  left join public.finance_customer_credits credit on credit.tenant_id=l.tenant_id and credit.payment_id=l.payment_id
  left join public.receivable_payment_reversals rv on rv.tenant_id=l.tenant_id and rv.payment_id=l.payment_id
  where l.tenant_id=_tenant and l.movement_id=_movement
 ), page_rows as (select * from links order by created_at desc,command_id desc limit 20 offset ((_page-1)*20))
 select jsonb_build_object('version',1,'tenant_id',_tenant,'movement_id',_movement,'page',_page,'page_size',20,
  'total',(select count(*) from links),'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.command_id desc) from page_rows r),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function finance_private.movement_receipt_trace(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.movement_receipt_trace(uuid,uuid,integer) to authenticated;
create function public.get_finance_movement_receipt_trace(_tenant_id uuid,_movement_id uuid,_page integer) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.movement_receipt_trace(_tenant_id,_movement_id,_page)$$;
revoke all on function public.get_finance_movement_receipt_trace(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.get_finance_movement_receipt_trace(uuid,uuid,integer) to authenticated;

-- Historical receipt relationships; does not infer reconciliation or alter cash.
create or replace function finance_private.movement_receipt_trace(_tenant uuid,_movement uuid,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.finance_movements where tenant_id=_tenant and id=_movement) then raise exception 'finance_movement_not_found' using errcode='P0002';end if;
 with links as (
  select 'canonical'::text origin,l.command_id link_id,l.command_id,l.payment_id,l.action,l.created_at,c.receivable_id,
   coalesce(nullif(c.before_snapshot->>'reference',''),c.receivable_id::text) reference,
   (p.amount*100)::bigint amount_cents,
   case when correction.id is not null then jsonb_build_object('id',correction.id,'actor_id',correction.actor_id,'actor_name',correction.actor_name,'reason',correction.reason,'created_at',correction.created_at) end correction,
   case when credit.id is not null then jsonb_build_object('id',credit.id,'amount_cents',credit.amount_cents,'created_at',credit.created_at) end credit,
   rv.id reversal_id,null::jsonb association,null::jsonb association_reversal
  from public.finance_receivable_movement_links l
  join public.receivable_financial_commands c on c.tenant_id=l.tenant_id and c.id=l.command_id
  join public.receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id
  left join public.finance_receipt_allocation_corrections correction on correction.tenant_id=l.tenant_id and correction.payment_id=l.payment_id
  left join public.finance_customer_credits credit on credit.tenant_id=l.tenant_id and credit.payment_id=l.payment_id
  left join public.receivable_payment_reversals rv on rv.tenant_id=l.tenant_id and rv.payment_id=l.payment_id
  where l.tenant_id=_tenant and l.movement_id=_movement
  union all
  select 'legacy_adoption'::text origin,l.id link_id,null::uuid command_id,l.payment_id,'receive'::text action,l.created_at,l.receivable_id,
   coalesce(nullif(l.source_snapshot->'receivable'->>'reference',''),l.receivable_id::text) reference,l.amount_cents,
   null::jsonb correction,
   case when credit.id is not null then jsonb_build_object('id',credit.id,'amount_cents',credit.amount_cents,'created_at',credit.created_at) end credit,
   rv.id reversal_id,
   jsonb_build_object('actor_id',l.created_by,'actor_name',l.actor_name,'reason',l.reason,'created_at',l.created_at,'existing_receipt_confirmed',l.source_snapshot->'existing_receipt_confirmed') association,
   case when ar.id is not null then jsonb_build_object('id',ar.id,'actor_id',ar.created_by,'actor_name',ar.actor_name,'reason',ar.reason,'created_at',ar.created_at) end association_reversal
  from public.finance_legacy_receipt_movement_links l
  left join public.finance_legacy_receipt_link_reversals ar on ar.tenant_id=l.tenant_id and ar.link_id=l.id
  left join public.finance_customer_credits credit on credit.tenant_id=l.tenant_id and credit.payment_id=l.payment_id
  left join public.receivable_payment_reversals rv on rv.tenant_id=l.tenant_id and rv.payment_id=l.payment_id
  where l.tenant_id=_tenant and l.movement_id=_movement
 ), page_rows as (select * from links order by created_at desc,origin desc,link_id desc limit 20 offset ((_page-1)*20))
 select jsonb_build_object('version',1,'tenant_id',_tenant,'movement_id',_movement,'page',_page,'page_size',20,
  'total',(select count(*) from links),'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.origin desc,r.link_id desc) from page_rows r),'[]'::jsonb)) into result;
 return result;
end$$;

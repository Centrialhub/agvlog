create function finance_private.new_settlement_payment_candidates(_tenant uuid,_settlement uuid,_amount_cents bigint,_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.driver_settlements%rowtype;paid numeric;balance numeric;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _amount_cents is null or _amount_cents not between 1 and 99999999999999 or _page is null or _page not between 1 and 100000 then
  raise exception 'finance_invalid_payment_query' using errcode='22023';end if;
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_settlement;
 if not found then raise exception 'finance_settlement_not_found' using errcode='22023';end if;
 if s.driver_id is null or s.status not in('approved','paid') or coalesce(s.needs_recalculation,false) then
  raise exception 'finance_settlement_requires_review' using errcode='23514';end if;
 if s.driver_payable_amount is null or s.driver_payable_amount<0 or s.driver_payable_amount*100>99999999999999
 or s.driver_payable_amount::text in('NaN','Infinity','-Infinity') or s.driver_payable_amount*100<>trunc(s.driver_payable_amount*100) then
  raise exception 'finance_settlement_invalid_balance' using errcode='23514';end if;
 if exists(select 1 from public.driver_settlement_payments where tenant_id=_tenant and settlement_id=s.id and
  (amount is null or amount<=0 or amount*100>99999999999999 or amount::text in('NaN','Infinity','-Infinity') or amount*100<>trunc(amount*100))) then raise exception 'finance_settlement_invalid_balance' using errcode='23514';end if;
 select coalesce(sum(amount*100),0) into paid from public.driver_settlement_payments where tenant_id=_tenant and settlement_id=s.id;
 balance:=greatest(s.driver_payable_amount*100-paid,0);
 with candidates as materialized(
  select m.id,m.description,m.occurred_on,m.amount_cents,m.beneficiary_name,a.name account_name,
   m.amount_cents-finance_private.movement_used_cents(_tenant,m.id) remaining_cents
  from public.finance_movements m join public.bank_accounts a on a.id=m.bank_account_id and a.tenant_id=_tenant
  where m.tenant_id=_tenant and m.driver_id=s.driver_id and m.direction='out' and m.nature<>'transfer'
   and balance>=_amount_cents and m.amount_cents-finance_private.movement_used_cents(_tenant,m.id)>=_amount_cents
 ), paged as(select * from candidates order by occurred_on desc,id limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'settlement_id',s.id,'amount_cents',_amount_cents,'balance_cents',balance,
  'page',_page,'page_size',20,'total',(select count(*) from candidates),'rows',coalesce((select jsonb_agg(to_jsonb(paged) order by occurred_on desc,id) from paged),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.new_settlement_payment_candidates(uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.new_settlement_payment_candidates(uuid,uuid,bigint,integer) to authenticated;
create function public.get_finance_settlement_payment_candidates(_tenant_id uuid,_settlement_id uuid,_amount_cents bigint,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.new_settlement_payment_candidates(_tenant_id,_settlement_id,_amount_cents,_page)$$;
revoke all on function public.get_finance_settlement_payment_candidates(uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_settlement_payment_candidates(uuid,uuid,bigint,integer) to authenticated;

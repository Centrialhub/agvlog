-- Complete portfolio aggregate: allocated receipts are not bank cash.
create function finance_private.receivable_portfolio_summary(_tenant uuid,_from date,_to date,_client uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with selected as materialized(
  select r.* from public.receivables r where r.tenant_id=_tenant and (_client is null or r.client_id=_client)
   and (r.created_at is null or not isfinite(r.created_at) or
    ((_from is null or r.created_at>=(_from::timestamp at time zone 'America/Sao_Paulo'))
     and (_to is null or r.created_at<((_to+1)::timestamp at time zone 'America/Sao_Paulo'))))
 ), active as materialized(
  select s.*,coalesce(
   s.status in('pending','invoiced','partial','received') and s.created_at is not null and isfinite(s.created_at)

   and s.amount::text not in('NaN','Infinity','-Infinity') and coalesce(s.received_amount,0)::text not in('NaN','Infinity','-Infinity')
   and (s.due_date is null or isfinite(s.due_date))
   and s.amount>=0 and s.amount*100=trunc(s.amount*100) and s.amount*100<=99999999999999
   and coalesce(s.received_amount,0)>=0 and coalesce(s.received_amount,0)<=s.amount and coalesce(s.received_amount,0)*100=trunc(coalesce(s.received_amount,0)*100)
   and (s.status<>'received' or s.amount=coalesce(s.received_amount,0)),false) numeric_valid
  from selected s where s.status is distinct from 'cancelled'
 ), evidence as materialized(
  select a.*,case when numeric_valid then public._receivable_financial_snapshot(_tenant,a.id) end snapshot from active a
 ), checked as materialized(
  select e.*,numeric_valid and not coalesce((snapshot->>'requires_reconciliation')::boolean,true) and nullif(snapshot->>'fiscal_block_reason','') is null valid from evidence e
 ), amounts as materialized(
  select a.*,case when valid then trunc(amount*100) end nominal,
   case when valid then trunc(coalesce(received_amount,0)*100) end allocated,
   case when valid then trunc((amount-coalesce(received_amount,0))*100) end remaining
  from checked a
 ), summary as(
  select count(*) total,count(*) filter(where not valid) invalid,coalesce(sum(nominal),0) nominal,
   coalesce(sum(allocated),0) allocated,coalesce(sum(remaining),0) remaining,
   coalesce(sum(remaining) filter(where due_date<today),0) overdue from amounts
 ), statuses as(
  select coalesce(status,'unknown') status,count(*) count,sum(nominal) nominal,sum(allocated) allocated,sum(remaining) remaining
  from amounts group by status
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'client_id',_client,'as_of',today,
  'total_titles',s.total,'canceled_titles',(select count(*) from selected where status='cancelled'),'invalid_titles',s.invalid,'totals_valid',s.invalid=0,
  'nominal_cents',case when s.invalid=0 then s.nominal::text end,
  'received_allocated_cents',case when s.invalid=0 then s.allocated::text end,
  'open_cents',case when s.invalid=0 then s.remaining::text end,
  'overdue_cents',case when s.invalid=0 then s.overdue::text end,
  'status_rows',coalesce((select jsonb_agg(jsonb_build_object('status',g.status,'count',g.count,
   'nominal_cents',case when s.invalid=0 then g.nominal::text end,
   'received_allocated_cents',case when s.invalid=0 then g.allocated::text end,
   'open_cents',case when s.invalid=0 then g.remaining::text end) order by g.status) from statuses g),'[]'))
 into result from summary s;
 return result;
end$$;
revoke all on function finance_private.receivable_portfolio_summary(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.receivable_portfolio_summary(uuid,date,date,uuid) to authenticated;
create function public.get_finance_receivable_portfolio_summary(_tenant_id uuid,_from date default null,_to date default null,_client_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.receivable_portfolio_summary(_tenant_id,_from,_to,_client_id)$$;
revoke all on function public.get_finance_receivable_portfolio_summary(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivable_portfolio_summary(uuid,date,date,uuid) to authenticated;

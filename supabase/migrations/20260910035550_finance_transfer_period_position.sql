-- Position by effective date, using currently known records. Not a frozen close.
create function finance_private.transfer_period_position(_tenant uuid,_account uuid,_cutoff date,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _cutoff is null or _cutoff>(clock_timestamp() at time zone 'America/Sao_Paulo')::date or _page is null or _page<1 or _page>100000 then raise exception 'finance_invalid_period' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_invalid_account' using errcode='22023';end if;
 with outgoing as (
  select m.id movement_id,m.bank_account_id source_account_id,coalesce(credit.bank_account_id,d.destination_account_id) destination_account_id,
   m.amount_cents,m.occurred_on,credit.occurred_on arrived_on,m.bank_reference,
   case when credit.id is not null then 'arrived_after_cutoff' when d.id is not null then 'awaiting_arrival' else 'unlinked_outgoing' end status
  from public.finance_movements m
  left join public.finance_internal_transfers p on p.tenant_id=m.tenant_id and p.outgoing_id=m.id
  left join public.finance_movements credit on credit.tenant_id=p.tenant_id and credit.id=p.incoming_id
  left join public.finance_transfer_departures d on d.tenant_id=m.tenant_id and d.outgoing_id=m.id
  where m.tenant_id=_tenant and m.nature='transfer' and m.direction='out' and m.occurred_on<=_cutoff
   and (credit.id is null or credit.occurred_on>_cutoff)
 ), relevant as (
  select * from outgoing where source_account_id=_account or destination_account_id=_account
  union all
  select m.id,null::uuid,m.bank_account_id,m.amount_cents,m.occurred_on,m.occurred_on,m.bank_reference,'unlinked_incoming'
  from public.finance_movements m where m.tenant_id=_tenant and m.bank_account_id=_account and m.direction='in' and m.nature='transfer' and m.occurred_on<=_cutoff
   and not exists(select 1 from public.finance_internal_transfers p where p.tenant_id=m.tenant_id and p.incoming_id=m.id)
 ), page_rows as (
  select r.*,src.name source_name,dst.name destination_name from relevant r
  left join public.bank_accounts src on src.tenant_id=_tenant and src.id=r.source_account_id
  left join public.bank_accounts dst on dst.tenant_id=_tenant and dst.id=r.destination_account_id
  order by r.occurred_on,r.movement_id limit 20 offset ((_page-1)*20)
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'cutoff',_cutoff,'page',_page,'page_size',20,
  'total',(select count(*) from relevant),'unlinked_count',(select count(*) from relevant where status in('unlinked_outgoing','unlinked_incoming')),
  'outbound_transit_cents',coalesce((select sum(amount_cents) from relevant where source_account_id=_account and status in('awaiting_arrival','arrived_after_cutoff')),0)::text,
  'inbound_transit_cents',coalesce((select sum(amount_cents) from relevant where destination_account_id=_account and status in('awaiting_arrival','arrived_after_cutoff')),0)::text,
  'frozen',false,'bank_confirmed',false,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_on,r.movement_id) from page_rows r),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function finance_private.transfer_period_position(uuid,uuid,date,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.transfer_period_position(uuid,uuid,date,integer) to authenticated;
create function public.get_finance_transfer_period_position(_tenant_id uuid,_account_id uuid,_cutoff date,_page integer) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.transfer_period_position(_tenant_id,_account_id,_cutoff,_page)$$;
revoke all on function public.get_finance_transfer_period_position(uuid,uuid,date,integer) from public,anon,service_role;
grant execute on function public.get_finance_transfer_period_position(uuid,uuid,date,integer) to authenticated;

create function finance_private.get_settlement_payment_movements(_tenant_id uuid,_payment_id uuid,_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.driver_settlement_payments%rowtype;driver uuid;result jsonb;linked jsonb;
begin
 if not finance_private.can_access(_tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>100000 then raise exception 'finance_invalid_page' using errcode='22023';end if;
 select * into p from public.driver_settlement_payments where tenant_id=_tenant_id and id=_payment_id;
 if not found then raise exception 'finance_payment_not_found' using errcode='22023';end if;
 select driver_id into driver from public.driver_settlements where tenant_id=_tenant_id and id=p.settlement_id;
 if driver is null then raise exception 'Acerto sem motorista: corrija a identificação antes de vincular.' using errcode='22023';end if;
 if p.paid_at is null or p.amount is null or p.amount<=0 or p.amount*100<>trunc(p.amount*100) or p.amount*100>99999999999999 then
 raise exception 'Pagamento com valor ou data inválidos: revise o registro antes de vincular.' using errcode='22023';end if;
 select jsonb_build_object('id',l.id,'movement_id',l.movement_id,'amount_cents',l.amount_cents,'created_by',l.created_by,'created_at',l.created_at,
 'actor_name',coalesce(e.actor_name,l.created_by::text),'reason',e.reason) into linked
 from public.finance_settlement_movement_links l left join lateral(
 select actor_name,reason from public.finance_events where tenant_id=_tenant_id and entity_id=p.id and action='settlement_payment_linked' and after_data->>'link_id'=l.id::text order by created_at,id limit 1
 ) e on true where l.tenant_id=_tenant_id and l.payment_id=p.id;
 with candidates as (
 select m.id,m.description,m.occurred_on,m.amount_cents,m.beneficiary_name,a.name account_name,
 m.amount_cents-finance_private.movement_used_cents(_tenant_id,m.id) remaining_cents
 from public.finance_movements m join public.bank_accounts a on a.id=m.bank_account_id and a.tenant_id=m.tenant_id
 where m.tenant_id=_tenant_id and m.driver_id=driver and m.direction='out' and m.nature<>'transfer'
 and m.occurred_on=(p.paid_at at time zone 'America/Sao_Paulo')::date and linked is null
 and p.amount>0 and p.amount*100=trunc(p.amount*100)
 and m.amount_cents-finance_private.movement_used_cents(_tenant_id,m.id)>=p.amount*100
 ), paged as(select * from candidates order by occurred_on,id limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant_id,'payment_id',p.id,'settlement_id',p.settlement_id,'amount_cents',p.amount*100,
 'page',_page,'page_size',20,'total',(select count(*) from candidates),'link',linked,'rows',coalesce((select jsonb_agg(to_jsonb(paged) order by occurred_on,id) from paged),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function finance_private.get_settlement_payment_movements(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.get_settlement_payment_movements(uuid,uuid,integer) to authenticated;
create function public.get_finance_settlement_payment_movements(_tenant_id uuid,_payment_id uuid,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$ select finance_private.get_settlement_payment_movements(_tenant_id,_payment_id,_page) $$;
revoke all on function public.get_finance_settlement_payment_movements(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_settlement_payment_movements(uuid,uuid,integer) to authenticated;

drop function if exists public.get_finance_payable_payment_history(uuid,uuid,integer);
drop function if exists finance_private.payable_payment_history(uuid,uuid,integer);

create function finance_private.payable_payment_history(_tenant uuid,_payable uuid,_page integer default 1,_expected_revision text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;page_revision text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if not exists(select 1 from public.payables where tenant_id=_tenant and id=_payable) then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 with payments as materialized(
  select p.*,b.name account_name,l.id link_id,l.movement_id,l.origin link_origin,
   case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.created_by,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end reversal
  from public.payables_payments p left join public.bank_accounts b on b.id=p.bank_account_id and b.tenant_id=_tenant
  left join lateral(select l.* from public.finance_payable_movement_links l where l.payment_id=p.id and l.tenant_id=_tenant
   order by exists(select 1 from public.finance_payable_link_reversals rv where rv.tenant_id=l.tenant_id and rv.link_id=l.id),l.created_at desc,l.id desc limit 1) l on true
  left join public.finance_payable_link_reversals r on r.link_id=l.id and r.tenant_id=_tenant
  where p.tenant_id=_tenant and p.payable_id=_payable
 ),revision as(select md5(coalesce(jsonb_agg(to_jsonb(p) order by paid_at desc,id desc)::text,'[]')) value from payments p),
 paged as(select * from payments order by paid_at desc,id desc limit 30 offset (_page-1)*30)
 select r.value,jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page_revision',r.value,'page',_page,'total',(select count(*) from payments),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at desc,p.id desc) from paged p),'[]')) into page_revision,result from revision r;
 if _expected_revision is not null and _expected_revision is distinct from page_revision then raise exception 'finance_payable_history_changed' using errcode='40001';end if;
 return result;
end$$;
revoke all on function finance_private.payable_payment_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_payment_history(uuid,uuid,integer,text) to authenticated;

create function public.get_finance_payable_payment_history(_tenant_id uuid,_payable_id uuid,_page integer default 1,_expected_revision text default null)
returns jsonb language sql security invoker set search_path='' as $$select finance_private.payable_payment_history(_tenant_id,_payable_id,_page,_expected_revision);$$;
revoke all on function public.get_finance_payable_payment_history(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payable_payment_history(uuid,uuid,integer,text) to authenticated;

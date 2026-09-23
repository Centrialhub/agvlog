drop function if exists public.get_finance_payable_movements(uuid,uuid,text,integer);
drop function if exists finance_private.payable_movement_options(uuid,uuid,text,integer);

create function finance_private.payable_movement_options(_tenant uuid,_payable uuid,_search text default '',_page integer default 1,_expected_revision text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;result jsonb;paid numeric;page_revision text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200
  or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_options' using errcode='22023';end if;
 select * into p from public.payables where id=_payable and tenant_id=_tenant;
 if not found then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from finance_private.active_payable_payments where tenant_id=_tenant and payable_id=_payable;
 with capacity as materialized(
  select m.id,m.beneficiary_name,m.description,m.occurred_on,m.bank_reference,m.bank_account_id,b.name account_name,m.amount_cents,
   m.amount_cents-finance_private.movement_used_cents(_tenant,m.id) remaining_cents
  from finance_private.active_movements m join public.bank_accounts b on b.id=m.bank_account_id and b.tenant_id=_tenant
  where m.tenant_id=_tenant and m.direction='out' and m.nature<>'transfer'
   and (p.driver_id is null or m.driver_id=p.driver_id)
   and position(lower(coalesce(_search,'')) in lower(m.beneficiary_name||' '||m.description||' '||coalesce(m.bank_reference,'')||' '||b.name||' '||m.id::text))>0
 ),candidates as materialized(
  select id,beneficiary_name,description,occurred_on,bank_reference,bank_account_id,account_name,amount_cents::text amount_cents,remaining_cents::text remaining_cents
  from capacity where remaining_cents>0
 ),revision as(
  select md5(coalesce(jsonb_agg(to_jsonb(c) order by occurred_on desc,id)::text,'[]')) value from candidates c
 ),paged as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30)
 select r.value,jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'page_revision',r.value,'page',_page,'total',(select count(*) from candidates),
  'payable_status',p.status,'payable_name',p.supplier_name,'remaining_cents',(greatest(p.amount-paid,0)*100)::numeric(30,0)::text,
  'can_apply',p.status in('approved','partial') and paid>=0 and paid=trunc(paid,2) and p.amount>paid,
  'rows',coalesce((select jsonb_agg(to_jsonb(row) order by row.occurred_on desc,row.id) from paged row),'[]'))
 into page_revision,result from revision r;
 if _expected_revision is not null and _expected_revision is distinct from page_revision then raise exception 'finance_payable_options_changed' using errcode='40001';end if;
 return result;
end$$;
revoke all on function finance_private.payable_movement_options(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.payable_movement_options(uuid,uuid,text,integer,text) to authenticated;

create function public.get_finance_payable_movements(_tenant_id uuid,_payable_id uuid,_search text default '',_page integer default 1,_expected_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.payable_movement_options(_tenant_id,_payable_id,_search,_page,_expected_revision);$$;
revoke all on function public.get_finance_payable_movements(uuid,uuid,text,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_payable_movements(uuid,uuid,text,integer,text) to authenticated;

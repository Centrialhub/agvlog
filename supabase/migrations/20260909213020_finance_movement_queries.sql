create function finance_private.list_movements(_tenant uuid,_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; page integer; size integer; date_from date; date_to date;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 page:=coalesce((_filters->>'page')::integer,1);size:=coalesce((_filters->>'page_size')::integer,50);
 date_from:=nullif(_filters->>'from','')::date;date_to:=nullif(_filters->>'to','')::date;
 if page<1 or page>1000000 or size<1 or size>100 or date_from>date_to then
  raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with filtered as materialized (
  select m.*,b.name account_name from public.finance_movements m join public.bank_accounts b on b.id=m.bank_account_id and b.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and (date_from is null or m.occurred_on>=date_from) and (date_to is null or m.occurred_on<=date_to)
   and (nullif(_filters->>'account_id','') is null or m.bank_account_id=(_filters->>'account_id')::uuid)
   and (nullif(_filters->>'direction','') is null or m.direction=_filters->>'direction')
   and (nullif(_filters->>'driver_id','') is null or m.driver_id=(_filters->>'driver_id')::uuid)
   and (nullif(btrim(_filters->>'search'),'') is null or position(lower(btrim(_filters->>'search')) in
    lower(concat_ws(' ',m.description,m.beneficiary_name,m.beneficiary_document,m.bank_reference)))>0)
 ), rows as (select * from filtered order by occurred_on desc,created_at desc,id limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,
  'total',(select count(*) from filtered),
  'inflow_cents',coalesce((select sum(amount_cents) from filtered where direction='in'),0)::text,
  'outflow_cents',coalesce((select sum(amount_cents) from filtered where direction='out'),0)::text,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_on desc,r.created_at desc,r.id) from rows r),'[]'::jsonb)) into result;
 return result;
end;
$$;
revoke all on function finance_private.list_movements(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.list_movements(uuid,jsonb) to authenticated;
create function public.list_finance_movements(_tenant_id uuid,_filters jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select finance_private.list_movements(_tenant_id,_filters);$$;
revoke all on function public.list_finance_movements(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_movements(uuid,jsonb) to authenticated;

create function public.get_finance_access(_tenant_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$select finance_private.can_access(_tenant_id);$$;
revoke all on function public.get_finance_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_access(uuid) to authenticated;

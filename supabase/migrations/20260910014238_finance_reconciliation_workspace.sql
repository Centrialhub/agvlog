create function finance_private.reconciliation_options(_tenant uuid,_import uuid,_kind text,_search text,_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _kind is null or _kind not in('movements','entries') or _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200 then
  raise exception 'finance_invalid_reconciliation_filters' using errcode='22023';end if;
 select bank_account_id into account from public.finance_statement_imports where tenant_id=_tenant and id=_import;
 if not found then raise exception 'finance_statement_not_found' using errcode='22023';end if;
 with candidates as materialized(
  select m.id,m.bank_account_id,m.occurred_on as "day",m.direction,m.amount_cents::text amount_cents,m.description,m.beneficiary_name counterparty,
   m.bank_reference reference,true source_verified
  from public.finance_movements m where _kind='movements' and m.tenant_id=_tenant and m.bank_account_id=account
   and not exists(select 1 from public.finance_reconciliation_groups g where g.tenant_id=_tenant and m.id=any(g.movement_ids)
    and not exists(select 1 from public.finance_reconciliation_reversals r where r.tenant_id=_tenant and r.group_id=g.id))
  union all
  select e.id,e.bank_account_id,e.posted_on,case when e.amount_cents>0 then 'in' else 'out' end,abs(e.amount_cents)::text,e.description,
   e.counterparty_name,coalesce(e.bank_id,e.document_number),coalesce((select v.outcome='rows_match' from public.finance_statement_verifications v
    where v.tenant_id=_tenant and v.import_id=e.first_import_id order by v.created_at desc,v.id desc limit 1),false)
  from public.finance_bank_entries e where _kind='entries' and e.tenant_id=_tenant and e.bank_account_id=account
   and finance_private.bank_entry_active(_tenant,e.id)
   and (e.first_import_id=_import or exists(select 1 from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=_import and r.bank_entry_id=e.id)
    or exists(select 1 from public.finance_statement_identity_reviews ir join public.finance_statement_rows sr on sr.id=ir.row_id and sr.tenant_id=ir.tenant_id
     where ir.tenant_id=_tenant and sr.import_id=_import and ir.bank_entry_id=e.id
      and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id)))
   and not exists(select 1 from public.finance_reconciliation_groups g where g.tenant_id=_tenant and e.id=any(g.bank_entry_ids)
    and not exists(select 1 from public.finance_reconciliation_reversals r where r.tenant_id=_tenant and r.group_id=g.id))
 ), filtered as materialized(
  select * from candidates where position(lower(coalesce(_search,'')) in lower(description||' '||coalesce(counterparty,'')||' '||coalesce(reference,'')))>0
 ), paged as(select * from filtered order by "day" desc,id limit 20 offset (_page-1)*20)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'import_id',_import,'bank_account_id',account,'kind',_kind,'page',_page,'page_size',20,
  'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by "day" desc,id) from paged p),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.reconciliation_options(uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
create function public.list_finance_reconciliation_options(_tenant_id uuid,_import_id uuid,_kind text,_search text default '',_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select finance_private.reconciliation_options(_tenant_id,_import_id,_kind,_search,_page);$$;
revoke all on function public.list_finance_reconciliation_options(uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_reconciliation_options(uuid,uuid,text,text,integer),finance_private.reconciliation_options(uuid,uuid,text,text,integer) to authenticated;

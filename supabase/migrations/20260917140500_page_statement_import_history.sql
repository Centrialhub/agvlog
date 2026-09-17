create or replace function finance_private.statement_lines(
  _tenant uuid,
  _import uuid,
  _filters jsonb default '{}'
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  page integer:=coalesce((_filters->>'page')::integer,1);
  size integer:=coalesce((_filters->>'page_size')::integer,30);
  result jsonb;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if page not between 1 and 1000000 or size not between 1 and 100 or jsonb_typeof(_filters) is distinct from 'object' then
    raise exception 'finance_invalid_statement_filters' using errcode='22023';end if;
  if not exists(select 1 from public.finance_statement_imports where tenant_id=_tenant and id=_import) then
    raise exception 'finance_statement_not_found' using errcode='22023';end if;

  with filtered as materialized(
    select r.id,r.tenant_id,r.import_id,r.source_row,r.classification,r.bank_entry_id,cardinality(r.candidate_ids) candidate_count,
      r.raw->>'posted_on' posted_on,(r.raw->>'amount_cents')::bigint amount_cents,coalesce(r.raw->>'description','') description,
      r.raw->>'bank_id' bank_id,r.raw->>'document_number' document_number,r.raw->>'counterparty_name' counterparty_name,
      r.raw->>'counterparty_document' counterparty_document,r.raw#>'{raw,cells}' source_cells,
      (select coalesce(jsonb_agg(to_jsonb(e)),'[]') from(select e.id,e.posted_on,e.amount_cents,e.description,e.bank_id,e.counterparty_name,e.first_import_id
        from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=any(r.candidate_ids) order by e.id limit 5)e) candidate_preview
    from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=_import
      and (nullif(_filters->>'classification','') is null or r.classification=_filters->>'classification')
  ), paged as(
    select * from filtered order by source_row limit size offset (page-1)*size
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant,'import_id',_import,'page',page,'page_size',size,
    'total',(select count(*) from filtered),
    'row_amount_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered),
    'source_verification_id',(select id from public.finance_statement_verifications where tenant_id=_tenant and import_id=_import order by created_at desc,id desc limit 1),
    'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('manual_review',
      (select to_jsonb(ir)||jsonb_build_object('reversal',(select to_jsonb(rv) from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id))
       from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=p.id order by ir.created_at desc,ir.id desc limit 1)) order by p.source_row) from paged p),'[]'),
    'history','[]'::jsonb
  ) into result;
  return result;
end
$function$;

create or replace function finance_private.statement_history(
  _tenant uuid,
  _import uuid,
  _page integer default 1,
  _page_size integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if _page not between 1 and 1000000 or _page_size not between 1 and 100 then raise exception 'finance_invalid_statement_history_page' using errcode='22023';end if;
  if not exists(select 1 from public.finance_statement_imports where tenant_id=_tenant and id=_import) then raise exception 'finance_statement_not_found' using errcode='22023';end if;
  return jsonb_build_object(
    'version',1,'tenant_id',_tenant,'import_id',_import,'page',_page,'page_size',_page_size,
    'total',(select count(*) from public.finance_events e where e.tenant_id=_tenant and e.entity_type='statement_import' and e.entity_id=_import),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'actor_name',e.actor_name,'actor_id',e.actor_id,'action',e.action,'reason',e.reason,'created_at',e.created_at) order by e.created_at desc,e.id desc)
      from (select * from public.finance_events where tenant_id=_tenant and entity_type='statement_import' and entity_id=_import order by created_at desc,id desc limit _page_size offset (_page-1)*_page_size)e),'[]'::jsonb)
  );
end
$function$;

revoke all on function finance_private.statement_history(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_history(uuid,uuid,integer,integer) to authenticated;

create or replace function public.list_finance_statement_history_v1(_tenant_id uuid,_import_id uuid,_page integer default 1,_page_size integer default 30)
returns jsonb language sql security invoker set search_path='' as $$
  select finance_private.statement_history(_tenant_id,_import_id,_page,_page_size);
$$;
revoke all on function public.list_finance_statement_history_v1(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_statement_history_v1(uuid,uuid,integer,integer) to authenticated;

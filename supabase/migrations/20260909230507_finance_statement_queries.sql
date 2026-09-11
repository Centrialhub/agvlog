create function finance_private.list_statements(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,20);
 start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 50 or start_date>end_date
   or length(coalesce(_filters->>'search',''))>200 then raise exception 'finance_invalid_statement_filters' using errcode='22023';end if;
 with filtered as materialized(
   select i.id,i.tenant_id,i.bank_account_id,a.name account_name,i.file_name,i.file_hash,i.source_path,i.period_start,i.period_end,i.input_rows,i.created_at,
     coalesce(v.outcome,'pending') source_verification,v.report verification_report,
     coalesce((select jsonb_object_agg(c.classification,c.n) from(select r.classification,count(*) n from public.finance_statement_rows r
       where r.tenant_id=_tenant and r.import_id=i.id group by r.classification)c),'{}') counts,
     (select count(*) from public.finance_statement_rows r where r.tenant_id=_tenant and r.import_id=i.id
       and r.classification in('ambiguous','reference_conflict','repeated_reference')) identity_review_count
   from public.finance_statement_imports i join public.bank_accounts a on a.id=i.bank_account_id and a.tenant_id=i.tenant_id
   left join lateral(select v.outcome,v.report from public.finance_statement_verifications v where v.tenant_id=_tenant and v.import_id=i.id order by v.created_at desc,v.id desc limit 1)v on true
   where i.tenant_id=_tenant and (nullif(_filters->>'account_id','') is null or i.bank_account_id=(_filters->>'account_id')::uuid)
     and (start_date is null or i.period_end>=start_date) and (end_date is null or i.period_start<=end_date)
     and position(lower(coalesce(_filters->>'search','')) in lower(i.file_name||' '||a.name))>0
 ), selected as materialized(
   select * from filtered where nullif(_filters->>'source_status','') is null or source_verification=_filters->>'source_status'
 ), paged as(select * from selected order by created_at desc,id desc limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,'total',(select count(*) from selected),
   'rows',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from paged p),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.list_statements(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.list_statements(uuid,jsonb) to authenticated;
create function public.list_finance_statements(_tenant_id uuid,_filters jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select finance_private.list_statements(_tenant_id,_filters);$$;
revoke all on function public.list_finance_statements(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_statements(uuid,jsonb) to authenticated;

create function finance_private.statement_lines(_tenant uuid,_import uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);result jsonb;
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
 ), paged as(select * from filtered order by source_row limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'import_id',_import,'page',page,'page_size',size,
   'total',(select count(*) from filtered),'row_amount_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered),
   'rows',coalesce((select jsonb_agg(to_jsonb(p) order by source_row) from paged p),'[]'),
   'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'actor_name',e.actor_name,'actor_id',e.actor_id,'action',e.action,'reason',e.reason,'created_at',e.created_at)
     order by e.created_at,e.id) from public.finance_events e where e.tenant_id=_tenant and e.entity_type='statement_import' and e.entity_id=_import),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.statement_lines(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.statement_lines(uuid,uuid,jsonb) to authenticated;
create function public.list_finance_statement_lines(_tenant_id uuid,_import_id uuid,_filters jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select finance_private.statement_lines(_tenant_id,_import_id,_filters);$$;
revoke all on function public.list_finance_statement_lines(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_statement_lines(uuid,uuid,jsonb) to authenticated;

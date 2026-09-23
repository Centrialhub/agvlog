create index if not exists finance_statement_imports_keyset on public.finance_statement_imports(tenant_id,created_at desc,id desc);
create index if not exists finance_statement_verifications_latest on public.finance_statement_verifications(tenant_id,import_id,created_at desc,id desc);
create index if not exists finance_statement_rows_import_classification on public.finance_statement_rows(tenant_id,import_id,classification);
create index if not exists finance_statement_identity_reviews_row on public.finance_statement_identity_reviews(tenant_id,row_id);
create index if not exists finance_statement_review_reversals_review on public.finance_statement_review_reversals(tenant_id,review_id);

create function finance_private.list_statements_v2(_tenant uuid,_filters jsonb default'{}')returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare size integer:=coalesce((_filters->>'page_size')::integer,20);start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;
 cursor_created timestamptz:=nullif(_filters->'cursor'->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_filters->'cursor'->>'id','')::uuid;result jsonb;
begin
 if not finance_private.can_access(_tenant)then raise exception'finance_access_denied'using errcode='42501';end if;
 if jsonb_typeof(_filters)is distinct from'object'or size not between 1 and 50 or start_date>end_date or length(coalesce(_filters->>'search',''))>200
  or exists(select 1 from jsonb_object_keys(_filters)k where k not in('page_size','from','to','search','account_id','source_status','cursor'))
  or((_filters->'cursor')is not null and(cursor_created is null or cursor_id is null or exists(select 1 from jsonb_object_keys(_filters->'cursor')k where k not in('created_at','id'))))
 then raise exception'finance_invalid_statement_filters'using errcode='22023';end if;
 with latest_verification as materialized(
  select distinct on(v.import_id)v.import_id,v.outcome,v.report from public.finance_statement_verifications v where v.tenant_id=_tenant order by v.import_id,v.created_at desc,v.id desc
 ),filtered_keys as materialized(
  select i.id,i.created_at,coalesce(v.outcome,'pending')source_verification,v.report verification_report
  from public.finance_statement_imports i join public.bank_accounts a on a.id=i.bank_account_id and a.tenant_id=i.tenant_id left join latest_verification v on v.import_id=i.id
  where i.tenant_id=_tenant and(nullif(_filters->>'account_id','')is null or i.bank_account_id=(_filters->>'account_id')::uuid)
   and(start_date is null or i.period_end>=start_date)and(end_date is null or i.period_start<=end_date)
   and position(lower(coalesce(_filters->>'search',''))in lower(i.file_name||' '||a.name))>0
   and(nullif(_filters->>'source_status','')is null or coalesce(v.outcome,'pending')=_filters->>'source_status')
 ),page_keys as materialized(
  select * from filtered_keys k where cursor_created is null or k.created_at<cursor_created or(k.created_at=cursor_created and k.id<cursor_id)
  order by created_at desc,id desc limit size+1
 ),rows as(
  select i.id,i.tenant_id,i.bank_account_id,a.name account_name,i.file_name,i.file_hash,i.source_path,i.period_start,i.period_end,i.input_rows,i.created_at,
   k.source_verification,k.verification_report,coalesce(stats.counts,'{}')counts,coalesce(stats.identity_review_count,0)identity_review_count,coalesce(stats.manual_review_count,0)manual_review_count
  from(select * from page_keys order by created_at desc,id desc limit size)k join public.finance_statement_imports i on i.tenant_id=_tenant and i.id=k.id
  join public.bank_accounts a on a.tenant_id=i.tenant_id and a.id=i.bank_account_id
  left join lateral(
   select coalesce(jsonb_object_agg(s.classification,s.n),'{}')counts,coalesce(sum(s.unresolved),0)identity_review_count,
    coalesce(sum(s.reviewed),0)manual_review_count
   from(select sr.classification,count(*)n,
     count(*)filter(where sr.classification in('ambiguous','reference_conflict','repeated_reference')and not exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=sr.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id)))unresolved,
     count(*)filter(where exists(select 1 from public.finance_statement_identity_reviews ir where ir.tenant_id=_tenant and ir.row_id=sr.id and not exists(select 1 from public.finance_statement_review_reversals rv where rv.tenant_id=_tenant and rv.review_id=ir.id)))reviewed
    from public.finance_statement_rows sr where sr.tenant_id=_tenant and sr.import_id=i.id group by sr.classification)s
  )stats on true
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',size,'cursor',_filters->'cursor','total',(select count(*)from filtered_keys),
  'has_more',(select count(*)>size from page_keys),'next_cursor',case when(select count(*)>size from page_keys)then(select jsonb_build_object('created_at',created_at,'id',id)from page_keys order by created_at desc,id desc offset size-1 limit 1)end,
  'rows',coalesce((select jsonb_agg(to_jsonb(r)order by created_at desc,id desc)from rows r),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.list_statements_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function finance_private.list_statements_v2(uuid,jsonb)to authenticated;
create function public.list_finance_statements_v2(_tenant_id uuid,_filters jsonb default'{}')returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.list_statements_v2(_tenant_id,_filters)$$;
revoke all on function public.list_finance_statements_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.list_finance_statements_v2(uuid,jsonb)to authenticated;

-- Add global filters before evidence, aggregation, fingerprint and pagination.
-- Monetary evidence helper and all writer/ACL definitions remain unchanged.
do $guard$ begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('finance_private.payable_portfolio(uuid,jsonb,integer,text)')) is distinct from '1ddff1b28f6c39e2e1227a528ef6584d'
 and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('finance_private.payable_portfolio(uuid,jsonb,integer,text)')) is distinct from '87e36f40b3eebf97cbc7a9577bd83d5d'
 then raise exception 'finance_payable_portfolio_source_changed';end if;
end;$guard$;
create or replace function finance_private.payable_portfolio(_tenant uuid,_filters jsonb,_page integer,_revision text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare basis text;starts date;ends date;supplier uuid;filter_category text;filter_search text;filter_status text;filter_source text;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or _page is null or _page not between 1 and 1000000 or exists(select 1 from jsonb_each(_filters) f where f.key<>all(array['date_basis','from','to','category','supplier_id','search','status','source']) or jsonb_typeof(f.value) not in('string','null')) then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if exists(select 1 from jsonb_each_text(_filters) f where f.key in('from','to') and f.value is not null and f.value !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 basis:=coalesce(_filters->>'date_basis','due_date');starts:=nullif(_filters->>'from','')::date;ends:=nullif(_filters->>'to','')::date;supplier:=nullif(_filters->>'supplier_id','')::uuid;filter_category:=nullif(btrim(_filters->>'category'),'');
 filter_search:=nullif(btrim(_filters->>'search'),'');filter_status:=nullif(_filters->>'status','');filter_source:=nullif(_filters->>'source','');
 if length(filter_search)>200 or filter_status<>all(array['pending','approved','partial','paid','overdue','cancelled','unknown']) or filter_source<>all(array['manual','system','unknown']) then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if basis<>all(array['due_date','created_at']) or starts>ends or (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) or length(filter_category)>100 or (_revision is not null and _revision !~ '^[a-f0-9]{32}$') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with selected as materialized(
 select p.*,case when basis='due_date' then case when isfinite(p.due_date) then p.due_date end else case when isfinite(p.created_at) then (p.created_at at time zone 'America/Sao_Paulo')::date end end filter_day
 from public.payables p where p.tenant_id=_tenant and (supplier is null or p.supplier_id=supplier) and (filter_category is null or p.category=filter_category)
 and (filter_search is null or strpos(lower(concat_ws(' ',p.supplier_name,p.description,p.document_number)),lower(filter_search))>0)
 and (filter_source is null or (filter_source='unknown' and coalesce(p.source,'system')<>all(array['manual','system'])) or coalesce(p.source,'system')=filter_source)
 and (filter_status is null or (filter_status='overdue' and isfinite(p.due_date) and p.due_date<today and coalesce(p.status,'unknown')<>all(array['paid','cancelled'])) or (filter_status='unknown' and (p.status is null or p.status<>all(array['pending','approved','partial','paid','overdue','cancelled']))) or (filter_status<>'overdue' and p.status=filter_status))
 ), scoped as materialized(select * from selected where filter_day is null or ((starts is null or filter_day>=starts) and (ends is null or filter_day<=ends))),
 evidence as materialized(select p.*,finance_private.payable_portfolio_evidence(_tenant,p.id) ev from scoped p),
 rows as materialized(select id,coalesce(status,'unknown') status,filter_day,
 jsonb_build_object('source_table','payables','source_id',id,'status',coalesce(status,'unknown'),'supplier_id',supplier_id,'supplier_name',supplier_name,'category',category,'description',description,
 'due_on',case when isfinite(due_date) then due_date end,'created_on',case when isfinite(created_at) then (created_at at time zone 'America/Sao_Paulo')::date end,
 'date_in_range',filter_day is not null,'origin',jsonb_build_object('source_table',source_table,'source_id',source_id),'declared_amount',amount::text,'declared_paid',paid_amount::text,
 'payment_ids',ev->'payment_ids','valid',ev->'valid','issues',ev->'issues','nominal_cents',ev->'nominal_cents','paid_cents',ev->'paid_cents','open_cents',ev->'open_cents','source_revision',ev->'revision') value,
 (ev->>'valid')::boolean valid,(ev->>'nominal_cents')::numeric nominal,(ev->>'paid_cents')::numeric paid,(ev->>'open_cents')::numeric remaining,
 case when isfinite(due_date) then due_date end due_on from evidence),
 summary as(select count(*) total,count(*) filter(where status='cancelled') cancelled,count(*) filter(where not valid) invalid,count(*) filter(where filter_day is null) undated,
 coalesce(sum(nominal),0) nominal,coalesce(sum(paid),0) paid,coalesce(sum(remaining),0) remaining,coalesce(sum(remaining) filter(where due_on<today),0) overdue from rows),
 fingerprint as(select md5(jsonb_build_object('tenant',_tenant,'filters',jsonb_build_object('date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source),'day',today,'sources',coalesce(jsonb_agg(value order by id),'[]'))::text) revision from rows),
 paged as(select value,filter_day,id from rows order by filter_day nulls last,id limit 30 offset (_page-1)*30),
 grouped as(select status,count(*) count from rows group by status),issues as(select issue,count(*) count from rows cross join lateral jsonb_array_elements_text(value->'issues')issue group by issue)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'basis','current_operational','date_basis',basis,'from',starts,'to',ends,'category',filter_category,'supplier_id',supplier,'search',filter_search,'status_filter',filter_status,'source_filter',filter_source,'as_of',today,
 'revision',f.revision,'page',_page,'page_size',30,'total_titles',s.total,'cancelled_titles',s.cancelled,'invalid_titles',s.invalid,'undated_titles',s.undated,'totals_valid',s.invalid=0,
 'nominal_cents',case when s.invalid=0 then s.nominal::text end,'paid_cents',case when s.invalid=0 then s.paid::text end,'open_cents',case when s.invalid=0 then s.remaining::text end,'overdue_cents',case when s.invalid=0 then s.overdue::text end,
 'status_counts',coalesce((select jsonb_agg(to_jsonb(g) order by status) from grouped g),'[]'),'issue_counts',coalesce((select jsonb_agg(to_jsonb(g) order by issue) from issues g),'[]'),
 'rows',coalesce((select jsonb_agg(value order by filter_day nulls last,id) from paged),'[]')) into result from summary s cross join fingerprint f;
 if _revision is not null and result->>'revision'<>_revision then raise exception 'finance_payable_portfolio_changed' using errcode='40001';end if;
 return result;
end$$;

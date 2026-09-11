create index finance_events_audit_date on public.finance_events(tenant_id,created_at desc,id desc);
create index finance_events_audit_actor on public.finance_events(tenant_id,actor_id,created_at desc,id desc);
create function finance_private.audit_events(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);
 start_date date:=nullif(_filters->>'from','')::date;end_date date:=nullif(_filters->>'to','')::date;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 100 or start_date>end_date
   or length(coalesce(_filters->>'search',''))>200 or length(coalesce(_filters->>'actor_search',''))>200 then
   raise exception 'finance_invalid_audit_filters' using errcode='22023';end if;
 with filtered as materialized(select e.id,e.tenant_id,e.entity_type,e.entity_id,e.action,e.actor_id,e.actor_name,e.reason,e.created_at,
   e.action in('identity_reviewed_manually','identity_review_reversed') manual_intervention,e.after_data->>'decision' decision,
   nullif(e.after_data->>'row_id','') row_id
   from public.finance_events e where e.tenant_id=_tenant
   and (start_date is null or e.created_at>=start_date::timestamp at time zone 'America/Sao_Paulo')
   and (end_date is null or e.created_at<(end_date+1)::timestamp at time zone 'America/Sao_Paulo')
   and (nullif(_filters->>'action','') is null or e.action=_filters->>'action')
   and (nullif(_filters->>'actor_id','') is null or e.actor_id=(_filters->>'actor_id')::uuid)
   and position(lower(coalesce(_filters->>'actor_search','')) in lower(e.actor_name))>0
   and position(lower(coalesce(_filters->>'search','')) in lower(e.reason))>0
   and (not coalesce((_filters->>'manual_only')::boolean,false) or e.action in('identity_reviewed_manually','identity_review_reversed'))
 ), paged as(select * from filtered order by created_at desc,id desc limit size offset (page-1)*size)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,'total',(select count(*) from filtered),
   'manual_count',(select count(*) from filtered where manual_intervention),'timezone','America/Sao_Paulo',
   'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('statement_name',i.file_name,'source_row',sr.source_row) order by p.created_at desc,p.id desc)
     from paged p left join public.finance_statement_imports i on p.entity_type='statement_import' and i.tenant_id=_tenant and i.id=p.entity_id
     left join public.finance_statement_rows sr on sr.tenant_id=_tenant and sr.id::text=p.row_id),'[]')) into result;
 return result;
end;$$;
revoke all on function finance_private.audit_events(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.audit_events(uuid,jsonb) to authenticated;
create function public.list_finance_audit_events(_tenant_id uuid,_filters jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select finance_private.audit_events(_tenant_id,_filters);$$;
revoke all on function public.list_finance_audit_events(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_audit_events(uuid,jsonb) to authenticated;

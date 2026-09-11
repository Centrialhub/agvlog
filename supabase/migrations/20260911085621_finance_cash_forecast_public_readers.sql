-- Read adapters: complete server calculation, compact summaries, revision-bound source pages.
-- Execute grants and public wrappers are promoted separately after dependency review.
set lock_timeout='3s';set statement_timeout='30s';
create function finance_private.cash_forecast_summary(_collection jsonb,_projection jsonb,_issues jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('version',1,'tenant_id',_collection->'tenant_id','actor_id',_collection->'actor_id','revision',_collection->'revision','captured_at',_collection->'captured_at','cutoff',_collection->'cutoff','period_end',_collection->'period_end','account_scope',_collection->'account_scope','base',_collection->'base','projection_available',_projection is not null and _projection<>'null'::jsonb,
 'confirmed',_projection->'confirmed','expanded',_projection->'expanded','recorded_totals',_projection->'recorded_totals','scheduled',_projection->'scheduled','unscheduled',_projection->'unscheduled','unassigned_credit_cents',_collection->'unassigned_credit_cents','counts',_collection->'counts',
 'issue_groups',(select coalesce(jsonb_agg(jsonb_build_object('scope',g.scope,'code',g.code,'count',g.n) order by g.scope,g.code),'[]'::jsonb) from (select coalesce(x->>'scope','all') scope,x->>'code' code,count(*) n from jsonb_array_elements(_issues)x group by 1,2)g));
$$;
create function finance_private.preview_cash_forecast(_tenant uuid,_cutoff date,_period_end date,_expected_revision text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare collection jsonb;result jsonb;
begin
 perform finance_private.require_access(_tenant);
 collection:=finance_private.cash_forecast_collect(_tenant,_cutoff,_period_end);
 if collection->>'tenant_id' is distinct from _tenant::text or collection->>'actor_id' is distinct from auth.uid()::text then raise exception 'finance_forecast_collection_identity_invalid' using errcode='55000';end if;
 if _expected_revision is not null and _expected_revision is distinct from collection->>'revision' then raise exception 'finance_forecast_sources_changed' using errcode='40001';end if;
 result:=finance_private.project_collected_cash_forecast(collection);
 if result->'collection' is distinct from collection then raise exception 'finance_forecast_projection_invalid' using errcode='55000';end if;
 return finance_private.cash_forecast_summary(collection,result->'projection',result->'issues');
end$$;
create function finance_private.cash_forecast_source_page(_tenant uuid,_cutoff date,_period_end date,_snapshot uuid,_kind text,_page integer,_expected_revision text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;envelope jsonb;data jsonb;items jsonb;revision text;
begin
 perform finance_private.require_access(_tenant);
 if _page is null or _page<1 or _page>100000 or _kind is null or _kind not in('origins','movements','credits','issues') or coalesce(_expected_revision,'')!~'^[a-f0-9]{32}$' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if _snapshot is null then
  c:=finance_private.cash_forecast_collect(_tenant,_cutoff,_period_end);
  if c->>'tenant_id' is distinct from _tenant::text or c->>'actor_id' is distinct from auth.uid()::text then raise exception 'finance_forecast_collection_identity_invalid' using errcode='55000';end if;
  envelope:=finance_private.project_collected_cash_forecast(c);
 else
  envelope:=finance_private.read_cash_forecast_snapshot(_tenant,_snapshot);c:=envelope->'collection';
  if c->>'cutoff' is distinct from _cutoff::text or c->>'period_end' is distinct from _period_end::text then raise exception 'finance_forecast_snapshot_period_mismatch' using errcode='22023';end if;
 end if;
 revision:=c->>'revision';if revision is distinct from _expected_revision then raise exception 'finance_forecast_sources_changed' using errcode='40001';end if;
 data:=case _kind when 'origins' then c->'origins' when 'movements' then c->'recorded_after_cutoff' when 'credits' then c->'credits' else envelope->'issues' end;
 if jsonb_typeof(data) is distinct from 'array' then raise exception 'finance_forecast_sources_invalid' using errcode='55000';end if;
 select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb) into items from jsonb_array_elements(data) with ordinality x where x.ordinality>(_page-1)*30 and x.ordinality<=_page*30;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'snapshot_id',_snapshot,'kind',_kind,'page',_page,'page_size',30,'total',jsonb_array_length(data),'revision',revision,'rows',items);
end$$;
create function finance_private.cash_forecast_snapshot_summary(_tenant uuid,_snapshot uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare envelope jsonb;
begin
 perform finance_private.require_access(_tenant);envelope:=finance_private.read_cash_forecast_snapshot(_tenant,_snapshot);
 return (envelope-array['collection','projection','issues'])||jsonb_build_object('viewer_actor_id',auth.uid(),'summary',finance_private.cash_forecast_summary(envelope->'collection',envelope->'projection',envelope->'issues'));
end$$;
revoke all on function finance_private.cash_forecast_summary(jsonb,jsonb,jsonb),finance_private.preview_cash_forecast(uuid,date,date,text),finance_private.cash_forecast_source_page(uuid,date,date,uuid,text,integer,text),finance_private.cash_forecast_snapshot_summary(uuid,uuid) from public,anon,authenticated,service_role;

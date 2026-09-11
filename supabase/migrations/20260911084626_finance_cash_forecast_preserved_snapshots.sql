-- Private immutable captures. Promotion requires reviewed collector/projector dependencies.
set lock_timeout='3s';
set statement_timeout='30s';
create table finance_private.cash_forecast_snapshots(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 request_id uuid not null,actor_id uuid not null,actor_name text not null,title text not null check(length(btrim(title)) between 2 and 120),
 reason text not null check(length(btrim(reason)) between 5 and 2000),created_at timestamptz not null default clock_timestamp(),
 cutoff date not null,period_end date not null,source_revision text not null check(source_revision ~ '^[a-f0-9]{32}$'),
 collection jsonb not null,projection jsonb not null,issues jsonb not null,content_hash text not null,
 unique(tenant_id,id),unique(tenant_id,request_id),
 check(jsonb_typeof(collection)='object' and jsonb_typeof(issues)='array' and (jsonb_typeof(projection)='object' or projection='null'::jsonb)),
 check((collection->>'tenant_id') is not distinct from tenant_id::text),check((collection->>'actor_id') is not distinct from actor_id::text),
 check((collection->>'revision') is not distinct from source_revision),check((collection->>'cutoff') is not distinct from cutoff::text),check((collection->>'period_end') is not distinct from period_end::text),
 check(isfinite(cutoff) and isfinite(period_end) and cutoff<period_end),
 check(content_hash=md5(jsonb_build_object('collection',collection,'projection',projection,'issues',issues)::text))
);
alter table finance_private.cash_forecast_snapshots enable row level security;
revoke all on finance_private.cash_forecast_snapshots from public,anon,authenticated,service_role;
create index cash_forecast_snapshots_company_date on finance_private.cash_forecast_snapshots(tenant_id,created_at desc,id);
create trigger preserve_cash_forecast_snapshot before update or delete on finance_private.cash_forecast_snapshots for each row execute function finance_private.preserve_event();
create function finance_private.read_cash_forecast_snapshot(_tenant uuid,_snapshot uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s finance_private.cash_forecast_snapshots%rowtype;
begin
 perform finance_private.require_access(_tenant);
 select * into s from finance_private.cash_forecast_snapshots where tenant_id=_tenant and id=_snapshot;
 if not found then raise exception 'finance_forecast_snapshot_unavailable' using errcode='22023';end if;
 if not exists(select 1 from public.finance_commands c where c.tenant_id=_tenant and c.request_id=s.request_id and c.actor_id=s.actor_id and c.action='record_cash_forecast' and c.result->>'snapshot_id'=s.id::text and c.result->>'content_hash'=s.content_hash)
 or not exists(select 1 from public.finance_events e where e.tenant_id=_tenant and e.entity_type='cash_forecast' and e.entity_id=s.id and e.actor_id=s.actor_id and e.action='cash_forecast_preserved' and e.after_data->>'content_hash'=s.content_hash and e.after_data->>'request_id'=s.request_id::text)
 then raise exception 'finance_forecast_snapshot_proof_invalid' using errcode='55000';end if;
 return jsonb_build_object('version',1,'tenant_id',s.tenant_id,'snapshot_id',s.id,'request_id',s.request_id,'actor_id',s.actor_id,'actor_name',s.actor_name,'title',s.title,'reason',s.reason,'created_at',s.created_at,'source_revision',s.source_revision,'content_hash',s.content_hash,'collection',s.collection,'projection',s.projection,'issues',s.issues);
end$$;
create function finance_private.record_cash_forecast_snapshot(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;cut date;finish date;collection jsonb;projected jsonb;fingerprint text;new_id uuid;actor_name text;result jsonb;previous public.finance_commands%rowtype;
begin
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;
 perform finance_private.require_access(t);
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or req is null
 or coalesce(_payload->>'source_revision','')!~'^[a-f0-9]{32}$' or coalesce(_payload->>'cutoff','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(_payload->>'period_end','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or length(btrim(coalesce(_payload->>'title',''))) not between 2 and 120 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','source_revision','cutoff','period_end','title','reason']))
 then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 cut:=(_payload->>'cutoff')::date;finish:=(_payload->>'period_end')::date;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 perform finance_private.require_access(t);
 select * into previous from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if previous.actor_id<>actor or previous.action<>'record_cash_forecast' or previous.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  perform finance_private.read_cash_forecast_snapshot(t,(previous.result->>'snapshot_id')::uuid);
  return previous.result;
 end if;
 collection:=finance_private.cash_forecast_collect(t,cut,finish);
 if collection->>'tenant_id' is distinct from t::text or collection->>'actor_id' is distinct from actor::text or collection->>'cutoff' is distinct from cut::text or collection->>'period_end' is distinct from finish::text then raise exception 'finance_forecast_collection_identity_invalid' using errcode='55000';end if;
 if collection->>'revision' is distinct from _payload->>'source_revision' then raise exception 'finance_forecast_sources_changed' using errcode='40001';end if;
 projected:=finance_private.project_collected_cash_forecast(collection);
 if projected->'collection' is distinct from collection or projected->'projection' is null or jsonb_typeof(projected->'issues') is distinct from 'array' then raise exception 'finance_forecast_projection_invalid' using errcode='55000';end if;
 fingerprint:=md5(jsonb_build_object('collection',collection,'projection',projected->'projection','issues',projected->'issues')::text);
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;
 actor_name:=coalesce(actor_name,actor::text);
 insert into finance_private.cash_forecast_snapshots(tenant_id,request_id,actor_id,actor_name,title,reason,cutoff,period_end,source_revision,collection,projection,issues,content_hash)
 values(t,req,actor,actor_name,btrim(_payload->>'title'),btrim(_payload->>'reason'),cut,finish,collection->>'revision',collection,projected->'projection',projected->'issues',fingerprint) returning id into new_id;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'snapshot_id',new_id,'source_revision',collection->>'revision','content_hash',fingerprint,'confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'cash_forecast',new_id,'cash_forecast_preserved',actor,actor_name,btrim(_payload->>'reason'),null,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'record_cash_forecast',_payload,result);
 perform finance_private.read_cash_forecast_snapshot(t,new_id);
 return result;
exception when lock_not_available then raise exception 'finance_forecast_busy' using errcode='40001';
end$$;
revoke all on function finance_private.read_cash_forecast_snapshot(uuid,uuid),finance_private.record_cash_forecast_snapshot(jsonb) from public,anon,authenticated,service_role;

create function finance_private.list_cash_forecast_snapshots(_tenant uuid,_page integer default 1,_expected_revision text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total integer;revision text;rows jsonb;
begin
 perform finance_private.require_access(_tenant);
 if _page is null or _page<1 or _page>100000 or (_page>1 and _expected_revision is null) or (_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 select count(*)::integer,md5(coalesce(jsonb_agg(jsonb_build_object('id',s.id,'hash',s.content_hash,'title',s.title,'created_at',s.created_at) order by s.created_at desc,s.id desc),'[]'::jsonb)::text) into total,revision from finance_private.cash_forecast_snapshots s where s.tenant_id=_tenant;
 if _expected_revision is not null and _expected_revision<>revision then raise exception 'finance_forecast_history_changed' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('snapshot_id',s.id,'request_id',s.request_id,'actor_id',s.actor_id,'actor_name',s.actor_name,'title',s.title,'reason',s.reason,'created_at',s.created_at,'cutoff',s.cutoff,'period_end',s.period_end,'source_revision',s.source_revision,'content_hash',s.content_hash,
 'confirmed_complete',coalesce(s.projection#>'{confirmed,complete}','false'::jsonb),'expanded_complete',coalesce(s.projection#>'{expanded,complete}','false'::jsonb)) order by s.created_at desc,s.id desc),'[]'::jsonb) into rows from (select * from finance_private.cash_forecast_snapshots where tenant_id=_tenant order by created_at desc,id desc limit 30 offset (_page-1)*30) s;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'page',_page,'page_size',30,'total',total,'revision',revision,'rows',rows);
end$$;
revoke all on function finance_private.list_cash_forecast_snapshots(uuid,integer,text) from public,anon,authenticated,service_role;
